#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const TIERS = ["fast", "standard", "deep"] as const;
type Tier = (typeof TIERS)[number];
const PANEL = "panel";
const INHERIT = "inherit";
const RESERVED: ReadonlySet<string> = new Set([...TIERS, PANEL, INHERIT]);
const MODEL_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const GENERATED_PREFIX = "<!-- botistack: generated";
const GENERATED_MARKER = `${GENERATED_PREFIX} by delegate/scripts/models.ts sync. Edit the source agent or models.toml, then rerun sync. -->`;
const READONLY_RULE =
  "Read-only. Do not create or edit files, commit, push, or change external state.";

type OptionValue = string | boolean;
type Selector = string | readonly string[];

interface Model {
  readonly name: string;
  readonly provider: string;
  readonly driver: string;
  readonly id: string;
  readonly options: Readonly<Record<string, OptionValue>>;
}

type Seat = Model | typeof INHERIT;

export interface Config {
  readonly source: string | null;
  readonly models: ReadonlyMap<string, Model>;
  readonly tiers: Readonly<Record<Tier, readonly string[]>>;
  readonly panel: readonly string[];
  readonly roles: ReadonlyMap<string, Selector>;
}

type RoleKind = "seat" | "panel";
type T3Role = "implementation" | "research" | "review" | "design" | "general";

interface RoleSpec {
  readonly kind: RoleKind;
  readonly selector: Selector;
  readonly agent: string;
  readonly readonly: boolean;
  readonly t3Role: T3Role;
}

const BOTI = "boti-mode/agents/boti-agent.md";
const GENERAL = "delegate/agents/general.md";

export const ROLES: Readonly<Record<string, RoleSpec>> = {
  fast: { kind: "seat", selector: "fast", agent: BOTI, readonly: false, t3Role: "implementation" },
  standard: { kind: "seat", selector: "standard", agent: BOTI, readonly: false, t3Role: "implementation" },
  deep: { kind: "seat", selector: "deep", agent: BOTI, readonly: false, t3Role: "implementation" },
  "how.explorer": { kind: "seat", selector: "standard", agent: "how/agents/explorer.md", readonly: true, t3Role: "research" },
  "how.explainer": { kind: "seat", selector: "deep", agent: "how/agents/explainer.md", readonly: true, t3Role: "research" },
  "why.investigator": { kind: "seat", selector: "standard", agent: "why/agents/investigator.md", readonly: true, t3Role: "research" },
  "why.synthesizer": { kind: "seat", selector: "deep", agent: "why/agents/synthesizer.md", readonly: true, t3Role: "research" },
  "architect.runner": { kind: "panel", selector: PANEL, agent: "architect/agents/runner.md", readonly: false, t3Role: "design" },
  "arena.runner": { kind: "panel", selector: PANEL, agent: GENERAL, readonly: false, t3Role: "implementation" },
  "arena.judge": { kind: "panel", selector: PANEL, agent: GENERAL, readonly: true, t3Role: "review" },
  "interrogate.reviewer": { kind: "panel", selector: PANEL, agent: GENERAL, readonly: true, t3Role: "review" },
  "swarm.worker": { kind: "seat", selector: "standard", agent: GENERAL, readonly: false, t3Role: "general" },
  "swarm.racer": { kind: "panel", selector: PANEL, agent: GENERAL, readonly: false, t3Role: "general" },
  "no-comments.sicko": { kind: "seat", selector: "standard", agent: "no-comments/agents/comment-sicko.md", readonly: false, t3Role: "review" },
};

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join("\n"));
  }
}

class UsageError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNameList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string");

const isTier = (value: string): value is Tier => (TIERS as readonly string[]).includes(value);

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const defaultTiers = (): Record<Tier, readonly string[]> => ({
  fast: [INHERIT],
  standard: [INHERIT],
  deep: [INHERIT],
});

function parseModel(name: string, entry: unknown, problems: string[]): Model | null {
  const where = `models.${name}`;
  if (RESERVED.has(name)) problems.push(`${where}: "${name}" is reserved for tiers, the panel, and inherit`);
  if (!MODEL_NAME.test(name)) problems.push(`${where}: use lowercase letters, digits, ".", "_", or "-"`);
  if (!isRecord(entry)) {
    problems.push(`${where}: must be a table with provider and model`);
    return null;
  }
  for (const key of Object.keys(entry)) {
    if (!["provider", "driver", "model", "options"].includes(key)) problems.push(`${where}: unknown key "${key}"`);
  }
  const { provider, driver, model, options = {} } = entry;
  if (typeof provider !== "string" || provider === "") problems.push(`${where}.provider: required string`);
  if (typeof model !== "string" || model === "") problems.push(`${where}.model: required string`);
  if (driver !== undefined && typeof driver !== "string") problems.push(`${where}.driver: must be a string`);
  if (!isRecord(options) || !Object.values(options).every((v) => typeof v === "string" || typeof v === "boolean")) {
    problems.push(`${where}.options: must be a table of strings or booleans`);
    return null;
  }
  if (typeof provider !== "string" || typeof model !== "string") return null;
  return {
    name,
    provider,
    driver: typeof driver === "string" ? driver : provider,
    id: model,
    options: options as Record<string, OptionValue>,
  };
}

