# Glossary

Each concept is defined once, here. Specs use these terms capitalized and with exactly this meaning. Add a new concept in the same change that first uses it.

**Acceptance criterion**: A checkable condition under a Requirement, ID'd `<CODE>-n.m`, verified by a test or by looking at the running app.

**Building block**: A CLI with a stable `--json` contract that Lookout consumes and other people's UIs could consume too: Fleet, `tb-session`, the ports CLI. Building blocks live outside this repo.

**Controllable**: A Session Lookout can bring to the front and type into, because Fleet knows its terminal (backend `tmux` or `iterm`). Sessions in other apps, such as Claude Desktop or IDE terminals, aren't.

**Harness**: The agent CLI a Session runs: Claude Code or Codex. (Fleet also knows pi; not a goal for Lookout.)

**History**: Past Sessions, found by searching their Transcripts, and resumable.

**Host**: A machine that runs Sessions. For now only this Mac.

**Local server**: A process listening on a TCP port on this machine. It belongs to a Worktree, and through it to a Session, when its working directory is inside that Worktree.

**Needs you**: The Status of a Session that is blocked on you: a permission prompt, a question, or input.

**Requirement**: One capability a feature provides, ID'd `<CODE>-n`.

**Session**: One agent conversation: a Harness process with a session ID and a working directory. Every Session Lookout starts runs in its own Session host.

**Session host**: The tmux session a Session runs in. Lookout never shows tmux itself.

**Start directory**: A directory listed in Settings where Lookout can start new Sessions. `~/Projects/work` by default.

**Status**: What a Session is doing: *Busy* (working), *Needs you*, *Idle* (finished its turn), or *Dormant* (was running before a reboot and can be resumed). Comes from Fleet.

**Transcript**: The JSONL log a Harness writes for a Session, for example under `~/.claude/projects/` or `~/.codex/sessions/`.

**Worktree**: A git worktree. A Session's working directory is often one.
