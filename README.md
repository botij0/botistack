# botistack

Adaptation of Cursor's pstack plugin made by Lauren Tan to my own needs. Harness-agnostic, built first for T3 Code, and compatible with OpenCode.

## Install

Symlink or copy every folder in `skills/` into one skills directory. `~/.agents/skills/` works for OpenCode and Cursor. Keep them together, because the delegate script finds each role's agent file relative to its own location.

```bash
for skill in skills/*/; do ln -sfn "$PWD/$skill" ~/.agents/skills/; done
```

Then run `/setup-botistack` to choose models. It needs [Bun](https://bun.sh).

## Models

Skills never name a model. Each subagent spawn names a **role**, and one config file maps roles to models, so a new model is a one-line edit.

`~/.config/botistack/models.toml` has four parts. `skills/delegate/models.example.toml` documents the format.

- `[models.<name>]` holds the provider, model id, and options such as effort. Model ids live only here.
- `[tiers]` maps `fast`, `standard`, and `deep` to a fallback list of model names. Code delegates pick a tier by difficulty, per the **delegate** skill's tier guide.
- `panel` lists the models for multi-model work. Arena, architect, interrogate, and swarm races spawn one subagent per entry.
- `[roles]` overrides any role, e.g. a bigger interrogate panel or a cheaper how explorer.

`inherit` in any list means the parent's model. With no config file, every role inherits.

```bash
cd skills/delegate
bun scripts/models.ts check    # every role with its models, and any config errors
bun scripts/models.ts sync     # regenerate the OpenCode agents
bun test                       # the script's tests
```

When a model changes, edit its `[models.*]` entry, then run `check` and `sync`.

## How spawning works

The **delegate** skill picks the first backend available.

1. **T3 Code orchestrator.** `delegate_task` on the `t3-code` MCP server runs each seat on its configured provider and model, with worktree isolation for parallel writers. It needs Orchestrator V2, T3 Code 0.0.46 nightly or later.
2. **OpenCode agents.** OpenCode's `task` tool cannot choose a model per call, so `sync` writes one `boti-*.md` agent per seat into `~/.config/opencode/agents/`, with the model, effort, instructions, and read-only permission baked in. It only removes agents it generated.
3. **The harness's own subagent tool** with the role's instructions, on the parent's model.
4. **Inline**, when there is no subagent tool.

Role instructions live with their skill, in `skills/<skill>/agents/`.

Long programs (orchestrate, both autopilots, and multi-phase plans) run in full on T3 Code with Orchestrator V2, which gives async owners, a scheduled 30-minute audit tick, and restart recovery. Without it they run in waves, one blocking batch of children at a time. `skills/boti-mode/references/program-runtime.md` has the details.

## Checks

`bun skills/boti-mode/scripts/check-skills.ts` validates every skill's frontmatter, relative links, referenced paths, and bold skill names. Pass skill names to check only those.

## Pending

Done: how and why agents, architect runner agent, arena and swarm on local subagents, interrogate and no-comments roles, the Comment Sicko agent, the boti-mode Subagents section, the model choices in the bug-fix, feature, perf-issue, refactoring, hillclimb, and multi-phase-plan playbooks, architect's delegated fill-in with a deviations log, local program runtime for orchestrate, the autopilots, shipping, and multi-phase plans, skill format rules and checks for authoring a skill, and T3 and OpenCode transcripts for session pickup, eval, recall, and show-me-your-work.

- `Why` skill. The source playbooks need adapting to the sources we use (Shortcut, Google Docs...). Inside `references/sources/`, add one playbook per source just like the examples. `source-playbook.md` still points at example files that don't exist.

- `Boti-mode`:
  - `/loop` is Cursor's command. Autonomous-run, babysit, bug-fix, and visual-parity still name it. `references/program-runtime.md` covers the wake they need.
  - Worktree cleanup. `scripts/worktree-audit.sh` reads Cursor's transcript dir and uses macOS-only `stat -f` and `date -r`. The playbook's cache step names Cursor's app data.
  - Bugbot is Cursor's reviewer. Babysit, the autopilots, and `references/bugbot-triage.md` assume it, and `watch-pr` counts its passes.
