# Program runtime

Long programs (Orchestrate, Autopilot-full, Autopilot-stack, Shipping, and multi-phase plans) need five things from the harness: children that run while the root keeps working, a wake on a cadence, liveness probes, a goal that survives turns, and recovery after a restart. This file says where each comes from.

## Pick the mode

**T3 Code with Orchestrator V2** (0.0.46 nightly or later, where the `t3-code` MCP server exposes `delegate_task` and `schedule_task`) runs a program in full. Use it whenever it is available.

**Without it** (OpenCode alone, or T3 Code 0.0.45), subagent calls block the root until they return. Run the program in **waves**. Spawn one wave of children in one message, then audit, drain, and decide between waves. There are no mid-wave probes and no self-wake, so timebox every brief and keep waves small. A stuck child stalls its wave. Say in the framing that the program runs in waves.

## Children

Spawn every child per the **delegate** skill. Writers get their own worktree. On T3 that is `isolation: "worktree"`, which starts from your last commit, so commit what children must see first. Launch with `mode: "async"`. A child can delegate its own children. Each completion wakes the root, so end the turn after spawning instead of polling.

To give an owner its next stage, message it rather than respawn it. A review round still gets a fresh child, per the delegate skill. On T3, call `t3_thread_send` with the child's `childThreadId`, which returns a fresh `taskId` to track. On OpenCode, pass the child's returned `task_id` back to the `task` tool, which resumes that session with its history.

Children never read the program dir. Their briefs carry what they need, pasted in full, or point at repo paths.

## Wake

On T3, arm the tick with `schedule_task`. Pass `schedule: {type: "interval", everyMs: 1800000}` for 30 minutes and the playbook's tick prompt as `prompt`. Leave `bindToCurrentThread` on, so each run posts into this thread. Pause it with `update_scheduled_task` and `enabled: false` on an operator hold. Delete it with `delete_scheduled_task` at close. Never leave the cadence to memory or to completion notifications alone.

In waves mode, the boundary between waves is the tick.

## Liveness

On T3, probe a child with `task_status` by its `taskId`, list the program's threads with `t3_thread_list`, and read a child's latest actions with `t3_thread_read` and `view: "activity"`. Status alone is not progress. Only side effects count: commits, pushes, PR or check deltas, and program-dir rows. Stop a stuck child with `task_cancel`.

## Goal

On the operator's go, write the full program objective to `goal.md` in the program dir. Every tick and every resume re-reads it in full, along with the playbook the program runs, read from the installed boti-mode skill rather than from memory.

## Program dir

Keep program state in `.botistack/<program-slug>/` at the root of the main checkout, the directory above `git rev-parse --path-format=absolute --git-common-dir`. Add `.botistack/` to `.git/info/exclude` so it never commits. It holds `goal.md`, the plan, the decision trail, and any store the playbook names. Leave it intact at close. It is the postmortem.

## Restart

T3 Code resumes active threads after an update, crash, or machine restart while **Continue threads after restarts** is on, the default. A thread without saved provider resume state needs a new message. After any restart, re-read `goal.md` and the program dir, then reattach work by branch and PR rather than by task id. Respawn what no longer runs, from its stored brief plus current state. In waves mode, a restart kills the wave. Rerun it from the briefs.
