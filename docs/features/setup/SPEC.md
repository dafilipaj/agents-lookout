---
title: "Setup: the skills, agents, hooks and MCP servers your Harnesses load"
code: "SETUP"
status: "In Progress"
created: "2026-11-17"
updated: "2026-11-22"
---

# Setup

## Summary

A right-sidebar tab, Setup, lists what Claude Code and Codex load for every Session on this Mac: skills, agents, hooks and MCP servers, by kind and then by where they come from, with what each does, how it's called and where it's defined. A Claude Code skill or plugin can be turned off and on from it. Slice 2, Ready, adds This Session: what the selected Session loaded and what it used, read from its Transcript. Later slices add skills offered in the composer and how often each item is used.

## Problem

- Dario repeats the same prompts. Of 2,440 prompts typed in the 30 days to 2026-11-17, the same requests recur in 20 to 40 Sessions each: start a Task, review with the same two models, run two rounds of review and fixes, merge and push, approve a PR in his voice. Personal skills would fix that, but he can't see which skills, agents and hooks he already has.
- On this Mac on 2026-11-17, the Harnesses load:
  - Claude Code: about 97 skills (75 from 23 plugins, 13 in `~/.claude/skills`, 9 synced from claude.ai, 3 turned off in `skillOverrides`), 8 agents, all from plugins, 18 hooks in `~/.claude/settings.json` on 15 events, 5 plugins with hooks of their own, and 3 MCP servers from plugins.
  - Codex: 7 skills (`~/.codex/skills`, `~/.agents/skills`), 10 hooks in `~/.codex/hooks.json` and 4 MCP servers in `~/.codex/config.toml`.
- They're spread over a dozen files and a plugin cache, and nothing shows them in one place. In the same 30 days, 40 different skills were called, and the one that runs rounds of review and fixes never was; 1,485 Subagents were general-purpose and about 100 named.

## Requirements

Slice 1, what you have, is SETUP-1 to SETUP-5, all ticked. Slice 2, what one Session loaded, is SETUP-6 to SETUP-10, all ticked. Lookout's server reads the open Session's Transcript for it, one file when it shows (Technical approach).

### SETUP-1 The Setup tab

The right sidebar's sixth tab lists the Setup by kind, then by source, each source folded.

- [x] SETUP-1.1 The right sidebar has a Setup tab after Servers, its icon lucide `Puzzle`, on the closed sidebar's rail too. `U` opens it, or closes the sidebar when it's showing, as `H`, `W`, `L`, `T` and `P` do. (test)
- [x] SETUP-1.2 Setup has four sections in this order: Skills, Agents, Hooks and MCP servers, each a section label with the count of its rows that are on. Above them, a `Segmented` (DS-20) of All, Skills, Agents, Hooks and MCP, remembered across reloads, and a text filter that matches a row's name and description. (test)
- [x] SETUP-1.3 Within a section, rows are grouped by source: Yours (your own, both Harnesses' together), claude.ai (skills synced from it), then one group per plugin, in alphabetical order. A group's line has a chevron, its icon (lucide `User`, `Cloud` or `Package`), its name, the count of its rows, and a plugin's version at its right. (test)
- [x] SETUP-1.4 Groups start folded. A press on a group's line opens or closes it, and so do Enter, → and ← on it; which groups are open is remembered across reloads. While the text filter has text, every group with a match shows open, the others are hidden, and the matches are marked (DS-3.4). (test)
- [x] SETUP-1.5 A row is one line: its Harness's `HarnessIcon`, its name as it's called (`/p-codex:dual-review` is `p-codex:dual-review`), and its description's first line in `meta`, cut to fit. (test)
- [x] SETUP-1.6 A hook is one row per command, Harness and source: the same command on several events is one row, its description its events ("15 events") or its one event and matcher ("PreToolUse · Bash"). Its name is the file name of the script it runs, with its folder when the file is named `hook` or `index` (`pr-gate/hook.mjs`); a command with no script is named by the first path in it, else by its first word. (test)
- [x] SETUP-1.7 Skills and Agents start with a quiet line: "Plus the ones built into Claude Code, which Lookout can't read." (test)
- [x] SETUP-1.8 Setup is read when the tab opens and again after a switch (SETUP-4). A read while a switch is under way (the tab closed and opened again) waits for it. (test)
- [x] SETUP-1.9 The tab, a folded and an open group, an expanded row and the off line look right in light and dark mode at 280 and 720 px. (manual)

### SETUP-2 What's read, and from where

Only what applies to every Session (global). A repo's own items come with slice 2.

- [x] SETUP-2.1 For Claude Code, Setup reads the following. (test)
  - skills in `~/.claude/skills/*/SKILL.md`, each one's frontmatter for its name, description and argument hint; those under `synced/` are claude.ai's, called `anthropic-skills:<name>`;
  - plugins from `claude plugin list --json`, its user-scope entries (on or off, version, path, MCP servers), and each one's `skills/*/SKILL.md`, `agents/*.md` and `hooks/hooks.json`, called `<plugin>:<name>`;
  - agents in `~/.claude/agents/*.md`;
  - hooks in `~/.claude/settings.json`;
  - MCP servers in `~/.claude.json`'s top-level `mcpServers`;
  - `skillOverrides` in `~/.claude/settings.json`, for the skills that are off.
- [x] SETUP-2.2 For Codex, Setup reads skills in `~/.codex/skills` and `~/.agents/skills`, called `$<name>`, hooks in `~/.codex/hooks.json` with their trust in `~/.codex/config.toml`'s `hooks.state`, and MCP servers in `config.toml`'s `mcp_servers`. (test)
- [x] SETUP-2.3 A file that can't be read or parsed shows as one row in its section, naming the file and the error. The rest of Setup still shows. (test)
- [x] SETUP-2.4 An MCP server's environment variables and headers are listed by name only. Their values never leave Lookout's server: the API's answer has none. Nor does what looks like a credential in a server's arguments or URL, shown as `…`: a secret-named flag's value (`--token`, `--api-key=`, `-H`), a secret-named `NAME=value` or `Name: value` (in a flag's value too, `--env=API_TOKEN=…`), a bearer token, a URL's user info and its query's values. An error row says where a file doesn't parse, never quoting it, and an error from `claude plugin` is scrubbed the same way. (test)