export function parseConfig(text: string | null, source: string | null): Config {
  if (text === null) {
    return { source: null, models: new Map(), tiers: defaultTiers(), panel: [INHERIT], roles: new Map() };
  }
  let raw: unknown;
  try {
    raw = Bun.TOML.parse(text);
  } catch (error) {
    throw new ConfigError([`invalid TOML: ${message(error)}`]);
  }
  if (!isRecord(raw)) throw new ConfigError(["config must be a TOML table"]);

  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!["panel", "tiers", "models", "roles"].includes(key)) problems.push(`unknown top-level key "${key}"`);
  }

  const models = new Map<string, Model>();
  if (raw.models !== undefined && !isRecord(raw.models)) problems.push("models: must be a table of [models.<name>] tables");
  for (const [name, entry] of Object.entries(isRecord(raw.models) ? raw.models : {})) {
    const model = parseModel(name, entry, problems);
    if (model) models.set(name, model);
  }

  const tiers = defaultTiers();
  if (raw.tiers !== undefined && !isRecord(raw.tiers)) problems.push("tiers: must be a table");
  for (const [tier, list] of Object.entries(isRecord(raw.tiers) ? raw.tiers : {})) {
    if (!isTier(tier)) problems.push(`tiers.${tier}: unknown tier, use ${TIERS.join(", ")}`);
    else if (!isNameList(list)) problems.push(`tiers.${tier}: must be a non-empty list of model names`);
    else tiers[tier] = list;
  }

  let panel: readonly string[] = [INHERIT];
  if (raw.panel !== undefined) {
    if (isNameList(raw.panel)) panel = raw.panel;
    else problems.push("panel: must be a non-empty list of model names");
  }

  const roles = new Map<string, Selector>();
  if (raw.roles !== undefined && !isRecord(raw.roles)) problems.push("roles: must be a table");
  for (const [role, selector] of Object.entries(isRecord(raw.roles) ? raw.roles : {})) {
    if (!(role in ROLES)) problems.push(`roles."${role}": unknown role, run \`models.ts check\` to list roles`);
    else if (typeof selector === "string" || isNameList(selector)) roles.set(role, selector);
    else problems.push(`roles."${role}": must be a tier, "panel", a model name, or a list of model names`);
  }

  const known = (name: string) => name === INHERIT || models.has(name);
  const requireModels = (where: string, names: readonly string[]) => {
    for (const name of names) if (!known(name)) problems.push(`${where}: unknown model "${name}"`);
  };
  for (const tier of TIERS) requireModels(`tiers.${tier}`, tiers[tier]);
  requireModels("panel", panel);
  for (const [role, selector] of roles) {
    if (typeof selector !== "string") requireModels(`roles."${role}"`, selector);
    else if (!isTier(selector) && selector !== PANEL && !known(selector)) {
      problems.push(`roles."${role}": "${selector}" is not a tier, "panel", or a model name`);
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return { source, models, tiers, panel, roles };
}

function selectorNames(config: Config, selector: Selector): readonly string[] {
  if (typeof selector !== "string") return selector;
  if (isTier(selector)) return config.tiers[selector];
  if (selector === PANEL) return config.panel;
  return [selector];
}

interface Link {
  readonly name: string;
  readonly seat: Seat;
}

interface SeatPlan {
  readonly role: string;
  readonly spec: RoleSpec;
  readonly opencode: string;
  readonly chain: readonly Link[];
}

const roleSlug = (role: string) => role.replaceAll(".", "-");

export function planRole(config: Config, role: string): readonly SeatPlan[] {
  const spec = ROLES[role];
  if (!spec) throw new UsageError(`unknown role "${role}". Roles: ${Object.keys(ROLES).join(", ")}`);
  const names = selectorNames(config, config.roles.get(role) ?? spec.selector);
  const link = (name: string): Link => ({
    name,
    seat: name === INHERIT ? INHERIT : (config.models.get(name) as Model),
  });
  if (spec.kind === "seat") {
    return [{ role, spec, opencode: `boti-${roleSlug(role)}`, chain: names.map(link) }];
  }
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    const suffix = count === 1 ? "" : `-${count}`;
    return { role, spec, opencode: `boti-${roleSlug(role)}-${name}${suffix}`, chain: [link(name)] };
  });
}

