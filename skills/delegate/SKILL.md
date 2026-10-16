---
name: delegate
description: "How botistack skills spawn subagents. Resolves a role to models from the user's config, then spawns through T3 Code's orchestrator, generated OpenCode agents, or the harness's own subagent tool. Read before any step that spawns a subagent, or when choosing the fast, standard, or deep tier for a delegate."
---

# Delegate

Skills never name a model. A spawn step names a **role**, and the user's config maps roles to models. Model IDs live in one file, `~/.config/botistack/models.toml`, so a new model is a one-line edit there and nothing else changes. `/setup-botistack` writes it. With no config, every role runs on the parent's model.

Bun is required. Run the commands below from this skill's directory.

## Resolve

`bun scripts/models.ts resolve <role>` prints one JSON line per seat. A seat role prints one line. A panel role prints one line per panel model, and each line is its own subagent.

- `agent`: the role's instructions.
- `readonly`: the seat must not write.
- `t3Role`: the value for T3's `role`.
- `opencode`: the generated OpenCode agent for this seat, or `null` when sync hasn't generated it.
- `chain`: models to try in order. A `null` target means the parent's model.

`bun scripts/models.ts brief <role>` prints the role's instructions ready to open a task, with the read-only rule appended for read-only roles.

`bun scripts/models.ts check` prints every role's models and validates the config.

## Pick a backend

Use the first that applies, and use it for every seat in the step.

1. **T3 Code orchestrator.** The `t3-code` MCP server exposes `delegate_task`. Runs any chain model on any provider, with worktree isolation and async completion.
2. **OpenCode, generated agent.** You run in OpenCode and the seat's `opencode` field is set. The agent has the model and instructions baked in.
3. **Native subagent tool.** OpenCode's `subagent` tool with `agent` set to `general`, or the harness's equivalent. Runs on the parent's model unless the tool takes a model from the chain.
4. **Inline.** No subagent tool. Do each seat's work yourself, one at a time.

Say in your report when a seat ran on a fallback: a later chain model, the parent's model, or inline. A panel whose seats collapse onto one model loses its independent views, and the reader needs to know.

## Spawn

**T3 Code.** One `delegate_task` per seat.

- `task`: the `brief` output, then `## Inputs` with this step's inputs.
- `target`: the first chain entry's target. Omit it for a `null` target. On `provider_unavailable` or `model_unavailable`, retry with the next chain entry.
- `role`: `t3Role`. `title`: the role and model.
- `clientRequestId`: distinct per seat and per round, stable across retries of that seat, e.g. `<skill>-<slug>-<seat>-r<round>`.
- `isolation: "worktree"` for seats that write in parallel. The worktree starts from your last commit, so commit what the seats must see first. Leave `runtimeMode` unset. It is not a read-only switch. The brief carries the read-only rule.
- `mode: "wait"` when a single seat's result gates your next step. For a fan-out, launch every seat with `mode: "async"` in one turn and end the turn. Each completion wakes you. Read every `taskId` with `task_status` and continue once all are terminal.
- A second review round is a new `delegate_task` with the original brief, the prior findings, and the responses. Don't reuse the child thread.

**OpenCode, generated agent.** Call the `subagent` tool. `agent` is the `opencode` name. `description` is a short label. `prompt` is this step's inputs. The agent already carries the brief. `background: true` returns immediately and notifies you when the child finishes. The call returns a `sessionID`. Pass it back as `sessionID` to continue that same child. Put every seat's call in one message so they run together. OpenCode's default nesting depth is one, so a generated agent cannot spawn its own children.

**Native subagent tool.** The `brief` output plus `## Inputs` as the prompt, in one message for parallel seats. On OpenCode that is the same `subagent` call with `agent` set to `general`.

**Writers on the same checkout.** Outside T3 isolation, give each writing seat its own `git worktree add` path and branch, and pass the path as an input, per the **separate-before-serializing-shared-state** principle skill. Seats commit in their worktree and report the branch.

Launch at most 4 writing seats at once on one machine unless the user says otherwise. Run the rest in waves. A seat that fails or returns nothing is a dropout. Proceed without it and note it.

## Choose a tier

Code delegates resolve one of three roles: `fast`, `standard`, or `deep`. Pick by what the work needs, not by its size.

- **fast**: mechanical, fully specified work. Renames, moves, applying a written plan, boilerplate, tests that mirror an existing pattern, lookups.
- **standard**: a clear spec with local judgment. A feature inside one module, a bug fix with a known repro, tests that need case design.
- **deep**: work where a wrong call is expensive or hard to see. Cross-cutting design, concurrency, subtle algorithms, security-sensitive code, vague intent, and prose or synthesis a person will read.

When unsure, go one tier up. A cheap tier that misses costs a review round. After a delegate fails review twice on the same issue, rerun it one tier up with the findings in the brief. Don't escalate for missing context. Fix the brief.

## When models change

Edit the `[models.*]` entries in `~/.config/botistack/models.toml`. Tiers, the panel, and role overrides refer to models by name, so they don't change. Then run `bun scripts/models.ts check` and `bun scripts/models.ts sync`. Sync regenerates the OpenCode agents and removes the stale ones. New OpenCode sessions pick them up. `models.example.toml` documents the format.
