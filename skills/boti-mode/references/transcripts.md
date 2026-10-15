# Transcripts

Where a prior agent's trail lives, and how to read it. Read only this project's threads and sessions. Another project's are private chats, so never list or read them unless the user asks.

## T3 Code

A thread link looks like `[title](t3-thread://v1/<threadId>)`. Without one, find the thread with `t3_thread_list` on the current project. Narrow it with `titleContains`, and pass `includeSubagents: true` to see delegated children.

`t3_thread_read` with the `threadId` returns the thread's branch, worktree path, linked PR, and parent thread, plus a page of items. `view: "messages"` is the conversation. `view: "activity"` is what the agent did, tool calls and their results included. Page with `afterPosition` set to the previous page's `nextPosition`. A subagent's work is in its own thread, not its parent's.

## OpenCode

`opencode session list --format json -n 20` lists this project's sessions with `id`, `title`, and `updated`, newest first. Run it from the repo, because the list is scoped to the directory's project. `opencode run --continue` and `--session <id>` resume a session. They do not read it.

`opencode export <id> > <file>.json` writes the full session. Redirect to a file, because a pipe truncates it. The file holds `info` (title, directory, model, and time) and `messages`. Each message has `info.role` and `parts`, where a part is `text`, `reasoning`, or `tool`. A `tool` part names the `tool` and carries `state.input`, `state.output`, and `state.status`. A subagent ran in its own session. Find its id at `state.metadata.sessionId` on the parent's `task` part, and export that session too.

## Reading one

A transcript is bulk. Export or page it inside a subagent that returns a reduced timeline, per the **guard-the-context-window** principle skill. Grade what the agent did from the tool parts or the activity view, never from its own summary.
