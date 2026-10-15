### Authoring or modifying a skill

**You own the skill's voice.**

1. Write `skills/<name>/SKILL.md` in the format every harness loads. The file name is exactly `SKILL.md`. YAML frontmatter holds `name` and `description`. `name` matches the directory and is 1 to 64 lowercase letters, digits, and single hyphens. `description` says what the skill does and when to use it, including the phrases that should trigger it, in at most 1024 characters. A skill that runs only on request adds `disable-model-invocation: true`. Harnesses that don't know a key ignore it. Long reference material goes in `references/`, subagent instructions in `agents/`, and code in `scripts/`. A step that spawns names a role per the **delegate** skill, and a new role goes in `ROLES` in [delegate's `models.ts`](../../delegate/scripts/models.ts).
2. Run `bun <boti-mode skill dir>/scripts/check-skills.ts <name>` and fix every line it prints. It checks the frontmatter, relative links, `references/`, `agents/`, `playbooks/`, and `scripts/` paths, and that every bold skill name resolves. Run it with no name to check every skill.
3. Test cases if structural. Skip if subjective.
4. Run **Opening a PR**.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill. Delegate to other skills by path. Don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
