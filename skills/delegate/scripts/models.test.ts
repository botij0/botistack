import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "models.ts");
const SKILLS_ROOT = join(import.meta.dir, "..", "..");
const READONLY_RULE = "Read-only. Do not create or edit files, commit, push, or change external state.";

const BASE = `
panel = ["mimo", "muse", "codexsol"]

[tiers]
fast = ["flash"]
standard = ["mimo", "inherit"]
deep = ["codexsol", "mimo"]

[models.flash]
provider = "opencode"
model = "opencode-go/deepseek-v4.1-flash"

[models.mimo]
provider = "opencode"
model = "opencode-go/mimo-v2.6-pro"
options = { variant = "xhigh" }

[models.muse]
provider = "opencode"
model = "opencode-go/muse-spark-1.3-contributor"
options = { variant = "high" }

[models.codexsol]
provider = "codex"
model = "gpt-6.1-sol"
options = { reasoningEffort = "high" }
`;

const AVAILABLE = [
  "opencode-go/deepseek-v4.1-flash",
  "opencode-go/mimo-v2.6-pro",
  "opencode-go/muse-spark-1.3-contributor",
].join("\n");

let workdirs: string[] = [];

afterEach(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
  workdirs = [];
});

function workspace(config: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "botistack-models-"));
  workdirs.push(dir);
  const configPath = join(dir, "models.toml");
  if (config !== null) writeFileSync(configPath, config);
  const available = join(dir, "available.txt");
  writeFileSync(available, AVAILABLE);
  return { configPath, agentsDir: join(dir, "agents"), available };
}

function run(args: readonly string[]) {
  const home = mkdtempSync(join(tmpdir(), "botistack-home-"));
  workdirs.push(home);
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, XDG_CONFIG_HOME: home },
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

function resolveLines(configPath: string | null, agentsDir: string, role: string) {
  const configArgs = configPath === null ? [] : ["--config", configPath];
  const result = run(["resolve", role, ...configArgs, "--opencode-dir", agentsDir]);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  return result.out.trim().split("\n").map((line) => JSON.parse(line));
}

function sync(ws: ReturnType<typeof workspace>) {
  return run(["sync", "--config", ws.configPath, "--opencode-dir", ws.agentsDir, "--available", ws.available]);
}

describe("resolve", () => {
  test("with no config, every role runs on the parent's model", () => {
    const ws = workspace(null);
    expect(resolveLines(null, ws.agentsDir, "how.explorer")).toEqual([
      {
        role: "how.explorer",
        agent: join(SKILLS_ROOT, "how/agents/explorer.md"),
        readonly: true,
        t3Role: "research",
        opencode: null,
        chain: [{ model: "inherit", target: null }],
      },
    ]);
  });

  test("a seat role resolves its tier into a fallback chain of T3 targets", () => {
    const ws = workspace(BASE);
    const [seat] = resolveLines(ws.configPath, ws.agentsDir, "how.explorer");
    expect(seat.chain).toEqual([
      {
        model: "mimo",
        target: { providerInstanceId: "opencode", model: "opencode-go/mimo-v2.6-pro", options: { variant: "xhigh" } },
      },
      { model: "inherit", target: null },
    ]);
  });

  test("a panel role prints one seat per panel model", () => {
    const ws = workspace(BASE);
    const seats = resolveLines(ws.configPath, ws.agentsDir, "interrogate.reviewer");
    expect(seats.map((seat) => seat.chain)).toEqual([
      [{ model: "mimo", target: { providerInstanceId: "opencode", model: "opencode-go/mimo-v2.6-pro", options: { variant: "xhigh" } } }],
      [{ model: "muse", target: { providerInstanceId: "opencode", model: "opencode-go/muse-spark-1.3-contributor", options: { variant: "high" } } }],
      [{ model: "codexsol", target: { providerInstanceId: "codex", model: "gpt-6.1-sol", options: { reasoningEffort: "high" } } }],
    ]);
  });

  test("a role override replaces the role's default tier", () => {
    const ws = workspace(`${BASE}\n[roles]\n"how.explainer" = "fast"\n"arena.runner" = ["muse", "muse"]\n`);
    expect(resolveLines(ws.configPath, ws.agentsDir, "how.explainer")[0].chain).toEqual([
      { model: "flash", target: { providerInstanceId: "opencode", model: "opencode-go/deepseek-v4.1-flash" } },
    ]);
    expect(resolveLines(ws.configPath, ws.agentsDir, "arena.runner").map((seat) => seat.chain[0].model)).toEqual(["muse", "muse"]);
  });

  test("an unknown role is a usage error", () => {
    const ws = workspace(BASE);
    const result = run(["resolve", "how.explorr", "--config", ws.configPath]);
    expect(result.code).toBe(2);
    expect(result.err.split("\n")[0]).toStartWith('unknown role "how.explorr"');
  });
});