function t3Target(seat: Seat) {
  if (seat === INHERIT) return null;
  return Object.keys(seat.options).length === 0
    ? { providerInstanceId: seat.provider, model: seat.id }
    : { providerInstanceId: seat.provider, model: seat.id, options: seat.options };
}

function agentBody(path: string): string {
  const text = readFileSync(path, "utf8");
  const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(text);
  return (frontmatter ? text.slice(frontmatter[0].length) : text).trim();
}

export function brief(skillsRoot: string, role: string): string {
  const spec = ROLES[role];
  if (!spec) throw new UsageError(`unknown role "${role}"`);
  const path = join(skillsRoot, spec.agent);
  if (!existsSync(path)) throw new ConfigError([`${role}: agent file ${spec.agent} is missing`]);
  const body = agentBody(path);
  return spec.readonly ? `${body}\n\n${READONLY_RULE}` : body;
}

const opencodeRunnable = (seat: Seat, available: ReadonlySet<string> | null) =>
  seat === INHERIT || (seat.driver === "opencode" && (available === null || available.has(seat.id)));

function renderOpencodeAgent(plan: SeatPlan, pick: Link, body: string): string {
  const lines = [
    "---",
    `description: ${JSON.stringify(`botistack ${plan.role} on ${pick.name}`)}`,
    "mode: subagent",
    "hidden: true",
  ];
  if (pick.seat !== INHERIT) {
    lines.push(`model: ${JSON.stringify(pick.seat.id)}`);
    const variant = pick.seat.options.variant;
    if (typeof variant === "string") lines.push(`variant: ${JSON.stringify(variant)}`);
  }
  if (plan.spec.readonly) lines.push("permission:", "  edit: deny");
  lines.push("---", "", GENERATED_MARKER, "", body);
  return `${lines.join("\n")}\n`;
}

export interface SyncReport {
  readonly written: readonly string[];
  readonly unchanged: readonly string[];
  readonly removed: readonly string[];
  readonly skipped: readonly string[];
}

export function syncOpencode(
  config: Config,
  options: { readonly skillsRoot: string; readonly dir: string; readonly available: ReadonlySet<string> | null },
): SyncReport {
  mkdirSync(options.dir, { recursive: true });
  const written: string[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];
  const kept = new Set<string>();

  for (const role of Object.keys(ROLES)) {
    for (const plan of planRole(config, role)) {
      const pick = plan.chain.find((link) => opencodeRunnable(link.seat, options.available));
      if (!pick) {
        const tried = plan.chain.map((link) => link.name).join(", ");
        skipped.push(`${plan.opencode}: no model OpenCode can run in [${tried}]`);
        continue;
      }
      const file = `${plan.opencode}.md`;
      const path = join(options.dir, file);
      const content = renderOpencodeAgent(plan, pick, brief(options.skillsRoot, role));
      kept.add(file);
      if (existsSync(path) && readFileSync(path, "utf8") === content) {
        unchanged.push(file);
        continue;
      }
      writeFileSync(path, content);
      written.push(file);
    }
  }

  const removed: string[] = [];
  for (const file of readdirSync(options.dir)) {
    if (!file.startsWith("boti-") || !file.endsWith(".md") || kept.has(file)) continue;
    const path = join(options.dir, file);
    if (readFileSync(path, "utf8").includes(GENERATED_PREFIX)) {
      rmSync(path);
      removed.push(file);
    }
  }
  return { written, unchanged, removed, skipped };
}

function listOpencodeModels(): ReadonlySet<string> | null {
  try {
    const result = Bun.spawnSync(["opencode", "models"], { stdout: "pipe", stderr: "pipe" });
    if (!result.success) return null;
    const ids = parseModelList(result.stdout.toString());
    return ids.size > 0 ? ids : null;
  } catch {
    return null;
  }
}

const parseModelList = (text: string): ReadonlySet<string> =>
  new Set(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\S+\/\S+$/.test(line)),
  );

function describe(config: Config, role: string): string {
  const plans = planRole(config, role);
  const names = plans.flatMap((plan) => plan.chain.map((link) => link.name));
  return plans[0]?.spec.kind === "seat" ? names.join(" -> ") : names.join(", ");
}

