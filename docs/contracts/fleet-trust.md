# Contract: `fleet trust`

The command Lookout's Starting view ([LAUNCH-6](../features/launch-session/SPEC.md)) uses to read and answer a Harness's Trust prompt in a Session host. It's built in the Fleet fork (`dafilipaj/fleet`, branch `lookout`, [0006](../decisions/0006-run-a-fork-of-fleet.md)) as one commit, and verified there, in Fleet's own tests; Lookout's fake `fleet` follows this file, and `pnpm req-check` never looks here (the criteria are LAUNCH-6). Points are numbered C1 to C10 so the commit's tests can cite them. Every field and flag is add-only: a later Fleet may add, never rename or drop.

Written 2026-10-27 from Dario's report of a resume stuck at Claude Code's Trust prompt, against the fork at `570ce97` (Lookout's pin in `e2e/pins.json`). Amended 2026-10-27 after real captures of Claude Code 2.1.311 (C9): the Fleet implementation follows those screens, and C2, C3, C4, C8 and C9 say what they showed. Before that, nothing here had been run against a live Claude Code.

## Why a new command

- Every verb that reads or types into a Session (`peek`, `keys`, `send`, `answer`) resolves its `<target>` among the Sessions Fleet lists (`core/discovery.rs`, `resolve_target`: a title, a session-id prefix, `pid:<n>`, `id:<session_id>`). Claude Code registers only after its Trust prompt is answered, so a Session waiting there can't be named: `target_not_found`.
- `spawn` never answers the Trust prompt (LAUNCH, 2026-10-16). Fleet's web spawner does (`web/lib/spawn.mjs`, `acceptTrustPrompt`): it polls `tmux capture-pane`; on "trust this folder" it waits 1.2 s (the dialog is drawn before it listens for keys), presses Down until the screen shows `❯ Yes, I trust`, then Enter; for Codex, Enter on a preselected `› 1. Trust and continue`. It always accepts, and it runs in the web server, which Lookout doesn't use (0004). Its screen matching is where C3 starts; its auto-accept is what C8 rules out.
- Lookout never types into tmux itself ([0001](../decisions/0001-tmux-as-hidden-session-host.md), [0004](../decisions/0004-fleet-cli-as-session-layer.md)), so the read and the keys are Fleet's.

**A verb of its own, not a new target form.** A `tmux:<name>` form for `answer` would reach every verb that takes a target, so `send` and `keys` could type into a pane where no Session has registered; and `answer`'s checks belong to a listed Session (its Transcript, `not_waiting`, the lock named after its id). `trust` reads one screen, the Trust prompt, and presses keys only on it.

## C1. Command and flags

```
fleet trust <tmux_session> --json [--pane <handle>] [--allow-attached] [-n]
            (--list | --accept --prompt <id> | --decline --prompt <id> [--close])
```

- `<tmux_session>`: a tmux session's exact name, as `spawn --json` printed it in `tmux_session`. It's matched exactly (`=<name>`), never as a prefix or fragment. It must hold one window with one pane, as `spawn` creates it; anything else is `host_unsupported`, nothing read.
- `--pane <handle>`: the pane id `spawn --json` printed in `handle` (`%12`). When given, the session's one pane must be that one, else `target_changed`, nothing read or typed: a Session host that was closed and another made under the same name is never answered.
- It works whether or not a Session Fleet lists runs in the pane: before Claude Code registers, none does.
- Local only: with `-H <host>` it's `usage`. `-n` runs every check and types nothing (`dry_run: true`).
- `--allow-attached`, as for `answer`: without it, a terminal client attached to that tmux session makes `--accept` and `--decline` refuse (`human_attached`). `--list` doesn't check.
- `--close` only with `--decline` (C5). A missing `--prompt`, two modes, or `--close` without `--decline` is `usage` (exit 2 when clap catches it).
- A Fleet without the command fails with clap's `error: unrecognized subcommand 'trust'` on stderr, exit 2. Lookout matches that line to fall back to today's behaviour (LAUNCH Technical approach).

## C2. What `--list` answers

```json
{ "ok": true, "host": "mac", "tmux_session": "new-repo", "handle": "%12",
  "prompt": { "kind": "trust", "harness": "claude", "id": "t1.9f2c01aa",
              "lines": ["Accessing workspace:",
                        "/Users/me/Projects/new-repo",
                        "…",
                        "⚠ This folder pre-approves 10 tool permissions in .claude/settings.json: Bash(…), Bash(…), …, and 2 more",
                        "These will apply without asking. Only proceed if you trust this configuration.",
                        "",
                        "Security guide"],
              "choices": [ { "label": "No, exit", "accept": false },
                           { "label": "Yes, I trust this folder", "accept": true } ],
              "selected": 0, "untouched": true },
  "answerable": true, "detail": null, "pane": { "cols": 200, "rows": 50 } }
```

- `prompt` is `null` when the screen shows no Trust prompt (`detail: "no_prompt"`, or `"shell"` when the pane's foreground is its shell).
- `harness`: whose Trust prompt it is, told by its answers (C3), not by what was typed.
- `lines`: the prompt's text from its top (C3) down to the line above its first answer, as drawn: frame characters at the edges and trailing blanks removed, a run of blank lines kept as one, lines tmux wrapped joined (`capture-pane -J`). Claude Code wraps its own text at the pane's width with real line breaks, so `lines` differ between 80 and 200 columns. In the captures the permissions warning wraps at both widths (mid-entry at 80) and ends ", and N more". At most 60 lines of at most 2,000 characters each; more is `clipped`. The text is the screen's: paths, permission rules, whatever the folder's settings name.
- `choices`: the answers in screen order, their labels as drawn (Claude Code 2.1.311 draws them unnumbered), and which one trusts (`accept`). `selected`: the index the cursor is on.
- `untouched`: the cursor on the answer the Harness preselects (Claude Code: "No, exit") and nothing typed.
- `id`: `t1.` and 8 hex digits, FNV-1a of `harness`, the dialog's paragraphs and the labels joined by `\n`, leaving out the frame and the pane's width, as `answer`'s `id` does. A paragraph is the dialog's wrapped lines joined with a space, a blank line ending it, so the same prompt has the same id at any pane width; an id over `lines` as wrapped couldn't. Another folder, other pre-approved permissions or other wording give another id.
- `answerable`: `--accept` and `--decline` would pass the screen checks now (C4 step 2): the prompt read whole, untouched and alone. Not the lock or the attached-client check.
- `detail`: why not, one code from C6; `null` when answerable.
- A Trust prompt recognised by its answers but not read whole is `{ "kind": "trust", "harness", "incomplete": true, "id": null, "lines": null, "choices": null, "selected": null, "untouched": false }` with `answerable: false` and `detail` `clipped` or `layout_unsupported`.
- One `--list` reads the screen once. From the same tmux call as the capture it also gets the pane's cursor position, height, mode (copy mode is `not_alone`) and current command (C3). It types nothing and takes no lock.

## C3. What counts as a Trust prompt

- **Claude Code:** an answer list whose labels are exactly "Yes, I trust this folder" and "No, exit", numbered (`1.`) or not, in either order, with the cursor marker `❯` on one of them, and under it at most the footer "Enter to confirm · Esc to cancel". Claude Code 2.1.311 draws, from the top: a full-width `─` rule, the heading "Accessing workspace:" alone on its line with the folder's path on the next, its text and warnings, then the answers, unnumbered, with "No, exit" preselected, then the footer. Its top is the first line of the dialog (that rule, or its first line of text when it has no frame), as the recorded screens (C9) show it. Between the top and the answers it may hold any number of warnings (pre-approved permissions, MCP servers, hooks): Fleet returns them as `lines` and never interprets them.
- **Alone:** the prompt is the live screen and the only thing on it. Its answers sit above the footer, and under the footer there are only blank rows: Claude Code doesn't draw the dialog at the very bottom, and the captures show blank rows below it. Anything else under the footer is `not_alone`. There's no input box and no other answer list on the visible screen; above its top there are only blank lines or what the shell printed before the Harness started (the launch line `spawn` typed). And the pane's foreground command isn't a shell (`pane_current_command`, as the web spawner's `ensureStarted` checks it), so the Harness is running. The pane's cursor is on the dialog (the selected answer's `❯`); a pane in copy mode is `not_alone`. Otherwise `not_alone` or `shell`.
- **After Esc, or a decline:** Claude Code uses no alternate screen, so the dialog's text stays on the screen above the shell's prompt, which sits under its footer (captured after Esc; after a decline presumably the same, not captured). A dialog with the cursor below it, on the shell, isn't a prompt: `no_prompt`, or `shell` when the pane's foreground is its shell. Anything under the footer is `not_alone`; a cursor anywhere else is `layout_unsupported`.
- The same words in the scrollback, or quoted in a conversation, never count, as for `answer`.
- **Codex:** C10.

## C4. `--accept` and `--decline`

Under a lock named after the tmux session (an `flock` on `trust-<tmux_session>.lock` in `$FLEET_LOCK_DIR`, else the lock directory `answer` uses), held for the whole read, type and verify, and failing at once when held (`busy`):

1. The pane is checked against `--pane`, then attached clients (unless `--allow-attached`).
2. The screen is read again. It must show a Trust prompt whose `id` is `--prompt`, and `answerable` (C2). Otherwise nothing is typed: `prompt_not_on_screen` with `detail` `no_prompt`, `shell`, `different_prompt`, `touched` or `not_alone`, or `prompt_incomplete` with `clipped` or `layout_unsupported`.
3. Keys, each checked before the next: `Down` or `Up` until the screen shows the cursor on the chosen answer ("Yes, I trust this folder" for `--accept`, "No, exit" for `--decline`), then `Enter`. A key the dialog ignored (the screen unchanged: it's drawn before it listens for keys) is pressed again, at most 4 times, 400 ms apart; any other screen stops it with `prompt_changed`, saying how many keys went out. Enter is pressed only while the screen shows the cursor on the chosen answer. No other key is ever pressed: no number, no Esc.
4. After Enter the prompt must leave the screen within 3 s: then `answered: true`. Otherwise `outcome_uncertain`, with `screen` (what `--list` reads now, or `null`). Leaving means the dialog is gone, not that it is no longer a prompt (C3, after Esc): an `--accept` that ends at the shell, or leaves the dialog's text on screen, is `outcome_uncertain` too.

Success (exit 0):

```json
{ "ok": true, "host": "mac", "tmux_session": "new-repo", "handle": "%12", "harness": "claude",
  "answered": true, "answer": "accept", "id": "t1.9f2c01aa",
  "steps": [ { "key": "Down" }, { "key": "Enter" } ], "closed": null }
```

`-n`: `{ "ok": true, "answered": false, "dry_run": true, … , "steps": […] }`, the keys it would press.

## C5. `--decline --close`

After a decline is answered (C4), Fleet waits up to 5 s for the Harness to exit (the pane's foreground back to its shell, with no child process), then kills that tmux session (`kill-session -t =<name>`), checking again that it has one window with one pane and that the pane is `--pane`. Then `closed: true`. If the Harness hasn't exited by then, or the pane changed, the tmux session is left as it is: `closed: false`, with `close_detail` `still_running` or `pane_changed`. Without `--close`, `closed: null` and nothing is closed.

## C6. Failures and `detail`

A failure (exit 1, exit 2 for `usage` from clap) prints `{ "ok": false, "host", "kind", "error", "detail", "pane", "typed" }`. `error` is free text and may quote the screen. `detail` never does: it's one code from the fixed set below, or `null`, so a caller can log it. `pane` is `{ cols, rows }`, `null` before the pane is known. `typed` says whether any key went out.

| kind | `detail` | when |
|---|---|---|
| `usage` | `null` | flags as C1 says, or `-H` |
| `target_not_found` | `null` | no tmux session with exactly that name |
| `target_invalid` | `null` | a name with characters a tmux session name can't have |
| `target_changed` | `null` | its pane isn't `--pane` |
| `host_unsupported` | `null` | not one window with one pane |
| `busy` | `null` | another `fleet trust` holds the lock |
| `human_attached` | `null` | a client is attached, without `--allow-attached` |
| `prompt_not_on_screen` | `no_prompt` | no Trust prompt on screen |
| | `shell` | the pane's foreground is its shell: the Harness isn't running (yet, or any more) |
| | `different_prompt` | a Trust prompt with another `id` |
| | `touched` | the cursor off the preselected answer, or something typed |
| | `not_alone` | something else on the visible screen with it (C3) |
| `prompt_incomplete` | `clipped` | its top or answers off the captured screen, or over 60 lines |
| | `layout_unsupported` | answers or a footer Fleet doesn't know, such as another Harness version's wording |
| `prompt_changed` | the code for what the screen showed instead | keys went out, then the screen wasn't what they lead to |
| `outcome_uncertain` | `null` | Enter went out and the prompt didn't leave the screen within 3 s |
| `backend_failed` | `null` | tmux refused, or the screen couldn't be read |
| `io` | `null` | the lock couldn't be taken |

`--list` reports the same `detail` codes beside `answerable: false`. New kinds and codes may be added; a caller treats an unknown one as `other`.

## C7. `spawn --resume`'s `session_starting` names its Session host

`session_starting` (another resume of that id is starting it, LAUNCH and HIST Technical approach) gains `starting: { tmux_session, handle } | null`: the tmux session that the resume's stamp names a pane of, when that pane still exists. An iTerm resume, or a pane that's gone, is `null`. So a resume waiting at its Trust prompt, started from the CLI or by a Lookout that has since restarted, can be found and answered with `trust`.

## C8. Boundary

- Fleet answers a Trust prompt only when `trust --accept` or `--decline` is run. `spawn`, `restore`, `handoff`, `stack spawn`, jobs and `list` never do, and `trust --list` types nothing. The web spawner's auto-accept stays as it is: it isn't part of the CLI.
- `trust` presses keys only on a Trust prompt, and reads nothing but that pane's screen, cursor position, height, mode and current command, all from one tmux call with the capture.
- Whether a folder is trusted is the Harness's own record (Claude Code's `hasTrustDialogAccepted` in `~/.claude.json`); Fleet never reads or writes it, and keeps no record of answers.

## C9. Tests in the fork

- Screens recorded 2026-10-27 from Claude Code 2.1.311 (`testdata/screens/live/claude-trust-*`, with a README), launched by hand at a shell prompt with a separate `CLAUDE_CONFIG_DIR`, not through `fleet spawn`: on this Mac `~/.claude.json` trusts `/`, so no folder normally asks. The plain prompt in a new directory; one whose `.claude/settings.json` pre-approves 12 permissions (the warning lists 8 and ", and 4 more"); each at 200×50 and 80×24; the same after one Down, after one Up and after Esc; and a resume (`--resume`) with the dialog first. The unit tests derive other screens from them (reworded, numbered, framed, clipped, a composer, Codex).
- Through a fake tmux, as `spawn`'s and `answer`'s tests do: every `detail`; the ignored first Down pressed again; Enter never pressed off the chosen answer; `--pane` that doesn't match; `--close` with the Harness exited and with it still running; the lock held; `session_starting` with and without a pane (C7).

## C10. Codex (a later commit)

Codex's Trust prompt shows while Codex is already listed, Idle and with no session id (LAUNCH, 2026-10-16), so a Codex start completes before it's answered. A second commit makes `trust` read it the same way (`harness: "codex"`): "Trust this folder?" with "Trust and continue" among its answers, preselected, so `untouched` there means the cursor on the accepting answer, and `--decline` moves to the other. Its labels and layout are recorded first (codex 0.163); until then a Codex Trust prompt is `layout_unsupported`.
