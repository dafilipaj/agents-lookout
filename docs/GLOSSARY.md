# Glossary

Each concept is defined once, here. Specs use these terms capitalized and with exactly this meaning. Add a new concept in the same change that first uses it.

**Acceptance criterion**: A checkable condition under a Requirement, ID'd `<CODE>-n.m`, verified by a test or by looking at the running app.

**Attachment**: A file you drop or paste into a Session's composer that Lookout copies, because the browser can't see its path (from Finder, or the clipboard): saved under `~/.lookout/attachments/<YYYY-MM-DD>/` and put into your message by its absolute path, so the Harness reads it with its own tools. Deleted after 14 days. A file dragged with its real path (from VS Code) isn't one: its own path goes in. See VIEW-9.

**Behaviour test**: An end-to-end test of one Acceptance criterion: Playwright drives the built Lookout inside a World. Its title starts with the criterion's ID. See the TEST spec.

**Branch point**: Where a Checkout's branch left its repo's default branch: the merge-base of HEAD with `origin/HEAD`'s branch, else a local `main` or `master`. On the default branch itself, or in a repo without one, it's HEAD. Changes are counted from it. See the DIFF spec.

**Building block**: A CLI with a stable `--json` contract that Lookout consumes and other people's UIs could consume too: Fleet, `tb-session`, the ports CLI. Building blocks live outside this repo.

**Changes**: What differs in a Checkout's working tree (tracked edits and untracked files, not ignored ones) from its Branch point: committed-but-unpushed and uncommitted work alike. A Session's Changes are those of its Checkouts, whoever made them. See the DIFF spec.

**Checkout**: A git working tree: a repo's main one or a Worktree. A Claude Code Session's Checkouts are those it edited files in, and its working directory's when it edited there or it isn't on its default branch (DIFF-2.1); a Codex Session's is its working directory's (DIFF-2.2).

**Controllable**: A Session Lookout can bring to the front and type into, because Fleet knows its terminal (backend `tmux` or `iterm`). Sessions in other apps, such as Claude Desktop or IDE terminals, aren't.

**Design system**: Lookout's shared look: the type scale and colour tokens in `web/src/index.css`, the components in `web/src/components/ui/`, and the rules for using them, written down in the DS spec and guarded by tests ([0009](decisions/0009-one-design-system-guarded-by-tests.md)).

**Edge**: A connection you draw from one Topic to another, with a direction and an optional label that reads from the first to the second. Shown on both Topics in the Topics tab and as a line in the graph. See TOPIC-6.

**Effort**: The reasoning effort a Session's model runs at, such as `medium`, `high` or `xhigh`. Changed with `/effort` in Claude Code, or in Codex's `/model` picker. Comes from Fleet, read from the Transcript.

**Fake Harness**: A stand-in for Claude Code or Codex in a World. It runs in the World's tmux, registers and writes Transcripts the way the real Harness does, and answers from a script, so the real Fleet and tb-session see it as a Session. It never calls a model.

**Harness**: The agent CLI a Session runs: Claude Code or Codex. (Fleet also knows pi; not a goal for Lookout.)

**Headless Session**: A Session started without a terminal to type into, such as `claude -p` or an Agent SDK run. History hides them by default.

**History**: Past Sessions, found by searching their Transcripts, and resumable.

**Host**: A machine that runs Sessions. For now only this Mac.

**Kind**: What an Output is: a file, an Artifact or a Share. tb-session's `events` records the actions behind them as `write` and `edit` (a file), `artifact` and `share`; Lookout groups them into Outputs by kind and key. Its `--kind` flag filters the actions.

**Library**: The right-sidebar tab, next to History and Work, that lists Outputs. See the LIB spec.

**Link**: A connection between a Task, a PR and a Session, found by id: a task id in a PR's branch or body (from `tb-pr`), the Session inferred to have opened a PR, or a Session started on a PR or Task (its URL in the first prompt). Each Link records why it exists. See the WORK spec.

**Local server**: A process listening on a TCP port on this machine. It belongs to a Worktree, and through it to a Session, when its working directory is inside that Worktree.

**Mark**: A bookmark on the rail beside the chat's scroll bar for a prompt you sent, a Subagent result or a question; clicking it scrolls the chat to that entry.

**Memory overview**: The line under the usage strip with what Lookout's and the Sessions' Process trees cost the Mac, and the breakdown it opens. See the MEM spec.

**Needs you**: The Status of a Session that is blocked on you: a permission prompt, a question, or input.

**Output**: A document file, an Artifact on claude.ai or a Backyard Share that a Session, or one of its Subagents, produced. tb-session's `events` lists the recorded actions, and Lookout's server turns them into Outputs: one per kind and key, with the Sessions that touched it. A file counts only when it has a document extension, isn't under a Harness home, still has its folder and isn't owned by git. An Artifact and the file it was published from are one Output, the Artifact's. See the LIB spec.

**Page**: An Output that opens as a page in a browser tab: an HTML file or an Artifact. The Library's "Pages" chip shows both.