export function checkReport(config: Config, skillsRoot: string): { readonly lines: readonly string[]; readonly problems: readonly string[] } {
  const problems: string[] = [];
  for (const [role, spec] of Object.entries(ROLES)) {
    if (!existsSync(join(skillsRoot, spec.agent))) problems.push(`${role}: agent file ${spec.agent} is missing`);
  }
  const width = Math.max(...Object.keys(ROLES).map((role) => role.length));
  const lines = [
    config.source === null
      ? "config: none. Every role runs on the parent's model. Run /setup-botistack to choose models."
      : `config: ${config.source}`,
    "",
    `${"role".padEnd(width)}  kind   models`,
    ...Object.entries(ROLES).map(
      ([role, spec]) => `${role.padEnd(width)}  ${spec.kind.padEnd(5)}  ${describe(config, role)}`,
    ),
  ];
  const warnings = Object.entries(ROLES)
    .filter(([, spec]) => spec.kind === "panel")
    .map(([role]) => role)
    .filter((role) => new Set(planRole(config, role).map((plan) => plan.chain[0]?.name)).size < 2)
    .map((role) => `warning: ${role} has fewer than two distinct models, so its seats share blind spots`);
  if (config.source !== null && warnings.length > 0) lines.push("", ...warnings);
  return { lines, problems };
}

interface Args {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string>;
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} needs a value`);
    flags.set(arg.slice(2), value);
    index++;
  }
  const [command, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

const USAGE = `usage: models.ts <command> [options]

  resolve <role>...   one JSON line per seat: agent file, read-only flag, T3 targets, OpenCode agent name
  brief <role>        the role's instructions, ready to open a delegated task
  check               validate the config and print every role's models
  sync                generate OpenCode subagents (boti-*.md) from the config

options:
  --config <path>        default $XDG_CONFIG_HOME/botistack/models.toml
  --opencode-dir <path>  default $XDG_CONFIG_HOME/opencode/agents
  --available <path>     model ids for sync, one per line (default: \`opencode models\`)`;

export function main(argv: readonly string[], io = { out: console.log, err: console.error }): number {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const skillsRoot = resolve(import.meta.dir, "..", "..");
  try {
    const args = parseArgs(argv);
    const explicitConfig = args.flags.get("config");
    const configPath = explicitConfig ?? join(configHome, "botistack", "models.toml");
    const opencodeDir = args.flags.get("opencode-dir") ?? join(configHome, "opencode", "agents");
    if (explicitConfig !== undefined && !existsSync(explicitConfig)) throw new ConfigError([`config ${explicitConfig} does not exist`]);
    const config = parseConfig(existsSync(configPath) ? readFileSync(configPath, "utf8") : null, configPath);

    switch (args.command) {
      case "resolve": {
        if (args.positionals.length === 0) throw new UsageError("resolve needs at least one role");
        for (const role of args.positionals) {
          for (const plan of planRole(config, role)) {
            io.out(
              JSON.stringify({
                role,
                agent: join(skillsRoot, plan.spec.agent),
                readonly: plan.spec.readonly,
                t3Role: plan.spec.t3Role,
                opencode: existsSync(join(opencodeDir, `${plan.opencode}.md`)) ? plan.opencode : null,
                chain: plan.chain.map((link) => ({ model: link.name, target: t3Target(link.seat) })),
              }),
            );
          }
        }
        return 0;
      }
      case "brief": {
        const [role] = args.positionals;
        if (role === undefined || args.positionals.length > 1) throw new UsageError("brief needs exactly one role");
        io.out(brief(skillsRoot, role));
        return 0;
      }
      case "check": {
        const report = checkReport(config, skillsRoot);
        for (const line of report.lines) io.out(line);
        for (const problem of report.problems) io.err(`error: ${problem}`);
        return report.problems.length > 0 ? 1 : 0;
      }
      case "sync": {
        const availablePath = args.flags.get("available");
        const available = availablePath ? parseModelList(readFileSync(availablePath, "utf8")) : listOpencodeModels();
        if (available === null) io.err("warning: `opencode models` failed, so model availability was not checked");
        const report = syncOpencode(config, { skillsRoot, dir: opencodeDir, available });
        io.out(`opencode agents: ${opencodeDir}`);
        io.out(`written ${report.written.length}, unchanged ${report.unchanged.length}, removed ${report.removed.length}, skipped ${report.skipped.length}`);
        for (const file of report.written) io.out(`  wrote ${file}`);
        for (const file of report.removed) io.out(`  removed ${file}`);
        for (const line of report.skipped) io.out(`  skipped ${line}`);
        return 0;
      }
      default:
        throw new UsageError(args.command === undefined ? "missing command" : `unknown command "${args.command}"`);
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      for (const problem of error.problems) io.err(`error: ${problem}`);
      return 1;
    }
    if (error instanceof UsageError) {
      io.err(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
