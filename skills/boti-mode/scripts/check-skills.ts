#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const LINK = /\]\(([^)\s]+)\)/g;
const CODE_SPAN = /`([^`\n]+)`/g;
const SKILL_PATH = /^(\.\.\/)?(references|agents|playbooks|scripts)\//;
const PLACEHOLDER = /[<>*{}]/;
const SKILL_MENTION = /\*\*([a-z0-9-]+)\*\* (principle )?skill/g;
const PRINCIPLE_MENTION = /\*\*(principle-[a-z0-9-]+)\*\*/g;

export interface Problem {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export function checkSkills(
  root: string,
  only?: readonly string[],
): { readonly skills: number; readonly problems: readonly Problem[] } {
  const problems: Problem[] = [];
  const names = new Set<string>();
  for (const entry of readdirSync(root).sort()) {
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    const skillFile = readdirSync(dir).find((file) => file.toLowerCase() === "skill.md");
    if (skillFile === "SKILL.md") names.add(entry);
    else if (skillFile) problems.push({ file: join(dir, skillFile), line: 1, message: `rename ${skillFile} to SKILL.md` });
  }
  const checked = only ?? [...names];
  for (const dir of checked) {
    if (!names.has(dir)) {
      problems.push({ file: join(root, dir), line: 1, message: "no such skill" });
      continue;
    }
    const skillRoot = join(root, dir);
    checkFrontmatter(join(skillRoot, "SKILL.md"), dir, problems);
    for (const file of markdownFiles(skillRoot)) checkReferences(file, skillRoot, names, problems);
  }
  return { skills: checked.length, problems };
}

function checkFrontmatter(file: string, dir: string, problems: Problem[]): void {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const fail = (message: string) => problems.push({ file, line: 1, message });
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (end === -1) return fail("no YAML frontmatter");
  let data: unknown;
  try {
    data = Bun.YAML.parse(lines.slice(1, end).join("\n"));
  } catch (error) {
    return fail(`frontmatter is not YAML: ${(error as Error).message}`);
  }
  const { name, description } = (data ?? {}) as Record<string, unknown>;
  if (typeof name !== "string") fail("frontmatter lacks name");
  else if (name !== dir) fail(`name "${name}" does not match directory "${dir}"`);
  else if (name.length > MAX_NAME || !NAME.test(name)) fail(`name "${name}" is not 1 to ${MAX_NAME} lowercase letters, digits, and single hyphens`);
  if (typeof description !== "string" || description.trim() === "") fail("frontmatter lacks description");
  else if (description.length > MAX_DESCRIPTION) fail(`description is ${description.length} characters, over ${MAX_DESCRIPTION}`);
}

function checkReferences(file: string, skillRoot: string, names: ReadonlySet<string>, problems: Problem[]): void {
  let fence = false;
  readFileSync(file, "utf8").split(/\r?\n/).forEach((text, index) => {
    if (/^\s*```/.test(text)) fence = !fence;
    if (fence) return;
    const fail = (message: string) => problems.push({ file, line: index + 1, message });
    for (const [, target] of text.replace(CODE_SPAN, "").matchAll(LINK)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || !/[./]/.test(target)) continue;
      const path = decodeURI(target.split("#")[0]);
      if (!existsSync(resolve(dirname(file), path))) fail(`link target ${target} does not exist`);
    }
    for (const [, span] of text.matchAll(CODE_SPAN)) {
      const path = span.split(/\s/)[0];
      if (!SKILL_PATH.test(path) || PLACEHOLDER.test(path)) continue;
      const candidates = [resolve(dirname(file), path), resolve(skillRoot, path)];
      if (!candidates.some((candidate) => existsSync(candidate))) fail(`path ${path} does not exist`);
    }
    for (const [, name, principle] of text.matchAll(SKILL_MENTION)) {
      const dir = principle && !name.startsWith("principle-") ? `principle-${name}` : name;
      if (!names.has(dir)) fail(`skill ${dir} does not exist`);
    }
    for (const [, name] of text.matchAll(PRINCIPLE_MENTION)) {
      if (!names.has(name)) fail(`skill ${name} does not exist`);
    }
  });
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return entry.endsWith(".md") ? [path] : [];
  });
}

export function main(argv: readonly string[], io = { out: console.log, err: console.error }): number {
  const args = [...argv];
  let root = join(import.meta.dir, "..", "..");
  const at = args.indexOf("--root");
  if (at !== -1) {
    if (!args[at + 1]) {
      io.err("Usage: bun check-skills.ts [--root <skills-dir>] [skill ...]");
      return 2;
    }
    root = resolve(args[at + 1]);
    args.splice(at, 2);
  }
  const { skills, problems } = checkSkills(root, args.length ? args : undefined);
  for (const p of problems) io.err(`${relative(process.cwd(), p.file)}:${p.line}: ${p.message}`);
  io.out(`${skills} skills, ${problems.length} problems`);
  return problems.length ? 1 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