**PR**: An open GitHub pull request in a `productiveio/*` repo that you opened, or that is a Review request to you, as `tb-pr` lists it.

**Pressure**: macOS's memory pressure level, `kern.memorystatus_vm_pressure_level`: normal (1), warn (2) or critical (4). Read by the Memory overview; critical forces its red.

**Process tree**: A process and every descendant of it, by parent pid, as one `ps` listing shows them at that instant. A Session's is rooted at its Harness process (Fleet's `pid`): the Harness, its MCP servers, the shells and test runners it started. Lookout's is rooted at its server. See the MEM spec.

**Recommendation**: A proposed Topic membership: an item new to Lookout (a Session, PR or Task in no Topic) and the Open Topic it probably belongs to, or a new Topic, with its reason: a Link, or Jev's judgment. Nothing happens until you accept it. See TOPIC-9.

**Requirement**: One capability a feature provides, ID'd `<CODE>-n`.

**Review request**: An open PR on which you are a requested reviewer by name, whoever requested you. Requests sent to a team you're in don't count.

**Session**: One agent conversation: a Harness process with a session ID and a working directory. Every Session Lookout starts runs in its own Session host.

**Session host**: The tmux session a Session runs in. Lookout never shows tmux itself.

**Start directory**: A directory listed in Settings where Lookout can start new Sessions. `~/Projects/work` by default.

**Status**: What a Session is doing: *Busy* (working), *Needs you*, *Idle* (done replying, though its Turn lasts until your next prompt; a background shell command it started may still run, SIDE-2.6), or *Dormant* (was running before a reboot and can be resumed). Comes from Fleet.

**Subagent**: A helper agent a Session starts and that reports back to it: Claude Code's Agent tool, in the foreground or the background, a fork included, and one a Subagent starts in turn (nested); or Codex's `spawn_agent`. A background shell command isn't one. Its own messages (the sidechain) aren't shown; its result shows in the chat as one line (VIEW-1.3), how many are running shows on its Session's row (SIDE-9) and status line (VIEW-8), and how many finished in the current Turn on the status line.

**Task**: A Productive task assigned to you that isn't closed.

**Tool**: A CLI Lookout runs on this Mac: Fleet, `claude`, `codex`, `tb-session`, `tb-pr`, `tb-prod`, `tb-jev`, `git` and `tmux`. Every Building block is a Tool; not every Tool is a Building block. See the TOOLS spec.

**Topic**: A wrapper you make by hand for one piece of your work: the Sessions, PR, Task and, later, `tb-flow` run that belong to it, all or some, with your notes and a state, Open or Archived. Its members are references to what the Building blocks know; Lookout keeps them in `~/.lookout/topics.db`. See the TOPIC spec.

**Topic summary**: Text a model writes about a Topic when you ask, from what Lookout knows of its members: what it is, where it stands, what's open, what happened last and what's next, each point citing members. Kept apart from the notes and rewritten whole. See TOPIC-11.

**Topic view**: A Topic shown whole in the main pane at `/topics/<id>`: its notes, its members by kind with their state, its Outputs, recommendations and Edges. The Topics tab's expanded Topic is its summary. See TOPIC-10.

**Transcript**: The JSONL log a Harness writes for a Session, for example under `~/.claude/projects/` or `~/.codex/sessions/`.

**Trust prompt**: The question a Harness asks before it runs in a folder it hasn't been told to trust: Claude Code's "Yes, I trust this folder" or "No, exit", listing what the folder's settings pre-approve; Codex's "Trust this folder?". Claude Code registers with Fleet only once it's answered, so a start waiting on it isn't a Session yet. Lookout answers it only when you click (LAUNCH-6), and the Harness remembers the answer per folder.

**Type**: What a file Output is, from its extension, by the table in LIB-2.10: `markdown`, `html`, `pdf` or `image`. Lookout derives it; tb-session's `events` has only the extension (`--ext`). In the Library an Artifact's and a Share's Type word is its Kind.

**Turn**: What a Session does for one prompt of yours: from that prompt, sent from Lookout or typed in its terminal, until your next one. Work the Session picks up on its own in between, such as a reply to a Subagent's result, belongs to the same Turn, and Idle doesn't end it. A tool's result, a task notification, another Session's message and a slash command the Harness handles itself (`/effort`) aren't prompts. Fleet finds where the current one starts (SIDE-9). Not Codex's own "turn" (`task_started` to `task_complete`), which ends whenever the agent stops.

**Work**: The right-sidebar tab, next to History, that lists your Tasks and PRs with their Links. See the WORK spec.

**Worktree**: A git worktree. A Session's working directory is often one.

**World**: The isolated environment a Behaviour test runs in: a temporary HOME, a PATH holding only the commands the test declares, a private tmux server, the pinned Fleet and tb-session, Fake Harnesses and fixture data. Anything the test doesn't declare is absent, so "Codex not installed" is a World without Codex.