describe("check", () => {
  test("reports every broken reference in one pass", () => {
    const ws = workspace(`
panel = ["mimo", "ghost"]
[tiers]
fast = ["phantom"]
quick = ["mimo"]
[models.mimo]
provider = "opencode"
model = "opencode-go/mimo-v2.6-pro"
[models.deep]
provider = "opencode"
model = "x/y"
[roles]
"how.explorr" = "fast"
"how.explainer" = "speedy"
`);
    const result = run(["check", "--config", ws.configPath]);
    expect(result.code).toBe(1);
    expect(result.err.trim().split("\n")).toEqual([
      'error: models.deep: "deep" is reserved for tiers, the panel, and inherit',
      "error: tiers.quick: unknown tier, use fast, standard, deep",
      'error: roles."how.explorr": unknown role, run `models.ts check` to list roles',
      'error: tiers.fast: unknown model "phantom"',
      'error: panel: unknown model "ghost"',
      'error: roles."how.explainer": "speedy" is not a tier, "panel", or a model name',
    ]);
  });

  test("an explicit config path that does not exist is an error, not a silent default", () => {
    const result = run(["check", "--config", "/nonexistent/models.toml"]);
    expect(result.code).toBe(1);
    expect(result.err).toBe("error: config /nonexistent/models.toml does not exist\n");
  });

  test("the example config is valid", () => {
    const result = run(["check", "--config", join(SKILLS_ROOT, "delegate/models.example.toml")]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("interrogate.reviewer  panel  mimo, muse, deepseek, kimi");
    expect(result.out).toContain("how.explorer          seat   mimo -> inherit");
  });

  test("warns when a panel has a single model", () => {
    const ws = workspace(`${BASE}\n[roles]\n"interrogate.reviewer" = "mimo"\n`);
    const result = run(["check", "--config", ws.configPath]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("warning: interrogate.reviewer has fewer than two distinct models, so its seats share blind spots");
  });
});

describe("brief", () => {
  test("appends the read-only rule only for read-only roles", () => {
    const explorer = run(["brief", "how.explorer"]).out.trim();
    expect(explorer.endsWith(READONLY_RULE)).toBe(true);
    expect(explorer.startsWith("---")).toBe(false);
    expect(run(["brief", "fast"]).out).not.toContain(READONLY_RULE);
  });
});

describe("sync", () => {
  test("bakes model and variant into OpenCode agents, and resolve then names them", () => {
    const ws = workspace(BASE);
    expect(sync(ws).code).toBe(0);
    const explorer = readFileSync(join(ws.agentsDir, "boti-how-explorer.md"), "utf8");
    expect(explorer.split("\n").slice(0, 10)).toEqual([
      "---",
      'description: "botistack how.explorer on mimo"',
      "mode: subagent",
      "hidden: true",
      'model: "opencode-go/mimo-v2.6-pro"',
      'variant: "xhigh"',
      "permission:",
      "  edit: deny",
      "---",
      "",
    ]);
    expect(explorer.trim().endsWith(READONLY_RULE)).toBe(true);
    expect(resolveLines(ws.configPath, ws.agentsDir, "how.explorer")[0].opencode).toBe("boti-how-explorer");
  });

  test("falls back along a seat's chain past models OpenCode cannot run", () => {
    const ws = workspace(BASE);
    const result = sync(ws);
    const deep = readFileSync(join(ws.agentsDir, "boti-deep.md"), "utf8");
    expect(deep).toContain('model: "opencode-go/mimo-v2.6-pro"');
    expect(result.out).toContain("skipped boti-interrogate-reviewer-codexsol: no model OpenCode can run in [codexsol]");
    expect(existsSync(join(ws.agentsDir, "boti-interrogate-reviewer-codexsol.md"))).toBe(false);
  });

  test("skips models missing from the available list", () => {
    const ws = workspace(BASE);
    writeFileSync(ws.available, "opencode-go/muse-spark-1.3-contributor\n");
    sync(ws);
    expect(readFileSync(join(ws.agentsDir, "boti-how-explorer.md"), "utf8")).not.toContain("model:");
    expect(existsSync(join(ws.agentsDir, "boti-fast.md"))).toBe(false);
  });

  test("removes stale generated agents and never touches hand-written ones", () => {
    const ws = workspace(BASE);
    sync(ws);
    writeFileSync(join(ws.agentsDir, "boti-mine.md"), "---\nmode: subagent\n---\n\nhand written\n");
    writeFileSync(join(ws.agentsDir, "comment-sicko.md"), "hand written\n");
    writeFileSync(ws.configPath, BASE.replace('panel = ["mimo", "muse", "codexsol"]', 'panel = ["mimo", "codexsol"]'));
    const result = sync(ws);
    expect(result.out).toContain("removed boti-interrogate-reviewer-muse.md");
    expect(existsSync(join(ws.agentsDir, "boti-interrogate-reviewer-muse.md"))).toBe(false);
    expect(readFileSync(join(ws.agentsDir, "boti-mine.md"), "utf8")).toBe("---\nmode: subagent\n---\n\nhand written\n");
    expect(existsSync(join(ws.agentsDir, "comment-sicko.md"))).toBe(true);
  });

  test("a second run with the same config changes nothing", () => {
    const ws = workspace(BASE);
    sync(ws);
    expect(sync(ws).out.split("\n")[1]).toStartWith("written 0, unchanged ");
  });
});
