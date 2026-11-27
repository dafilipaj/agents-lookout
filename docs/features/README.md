# Features

One row per feature. Update the status here and in the spec's frontmatter together. "—" means no spec exists yet.

| Feature | Code | Status | Spec |
|---|---|---|---|
| Session sidebar: every Session at a glance, switch between them | SIDE | In Progress | [SPEC](session-sidebar/SPEC.md) |
| Session view: the selected Session's chat, composer and terminal preview | VIEW | In Progress | [SPEC](session-view/SPEC.md) |
| Start Claude Code and Codex Sessions | LAUNCH | In Progress | [SPEC](launch-session/SPEC.md) |
| Open a Session in iTerm2 | ITERM | Parked | [SPEC](open-in-iterm/SPEC.md) |
| History: search past Sessions, select one, resume with a button | HIST | In Progress | [SPEC](history/SPEC.md) |
| Local servers: overview, kill on click | PORTS | In Progress | [SPEC](local-servers/SPEC.md) |
| Usage at a glance: Claude, Codex and Jev limits | USAGE | In Progress | [SPEC](usage/SPEC.md) |
| Tasks and PRs: your Productive Tasks, PRs and Review requests, Linked to their Sessions | WORK | In Progress | [SPEC](tasks-and-prs/SPEC.md) |
| Behaviour tests: every requirement checked end to end ([0007](../decisions/0007-behaviour-tests-from-spec-requirements.md)) | TEST | In Progress | [SPEC](behaviour-tests/SPEC.md) |
| Design system: one type scale, colour by meaning and shared components, guarded by tests ([0009](../decisions/0009-one-design-system-guarded-by-tests.md)) | DS | In Progress | [SPEC](design-system/SPEC.md) |
| Library: everything Sessions produced, searchable, each item linked to its Session | LIB | In Progress | [SPEC](library/SPEC.md) |
| Memory overview: what the Sessions cost the Mac, under the usage strip, with a breakdown per Session | MEM | In Progress | [SPEC](memory-overview/SPEC.md) |
| Tools: the CLIs Lookout runs, their versions, what's missing or behind, and the command that fixes it | TOOLS | In Progress | [SPEC](tools/SPEC.md) |
| Topics: a Session, its PR, its Task and its run as one Topic with notes, recommended by Links and Jev, Topics linked into a graph | TOPIC | In Progress | [SPEC](topics/SPEC.md) |
| Changed files: a Session's changed lines on its row and status line, its changed files listed, each opening its Changes in VS Code | DIFF | In Progress | [SPEC](changed-files/SPEC.md) |
| Spec view: a `.plain` Module and its change, with other Modules' Concepts on hover, opened from a Session's changed files or a PR | PLAIN | In Progress | [SPEC](plain-specs/SPEC.md) |
| Test queue: what `res`, the machine-wide queue for heavy jobs, runs and who waits, in the Memory line and on a waiting Session | RES | In Progress | [SPEC](test-queue/SPEC.md) |
| Keep the Mac awake: one switch in the bottom-right corner holds off idle sleep, or lid-closed sleep on the charger through Amphetamine, while Sessions are at work | AWAKE | In Progress | [SPEC](keep-awake/SPEC.md) |
| Setup: the skills, agents, hooks and MCP servers Claude Code and Codex load, in a right-sidebar tab, with a Claude Code skill or plugin turned off and on | SETUP | In Progress | [SPEC](setup/SPEC.md) |
| Architecture: a repo's structural problems as ranked Findings, new and growing first, and what a Session's Changes do to them | ARCH | Draft | [SPEC](architecture/SPEC.md) |
| Pings: threads in watched Slack channels that mention you, listed beside your Sessions, each opening, resuming or starting the Session that answers it | PING | Draft | [SPEC](pings/SPEC.md) |
| Evidence: what backs an Idle or Done Session's work, its Test runs and how each ended, whether its Changes changed after the last one, and its test files, read from its Transcript and Checkouts, as a verdict in its status line and a mark on its row | EVID | Ready | [SPEC](done-evidence/SPEC.md) |
| Hand off: a Session's work, or a piece of it, continued in a new Session from a Handover the Session writes, the two linked both ways | HAND | In Progress | [SPEC](session-handoff/SPEC.md) |
| Places: a rail at the window's left edge switches between the Inbox and Sessions, each owning the left column and the main pane, with one right sidebar ([0017](../decisions/0017-one-app-for-both-roles.md)) | NAV | In Progress | [SPEC](places/SPEC.md) |
| Bots: Sessions that start on a schedule or on Run now, made and watched in a right-sidebar tab, each run followed, ended and reported to the Inbox | BOT | In Progress | [SPEC](bots/SPEC.md) |
| Inbox: one Report per Bot run, unread until opened, read in place in the main pane, with its Session a press away | INBOX | In Progress | [SPEC](inbox/SPEC.md) |
| Document view: a Markdown file, a page or an image opens in the main pane, from a path in a chat, the Library and a Topic view, instead of VS Code or a browser tab | DOC | In Progress | [SPEC](document-view/SPEC.md) |