### SETUP-3 An item's details

An expanded row (DS-21) says what the item does and where it lives, and opens it.

- [x] SETUP-3.1 A press on a row, or Enter on the selected one, expands it, built from `RowDetails`: its name whole, a state line, a summary of at most three lines, and its actions. The state line's tooltip ends with the item's file. By kind: (test)
  - a skill: its source (and the plugin's version) and its Harness; the summary is its call (`/<name>` and its argument hint, or `$<name>` in Codex) and its description;
  - an agent: its model, its Effort and how many tools it has, the tools named in the tooltip; the summary is its description;
  - a hook: its events, or its event and matcher, and its timeout, every event named in the tooltip; the summary is its whole command;
  - an MCP server: its transport and how many environment variables and headers it has, named in the tooltip; the summary is its command and arguments, or its URL.
- [x] SETUP-3.2 The row's action is "Open in VS Code" (Enter). It opens the item's file: a skill's `SKILL.md`, an agent's file, or the settings, `hooks.json` or config file at the hook's or server's line. (test)

### SETUP-4 Turning a skill or a plugin off and on

Only where Claude Code has a switch of its own.

- [x] SETUP-4.1 A Claude Code skill's More has "Turn off", which adds `"<name>": "off"` to `skillOverrides` in `~/.claude/settings.json` and changes nothing else in the file. An off skill's "Turn on" removes that entry. A value other than `"off"` (`"name-only"`, `"user-invocable-only"`) leaves the skill on, said in its state line. Switches run one at a time, so two at once both land; a settings file that's a link stays one (its target is written); if the file changed between Lookout's read and its write, Lookout starts again from what's there. (test)
- [x] SETUP-4.2 An item from a plugin has "Turn off plugin <name>…" in its More. A confirmation lists what it turns off (its skills, agents, hooks and MCP servers, by count), then Lookout runs `claude plugin disable <plugin>`. An off plugin's items have "Turn on plugin <name>", which runs `claude plugin enable <plugin>`. (test)
- [x] SETUP-4.3 After a switch, Setup says it applies to Sessions started from now on, and that running ones keep what they loaded. (test)
- [x] SETUP-4.4 Agents, hooks, MCP servers and Codex's items have no switch. (test)
- [x] SETUP-4.5 `X` on the selected row runs its switch: a skill's own, else its plugin's (which asks first, as in SETUP-4.2); a row with neither ignores it. More shows `X` by the item it runs. (test)

### SETUP-5 What's off

- [x] SETUP-5.1 Items that are off are left out of their groups and their counts. The section ends in a line, "<n> off", which opens and closes like a group and lists them, quieter than the rest, each with its source and why it's off: turned off in `skillOverrides` (an entry that names no skill on disk says "not found on disk"), its plugin is off, a Codex hook with no trust recorded (with no `config.toml` too), or turned off in `config.toml` (`enabled = false`). (test)

### SETUP-6 This Session (slice 2)

What the selected Session loaded and what it used, read from its Transcript, as a second view of the tab. Drawn on canvas A of slice 2 (UX).

- [x] SETUP-6.1 Above the kind filter, a `Segmented` (DS-20) chooses what the tab shows: Everywhere, slice 1's list, or This Session, remembered across reloads. This Session follows the Session open in the main pane, live or past. With none open, or a Codex Session open, its choice is disabled, its tooltip saying why ("Open a Session to see what it loaded", "Claude Code Sessions only, for now"), and the tab shows Everywhere. (test)
- [x] SETUP-6.2 In This Session, the kind filter gives way to the Session's line: its `HarnessIcon` and title, and under it in `meta` its directory and when it loaded what's shown, its start or its latest compaction ("~/Projects/ledger-web · as it loaded at 10:12"). The text filter stays, as "Filter this Session's Setup", and matches as SETUP-1.2's does. (test)
- [x] SETUP-6.3 Its sections, in this order: Instructions and Memory (SETUP-7), Ran in this Session (SETUP-8) and This repo's own (SETUP-9), each a `SectionLabel` with its note; a section with nothing is left out. They end in one quiet line that switches to Everywhere and counts what the Session's lists named from outside its repo, and Everywhere's hooks that are on, as no list names hooks: "It also loaded 97 skills, 8 agents, 16 hooks and 3 MCP servers from Everywhere". The line is one of the list's options, so j/k reach it and Enter runs it. (test)
- [x] SETUP-6.4 This Session is read when it's chosen, when another Session opens in the main pane, on the tab's Refresh, and, while it shows, when the Session's turn ends (Busy to any other Status). Setup gains Refresh in the sidebar's header, as Work has (WORK-8.2), with no limit to wait out: it reads the view that shows again. (test)
- [x] SETUP-6.5 Everything in This Session comes from the Session's Transcript, found by its id under `~/.claude/projects`, and the disk as SETUP-7.3 and SETUP-9 say. A Transcript that's gone or can't be read is one error row naming it (SETUP-2.3); an entry Lookout doesn't know is skipped. (test)

### SETUP-7 Instructions and memory (slice 2)

- [x] SETUP-7.1 Instructions lists the instruction files of the Session's latest load, in the order Claude Code loaded them, grouped as SETUP-1.3's groups are: Yours (`~/.claude/CLAUDE.md`) and This repo (lucide `FolderGit2`: its `CLAUDE.md` files and `CLAUDE.local.md`). A row: lucide `FileText`, the file's path from the repo (from `~` for Yours), and in `meta` its lines and its size in tokens, estimated as its text's length / 4 ("48 lines · ~0.9k tokens"). The label's note is the files and tokens in all ("5 files · ~4.6k tokens"). Its groups, and Memory's (SETUP-7.5), start open, as canvas A drew them; which are folded is remembered as SETUP-1.4's are. Files Claude Code loaded later, a subfolder's `CLAUDE.md` once the Session read a file there, follow in the order they loaded, their `meta` ending in when ("loaded at 10:42"). (test)
- [x] SETUP-7.2 A file another one imports (`@AGENTS.md` in the importer's loaded text) sits under its importer, indented, its icon lucide `CornerDownRight`; the importer's `meta` says "imports 2". (test)
- [x] SETUP-7.3 A file whose text on disk differs from the text the Session loaded has a "changed" chip in the warning tone; one no longer on disk, "gone". (test)
- [x] SETUP-7.4 An instruction file's row expands (DS-21): its path whole; a state line of its lines and tokens, when it loaded for one loaded later, its importer and its source, last as its group line names it too, the full path in the tooltip; for a changed file, a summary of when it changed and what the Session works from ("Edited on disk at 11:03, after the Session loaded it at 10:12. It works from the 10:12 text until it compacts."); and "Open in VS Code" (Enter), opening the file on disk. (test)
- [x] SETUP-7.5 Memory is the memory index the Session loaded (`MEMORY.md`, Claude Code's `AutoMem`) as a group, lucide `Bookmark`, its count the entries, and one row per entry line (`- [Title](file.md) — …`): its title and, in `meta`, the type in its file's front matter (`user`, `feedback`, `project`, `reference`). The label's note is the entries and tokens. An entry's row opens its file in VS Code. (test)

### SETUP-8 Ran in this Session (slice 2)

- [x] SETUP-8.1 Ran in this Session is grouped by kind, in this order, each under a quiet kind label with its count, the most runs first within it: Skills by their calls (the Skill tool or a slash command), Agents (Subagents) by type, built-in ones too, MCP servers by their tools' calls, then Hooks by their command's runs. A row: the name as SETUP-1.5 shows it, in `meta` its source and, for a hook, its events and its failed runs ("Yours · 15 events · 2 failed"), and its count at the right ("212×", "9 calls"). The label's note is the number of rows. (test)
- [x] SETUP-8.2 A row that is an item Setup lists, Everywhere or in This repo's own, expands as that item's row does (SETUP-3), its count in the state line; a hook run is that item by its command. An item of this repo's that ran shows here and in This repo's own, its count only here. A built-in Subagent's row says it's built into Claude Code and has no action; so has an MCP server no item matches, saying where it's from ("claude.ai") or "Not in Setup". This Session's rows have no switches: those are Everywhere's (SETUP-4). (test)
- [x] SETUP-8.3 Counts cover the whole Session, across compactions, as of its last read (SETUP-6.4). (test)

### SETUP-9 This repo's own (slice 2)

- [x] SETUP-9.1 This repo's own lists what the Session's directory adds to Claude Code: skills in `.claude/skills` and `.claude/commands` (its subfolders too, a command named by its file), agents in `.claude/agents`, hooks in `.claude/settings.json` and `.claude/settings.local.json`, MCP servers in `.mcp.json`, and the plugins installed for it (`claude plugin list --json`'s project scope for that directory). A row: its name, and in `meta` its kind and where it's defined ("Skill · .claude/skills", "MCP · .mcp.json · stdio"). They're read as SETUP-2's are, with its error rows (SETUP-2.3) and its hiding of credentials (SETUP-2.4). An item that ran is listed here too, without its count (SETUP-8.2). (test)
- [x] SETUP-9.2 An item on disk that the Session's lists don't name ends the section as "<n> not loaded", opening like SETUP-5.1's off line, lucide `CircleOff`, each row at 60% saying why when it's known: added after the latest load ("added at 11:20, after it started"), an `.mcp.json` server not approved, else "not in its lists". Hooks are never in it: no list names them. An MCP server is listed only when it gives instructions or its tools are deferred, so one is "not in its lists" only while the Session's tools were deferred. (test)
- [x] SETUP-9.3 Its rows expand as SETUP-3's do, with "Open in VS Code" and no switches (SETUP-4.4). (test)

### SETUP-10 The look (slice 2)

- [x] SETUP-10.1 This Session with five instruction files, one of them changed and expanded, a memory index, ten rows that ran and a "1 not loaded" line looks right in light and dark mode at 280 and 720 px, and matches the slice 2 sketch (UX). (manual)

## Planned slices

Slices 3 and 4 have no order yet.

3. **Starting:** `/` in the composer offers the skills Setup lists. This lifts VIEW's Non-goal on slash-command autocomplete (Backlog: "Decide: `/` and `@` autocomplete").
4. **Usage and clean-up:** each skill's, agent's and MCP server's calls in 30 days and its last use, from facts tb-session gives, with what's gone unused marked; claude.ai connectors as Transcripts show them. From the Backlog's "A catalogue of agents".

## Non-goals

- Creating or editing skills, agents, hooks or MCP servers. That happens in VS Code or in a Session.
- Installing, uninstalling or updating plugins and marketplaces.
- Connecting to MCP servers: no tool lists, no health checks.
- An MCP server's environment and header values (SETUP-2.4).
- Switches for agents, hooks and MCP servers, and Codex's switches until they're checked (Open questions).
- Claude Code's built-in skills and agents: they aren't on disk (SETUP-1.7).
- Plugins installed for one project (`claude plugin list`'s project scope) in Everywhere: they're what a Session in that repo loads, so This Session's (SETUP-9.1).
- Editing an instruction file or a memory entry, or showing its whole text in the tab: Open in VS Code (slice 2).
- What a new Session in a directory would load: This Session shows what one did load (slice 2).
- Codex Sessions in This Session: their rollout records `AGENTS.md` only per directory, and no hook runs (slice 2).
- Which memory entries a Session read: the index is what loads (slice 2).
- Earlier loads of a Session's instruction files: This Session shows the latest, what it works from now (slice 2).
- What other Sessions loaded or ran, or counts across Sessions: This Session reads one Transcript when it shows (slice 2). Slice 4's usage decides its own source.
- claude.ai's connectors in slice 1: the only record on disk is an undocumented list of the ones that ever connected (slice 4).
- Usage counts in slice 1 (slice 4).

## UX

Drawn on a canvas of three directions on 2026-11-17 (https://claude.ai/artifact/BMjMWvHDxEWAkZSzarijpA); Dario chose B, "Folded by source".

- **The tab:** after Servers, `Puzzle`, key `U`. Its panel, top to bottom: the kind filter (`Segmented`, five choices, sharing the track's width), the text filter ("Filter Setup", as Library's), then the list.
- **A section:** a `SectionLabel` ("Skills", its count at the right), the built-in note under Skills' and Agents', then its groups, then its off line.
- **A group's line:** 32 px, a 14 px chevron (turned when open), the source's 14 px icon in `muted-foreground` (`User` for Yours, `Cloud` for claude.ai, `Package` for a plugin), the name in `body` medium, the count in `muted-foreground`, a plugin's version in `meta` at the right. It's a listbox option of its own, so j/k move through group lines and rows alike.
- **A row:** a list row (DS-17), inset under its group's name: `HarnessIcon` (14 px), the name in `body` medium (up to 62% of the row), the description in `meta`, `muted-foreground`, both cut. A filter's match is a `Hit` in either.
- **An expanded row:** `RowDetails` under the name. A skill: "p-codex 1.10.2 · Claude Code"; summary `/p-codex:dual-review <PR-URL | PR-number | worktree-path>` in mono, then its description. A hook: "15 events · 10 s"; summary its command in mono. An MCP server: "stdio · 3 env vars"; summary `npx -y …` or its URL. Actions: "Open in VS Code" (`open-vscode`, Enter) and More: "Turn off" or "Turn on", "Turn off plugin p-codex…" or "Turn on plugin p-codex", `X` by the first of them.
- **The off line:** "3 off", like a group's line with `CircleOff` for its icon; open, its rows are at 60% opacity, each description saying the source and why ("Yours · off in skillOverrides").
- **After a switch:** an info `Alert` (inline) above the list: "Turned off p-codex. Sessions started from now on won't load it; running ones keep what they loaded."
- **The plugin confirmation:** a dialog as Stop's (PORTS-4.6): "Turn off plugin p-codex?", "It turns off 3 skills, 1 agent and 1 hook, for Sessions started from now on.", Cancel and Turn off.

### Slice 2

Drawn on a canvas of two looks on 2026-11-21 (https://claude.ai/artifact/KnrDKjoRVhUxLck7Kxomim); Dario chose A, "This Session, a view of its own", as the simpler.

- **The switch:** a `Segmented` of Everywhere and This Session above the kind filter, the panel's width.
- **The Session's line:** its `HarnessIcon` (14 px) and title in `body` medium, cut; under it, inset to the title, the directory and "as it loaded at 10:12" in `meta`.
- **Instructions:** group lines as slice 1's (`User`, `FolderGit2`); a row as a list row, `FileText` for a file, `CornerDownRight` and 16 px more inset for an import, "changed" a warning-tone chip at the right.
- **Memory:** a `Bookmark` group of the entries, each entry's title in `body` medium and its type in `meta`.
- **Ran in this Session:** a quiet kind label per kind (Skills, Agents, MCP servers, Hooks), then one-line rows, not inset: the name in `body` medium (up to 56% of the row), "Yours · 15 events" in `meta`, the count in `meta`, `tabular-nums`, at the right.
- **This repo's own:** the same rows, then the "1 not loaded" line.
- **The closing line:** `meta` in `muted-foreground`, a lucide `ArrowRight` at its end, a row's hover.

## Technical approach

- Lookout's server reads the files itself, as MEM reads `lsof` and TOOLS looks for binaries ([0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)). Lookout is the only consumer today. The reading moves to a Building block in cli-toolbox when a second one appears ([0005](../../decisions/0005-building-blocks-live-outside-lookout.md)).
- Plugins come from `claude plugin list --json`, the Harness's own answer for what's installed and on, rather than reading `installed_plugins.json` and `enabledPlugins`. Only its `user` scope applies to every Session.
- `config.toml` is parsed with `smol-toml`; a value is read only where a criterion needs it, and an MCP server's `env` and `http_headers` tables give their keys alone.
- `skillOverrides` is written the way Claude Code keeps the file: read, change one key, write to a temporary file and rename it. It takes `"on"`, `"name-only"`, `"user-invocable-only"` and `"off"` (checked in Claude Code 2.1.326); only `"off"` hides a skill from both you and the model.
- A plugin is switched only through `claude plugin enable` and `disable`, with `--scope user` as it was listed, never by editing `enabledPlugins`.
- The API: `GET /api/setup` reads now and answers `{ items, errors, readAt }`; `POST /api/setup/skill` (`{ name, on }`) and `POST /api/setup/plugin` (`{ id, on }`) switch and answer the read that follows. Both POSTs take the token and `Origin`, as every mutation.

### Slice 2

**Measured** (2026-11-21, on this Mac):

- A Claude Code Transcript records each load of the instruction files as an `instructions` attachment: every file with its path, its type (`User`, `Project`, `AutoMem`) and its text. One Session had 8, at its start and after each compaction. It also records the lists the model was given: `skill_listing` (116 names), `agent_listing_delta` (the built-in types among them) and `mcp_instructions_delta` (server names).
- Each hook run is a `hook_success` attachment with its command, event and matcher, exit code and duration: 1,690 in that Session. A skill call is a `Skill` tool call naming the skill; an MCP call is a tool named `mcp__<server>__<tool>`.
- A Codex rollout records its `AGENTS.md` text as one message per directory ("# AGENTS.md instructions for <dir>"), not per file, and its skills as one list of `SKILL.md` paths (105). It records no hook runs, and the last 40 rollouts hold no MCP call.

- Claude Code records a subfolder's `CLAUDE.md` loaded mid-Session as a `nested_memory` attachment with its path and text (1,798 across this Mac's Transcripts), and a hook that failed or was cancelled as `hook_non_blocking_error` or `hook_cancelled`, with its command and exit code (80).
- Indexing these facts for every Session in tb-session would add 257,820 hook runs, 15,256 MCP calls, 5,829 skill calls and 3,050 loads of about four files' text, against the 1,064 Subagent rows of 0.6.0, and another schema bump with a full re-parse (the first query after 0.6.0's took 21 s). Reading one Transcript in one pass takes 0.10 s for 32 MB (1,754 hook runs) and 0.37 s for the biggest, 201 MB. In Lookout's server (Node), as built: 0.26 s for the biggest, 211 MB by then (9,119 hook runs), once lines are split by hand and kept by one regex (readline and eleven substring checks took 0.79 s); `claude plugin list --json`, which the read runs for Everywhere's items and the repo's plugins, adds about 0.6 s.

**Reading the Transcript:** Lookout's server reads the open Session's Transcript when This Session shows, finding it by the Session's id under `~/.claude/projects`, in one pass: the latest `instructions` attachment and the `nested_memory` ones after it, the latest skill, agent and MCP lists, every `hook_success`, `hook_non_blocking_error` and `hook_cancelled`, and the tool calls (`Skill`, `Agent`, `mcp__<server>__<tool>`) and slash commands. Entries it doesn't know are skipped. Tests read an invented Transcript. A Consequence of [0005](../../decisions/0005-building-blocks-live-outside-lookout.md), as PORTS's read of the Mac's listeners: one file on demand, no index and no state another tool needs. It moves to tb-session if a second consumer wants the same.

**Lookout's rules** (`server/setup-session.ts`, the reading in `server/setup-transcript.ts`): an import is an `@path` in a loaded text, outside code, naming another loaded file; a file changed when its text on disk differs from the loaded one, past a last newline, front matter and comments, which Claude Code drops; This repo's own is read from disk as SETUP-2 reads the rest; "not loaded" is an item on disk that the lists don't name; the groups, the order of what ran and the closing line's counts. `GET /api/setup/session/<id>` answers `{ loadedAt, instructions, memory, ran, repo, everywhere, errors }`; `SetupPanel.tsx` gets the switch, `SetupSession.tsx` the This Session view, and `SetupRow.tsx` the row both share. A hook run that blocked a tool (`hook_blocking_error`) counts as a run, not a failure.

### Key decisions

- **Finding your way first:** slice 1 answers what you have, what each item does, how it's called and where it's defined. Usage, clean-up, starting skills and one Session's view come later.
- **Skills, agents, hooks and MCP servers:** instruction files and memory depend on a Session's directory, so they come with slice 2.
- **Both Harnesses at once:** Codex keeps everything in files, so it costs little, and Lookout serves both.
- **A right-sidebar tab:** it sits beside the Session, where slice 2 (loaded in this Session) and slice 3 (skills in the composer) belong. A Settings page would hide it, and visibility is the problem.
- **No usage counts in slice 1:** reading 30 days of Transcripts (2.3 GB on this Mac) waits for the clean-up slice, and comes from tb-session's facts.
- **No claude.ai connectors in slice 1:** the only record on disk is an undocumented field.
- **Global only:** a repo's items are what one Session loads, so they're slice 2's.
- **By kind, then by source, folded (canvas B):** "which skills do I have" is the question, and folded, Skills' 104 rows fit in 23 lines, one per source. Dario chose it over one list with the source as a chip on each row (A) and count tiles with one-line rows (C).
- **One row per hook command:** 15 of the 18 Claude Code hooks are one Orca command on 15 events; as 15 rows they'd bury the other three.
- **Five choices in the kind filter:** All and the four kinds, so a text filter can find across kinds. DS-20.1 allows five for it (DS Changelog).
- **What's off is folded away, with its reason:** the counts are what loads, and the reason says what to undo.
- **Switches only where Claude Code has one:** a skill (`skillOverrides`) and a plugin (`claude plugin disable`). Turning off a hook or an MCP server means deleting it from a file, and Lookout has never changed a Harness's configuration before.
- **A summary in the expanded row, the whole text in VS Code:** some skills run to hundreds of lines, too long for the tab.
- **Lookout reads the files, not a new Building block:** agents already get their own skills and agents in their context, and can read these files in one step. What a CLI would add (the other Harness, hooks, what's off) is rarely needed. The one likely second consumer, a clean-up plugin, reads the files itself.
- **Called Setup:** it covers slice 2 too. "Harness" already means Claude Code or Codex itself.
- **Built-in items left out, with a note:** a hand-kept list would go stale with every Claude Code release.
- **Slice 2 is one Session's view:** Dario's choice over starting skills from the composer.
- **`Puzzle` and `U`:** the usual sign for extensions; `Wrench` would clash with Settings' Tools and `SlidersHorizontal` reads as a filter. `S` is Specs; `U` is free and in "setup".

Slice 2, from canvas A (Dario, 2026-11-21):

- **A view of its own, switched at the top:** it reads as the Session's story, what it loaded, what it used, then what its repo adds, and Everywhere stays as it is. Dario chose it as the simpler, over B: the Session's layer on the whole list, with a band of what took its start context, run counts on rows and a "Ran here" filter.
- **What it loaded, from its Transcript:** Claude Code records each load and the lists the model was given. Its loading rules applied to a directory would be a guess that drifts with each release, and would miss a file edited since. The disk is read only to say what changed.
- **Everything else in one line:** a Session loads every item Everywhere lists; listing them again would bury the few that are its own or that ran.
- **Tokens as an estimate:** the text's length / 4, marked "~", is enough to see which file is big.

Grilled with Dario on 2026-11-21:

- **Lookout reads the one Transcript, not tb-session:** Dario's worry was tb-session growing slow. Indexing these facts for every Session would be its biggest growth yet (257,820 hook runs, Measured) for a view that needs one Session at a time, and reading that one file takes under half a second. Dario passed over a tb-session command that reads one file without indexing it, and over new event kinds.
- **Claude Code Sessions only:** a Codex rollout records its `AGENTS.md` text per directory, not per file, and no hook runs, so its view would be half of this. Dario passed over showing that half, and over working out Codex's files from its loading rules.
- **Which memory entries were read, dropped:** it needed a third kind of fact, and the index is what loads. Dropped for good, not deferred.
- **The latest load:** what the Session works from now. Dario passed over noting earlier loads' differences, and a menu of loads.
- **Ran by kind, Hooks last:** in one Session a hook ran 1,757 times and three skills 9, so one list by count would always open on hooks. Dario passed over that, and over hooks folded into one line.
- **An item of the repo's that ran is in both sections:** each answers its own question whole, what was used and what the repo has; the count is only under Ran.
- **Files loaded later and failed hooks, from the record:** Claude Code records both (Measured), so Instructions lists a subfolder's `CLAUDE.md` once it loaded, and a hook's row says how many of its runs failed.

## Open questions

- [ ] Codex's switches: which `config.toml` keys turn off a skill, a hook or an MCP server, checked against the installed Codex.

None for slice 2: its grill answered its four and two more (Key decisions).

## Changelog

- 2026-11-17: Created from a grill with Dario (thirteen questions), merging the Backlog's "What's loaded into a Session (CTX)" and "A catalogue of agents". Slice 1 is what you have; slices 2 to 4 are planned.
- 2026-11-17: Dario chose canvas B, sources folded within each kind. SETUP-1 rewritten for it (groups, one-line rows, one row per hook command, `Puzzle` and `U`), SETUP-3.1 follows DS-21's expanded row, SETUP-5.1 gets the off line; `skillOverrides`' values checked and the canvas, icon and values questions closed. Ready, then In Progress.
- 2026-11-17: Slice 1 built: `server/setup.ts` (the reader and both switches, `GET /api/setup`, `POST /api/setup/skill` and `/plugin`), `web/src/lib/setup.ts` and `SetupPanel.tsx`; SETUP-1.1 to 5.1 ticked on their tests. Decided in building: plugins come from `claude plugin list --json`'s user scope only, as its project-scope entries repeat per repo (146 of 172 on this Mac), and a project's plugin joins the Non-goals; a hook's name falls back to the first path in its command, for a script without an extension (`node "$CLAUDE_PLUGIN_ROOT/scripts/workspaces"`); with text in the filter, a section with no match hides its error rows too; the plugin confirmation's Turn off is Primary, not red, as it's undone with one switch; `turn-off` and `turn-on` join the actions table (`ToggleLeft`, `ToggleRight`), since `Power` is End Session's. `RowActions` no longer passes its first action's `action` to the DOM, which React warned about in every panel. Seen running at 1440 px and at 280 px in dark mode with this Mac's Setup: 187 skills on (Yours 102, of which 89 are Codex's), 14 hooks. SETUP-1.9 waits for Dario's look.
- 2026-11-17: Codex review, round 1. SETUP-2.4 covers credentials in an MCP server's arguments and URL, and parse errors (JSON's and TOML's own messages quote the file). SETUP-4.1: switches run one at a time (a plugin's too, as `claude plugin` writes the same file), a linked settings file keeps its link, and a write starts again if the file changed under it. SETUP-4.5 added: `X` switches the selected row, as More's switches had no key and the listbox keeps More out of the Tab order. SETUP-5.1: with no `config.toml`, a Codex hook is untrusted. Fixed without a spec change: an off plugin's skill with a `skillOverrides` entry no longer adds a "not found on disk" row, and a top-level MCP server in `~/.claude.json` opens at its own line, not a project's of the same name.
- 2026-11-17: Codex review, round 2. SETUP-2.4: a URL's whole user info is hidden (a token can be the user, or the password with no user), a flag's value is scrubbed too (`--env=API_TOKEN=…`), and `claude plugin`'s errors are scrubbed before they reach the tab. SETUP-1.8: a read waits for a switch under way, so closing and opening the tab mid-switch shows its result. SETUP-4.1 now says what the check before the rename covers: another writer between Lookout's read and its write. One in the instant between that check and the rename can still be lost, as between Claude Code's own writers, since none of them lock the file.
- 2026-11-17: Codex review, round 3. SETUP-2.4: a URL's user info is hidden through its last `@` (a password can hold one), and a CLI's error hides a secret-named flag's value after a space too (`--api-key …`). SETUP-1.8: a plugin switch joins the queue before looking for the `claude` binary, so a read in that moment waits as well. SETUP-3.1: an unquoted `argument-hint: [issue-number]`, a YAML list, stays in the skill's call.
- 2026-11-21: SETUP-1.9 ticked: Dario checked the Setup tab on 4747. Every slice 1 criterion is ticked. No requirement changed.
- 2026-11-21: Slice 2 drafted from canvas A (https://claude.ai/artifact/KnrDKjoRVhUxLck7Kxomim, Dario's pick over B, as the simpler): SETUP-6 to SETUP-10, This Session, a second view of the tab with the instruction files and memory the selected Session loaded, what ran in it and its repo's own items, read from its Transcript through tb-session (Gaps 1 and 2). Measured what a Claude Code Transcript and a Codex rollout record. Planned slice 2 moves into Requirements; a project's plugins join This repo's own. Draft until its grill (Open questions).
- 2026-11-21: Slice 2 grilled with Dario (six questions, Key decisions) and Ready. Its facts come from Lookout's server reading the open Session's Transcript, not from tb-session, which needs no new release: Gaps go, SETUP-6.5 now says where the facts come from (it named a tb-session version), and Technical approach measures the read and what indexing would cost. Claude Code Sessions only (SETUP-6.1); SETUP-7.1 adds files loaded later; SETUP-8.1 groups by kind, Hooks last, with a hook's failed runs; SETUP-8.2 and 9.1 list an item of the repo's that ran in both sections. Non-goals gain Codex Sessions, memory entries read, earlier loads and counts across Sessions.
- 2026-11-21: Slice 2 built. SETUP-6.4: the tab had no Refresh, so Setup gains Work's, which reads the view that shows. SETUP-7.1: This Session's file and memory groups start open, as canvas A drew them. SETUP-6.3: the closing line counts Everywhere's hooks that are on, as no list in a Transcript names hooks, and is a list option for the keys. SETUP-8.2: a ran MCP server no item matches says where it's from, and This Session has no switches. SETUP-9.2: hooks are never not loaded, and an MCP server is unlisted only while tools were deferred. Technical approach: the read as measured in Node, 0.26 s for 211 MB. SETUP-7.4: the state line puts the file's size first and its source last, as at 280 px every fact was cut.
- 2026-11-21: SETUP-6.1 to 9.3 ticked: their tests pass. SETUP-10.1, the look, waits for Dario.
- 2026-11-21: Codex reviewed slice 2 (Sol, xhigh): three findings, all fixed. SETUP-9.2: a skill or agent list recorded empty names nothing, so the repo's items aren't loaded, while a Transcript with none recorded says nothing. SETUP-9.1: commands in `.claude/commands`' subfolders are read, named by their file. SETUP-6.3, 9.2: a server whose deferred tools were all removed leaves the MCP lists.
- 2026-11-22: SETUP-10.1 ticked: Dario checked This Session on 4747. Every slice 2 criterion is ticked. No requirement changed.
