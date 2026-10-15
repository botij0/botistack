import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkSkills, main } from "./check-skills.ts";

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "check-skills-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const skill = (name: string, body = "", description = "Does a thing. Use for /thing.") =>
  `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n\n${body}\n`;

const messages = (root: string, only?: readonly string[]) => checkSkills(root, only).problems.map((p) => p.message);

describe("check-skills", () => {
  test("a skill whose references all resolve passes", () => {
    const root = tree({
      "alpha/SKILL.md": skill(
        "alpha",
        "Read [the guide](references/guide.md#start), then `references/guide.md`. Run `scripts/run.ts --fast`. Per the **beta** skill and the **careful** principle skill.",
      ),
      "alpha/references/guide.md": "Back to [alpha](../SKILL.md). See `../scripts/run.ts`.",
      "alpha/scripts/run.ts": "",
      "beta/SKILL.md": skill("beta", "Plain [site](https://example.com) and [anchor](#top)."),
      "principle-careful/SKILL.md": skill("principle-careful"),
    });
    expect(messages(root)).toEqual([]);
  });

  test("frontmatter must name the directory and describe the skill", () => {
    const root = tree({
      "alpha/SKILL.md": skill("alfa"),
      "Bad_Name/SKILL.md": skill("Bad_Name"),
      "gamma/SKILL.md": skill("gamma", "", ""),
      "delta/SKILL.md": skill("delta", "", "x".repeat(1025)),
      "epsilon/SKILL.md": "# epsilon\n",
    });
    expect(messages(root)).toEqual([
      'name "Bad_Name" is not 1 to 64 lowercase letters, digits, and single hyphens',
      'name "alfa" does not match directory "alpha"',
      "description is 1025 characters, over 1024",
      "no YAML frontmatter",
      "frontmatter lacks description",
    ]);
  });

  test("a skill file with the wrong case is reported instead of skipped", () => {
    const root = tree({ "alpha/SKILL.MD": skill("alpha") });
    expect(messages(root)).toEqual(["rename SKILL.MD to SKILL.md"]);
  });

  test("dangling links, paths, and skill names are reported with their line", () => {
    const root = tree({
      "alpha/SKILL.md": skill("alpha", "See [gone](references/gone.md).\nRun `playbooks/missing.md`.\nPer the **ghost** skill and **principle-absent**."),
    });
    const { problems } = checkSkills(root);
    expect(problems.map((p) => [p.line, p.message])).toEqual([
      [8, "link target references/gone.md does not exist"],
      [9, "path playbooks/missing.md does not exist"],
      [10, "skill ghost does not exist"],
      [10, "skill principle-absent does not exist"],
    ]);
  });

  test("placeholders, code blocks, and bare-word links are not references", () => {
    const root = tree({
      "alpha/SKILL.md": skill(
        "alpha",
        "Write `references/<name>.md` and `scripts/*.ts`. Cite [PR #1](url) or [t](t3-thread://v1/abc). Show `[x](gone.md)`.\n\n```\nsee [x](references/nope.md) and `playbooks/nope.md`\n```",
      ),
    });
    expect(messages(root)).toEqual([]);
  });

  test("naming skills checks only those, but resolves names against every skill", () => {
    const root = tree({
      "alpha/SKILL.md": skill("alpha", "Per the **beta** skill."),
      "beta/SKILL.md": skill("beta", "See [gone](gone.md)."),
    });
    expect(messages(root, ["alpha"])).toEqual([]);
    expect(messages(root, ["zeta"])).toEqual(["no such skill"]);
  });

  test("the CLI exits nonzero and prints one line per problem", () => {
    const root = tree({ "alpha/SKILL.md": skill("alpha", "See [gone](gone.md).") });
    const out: string[] = [];
    const err: string[] = [];
    const code = main(["--root", root], { out: (line) => out.push(line), err: (line) => err.push(line) });
    expect(code).toBe(1);
    expect(err).toHaveLength(1);
    expect(err[0]).toEndWith("alpha/SKILL.md:8: link target gone.md does not exist");
    expect(out).toEqual(["1 skills, 1 problems"]);
  });
});
