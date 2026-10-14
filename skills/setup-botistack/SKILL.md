---
name: setup-botistack
description: "Choose which models botistack's subagents run on, per difficulty tier and for the multi-model panel. Discovers available models, writes ~/.config/botistack/models.toml, and generates the OpenCode agents. Use for /setup-botistack, 'configure botistack models', or when a model is added, retired, or renamed."
---

# Setup botistack

Write `~/.config/botistack/models.toml`, the only place botistack names models. The **delegate** skill resolves every subagent spawn through it. Its `models.example.toml` is the format reference. The scripts below live in the delegate skill's directory.

## Steps

### 1. Discover models

Use the first source that works, and merge in the others when they add providers.

- **T3 Code.** Call `orchestrator_capabilities` on the `t3-code` MCP server. Keep only provider instances that can run child tasks. Record each instance id, its model ids, and the option ids and values each model advertises, such as `variant`, `effort`, or `reasoningEffort`.
- **OpenCode.** Run `opencode models <provider> --verbose`. Each `provider/model` line is a model id for provider `opencode`, and the JSON after it lists the model's `variants`, its effort levels. Variants differ per model, and some models have none. It may need network access.
- **The user.** Ask them to paste the model ids they can use.

Never write a model id you have not confirmed is available.

### 2. Load current state

If the config exists, run `bun scripts/models.ts check` and treat its models, tiers, panel, and role overrides as the current choices. Flag any model id that discovery no longer lists.

### 3. Choose

Ask with structured questions where the harness offers them. Show the current choice for each slot.

- **fast**: the cheapest model that writes correct code from a full spec.
- **standard**: a strong general coding model.
- **deep**: the strongest reasoning model. It also writes prose and synthesis.
- **panel**: three or more models from different families, for arena, architect, and interrogate. Same-family models share blind spots.
- **Effort** per model, from the option values discovery found.

Each tier is a fallback list. A seat runs on its first available model, so add a second model, or `inherit` for the parent's model, when the first may go unavailable. Role overrides are optional. Offer them only when the user asks for one, e.g. a larger interrogate panel.

### 4. Write the config

Give each model a short lowercase name and write the file in the example's shape. Overwrite the whole file so reruns stay idempotent. `$XDG_CONFIG_HOME` replaces `~/.config` when set.

### 5. Validate and sync

Run `bun scripts/models.ts check`. It reports every problem at once. Fix them and rerun until it passes, and show the user its role table.

When the user runs OpenCode, inside T3 Code or not, run `bun scripts/models.ts sync`. It writes one `boti-*.md` agent per seat into `~/.config/opencode/agents/`, removes stale ones, and never touches agents it did not generate. Report what it wrote and skipped.

### 6. Confirm

Tell the user the config was written. T3 Code spawns read it on the next spawn. New OpenCode sessions pick up the synced agents. To change a model later, edit its `[models.*]` entry and rerun step 5, or rerun this skill.
