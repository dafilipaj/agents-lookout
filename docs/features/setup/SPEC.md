---
title: "Setup: the skills, agents, hooks and MCP servers your Harnesses load"
code: "SETUP"
status: "In Progress"
created: "2026-11-17"
updated: "2026-11-17"
---

# Setup

## Summary

A right-sidebar tab, Setup, lists what Claude Code and Codex load for every Session on this Mac: skills, agents, hooks and MCP servers, by kind and then by where they come from, with what each does, how it's called and where it's defined. A Claude Code skill or plugin can be turned off and on from it. Later slices add what one Session loaded, skills offered in the composer, and how often each item is used.

## Problem

- Dario repeats the same prompts. Of 2,440 prompts typed in the 30 days to 2026-11-17, the same requests recur in 20 to 40 Sessions each: start a Task, review with the same two models, run two rounds of review and fixes, merge and push, approve a PR in his voice. Personal skills would fix that, but he can't see which skills, agents and hooks he already has.
- On this Mac on 2026-11-17, the Harnesses load:
  - Claude Code: about 97 skills (75 from 23 plugins, 13 in `~/.claude/skills`, 9 synced from claude.ai, 3 turned off in `skillOverrides`), 8 agents, all from plugins, 18 hooks in `~/.claude/settings.json` on 15 events, 5 plugins with hooks of their own, and 3 MCP servers from plugins.
  - Codex: 7 skills (`~/.codex/skills`, `~/.agents/skills`), 10 hooks in `~/.codex/hooks.json` and 4 MCP servers in `~/.codex/config.toml`.
- They're spread over a dozen files and a plugin cache, and nothing shows them in one place. In the same 30 days, 40 different skills were called, and the one that runs rounds of review and fixes never was; 1,485 Subagents were general-purpose and about 100 named.

## Requirements

Slice 1, what you have.

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
- [ ] SETUP-1.9 The tab, a folded and an open group, an expanded row and the off line look right in light and dark mode at 280 and 720 px. (manual)

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

## Planned slices

Specced after slice 1 ships, in this order for slice 2. Slices 3 and 4 have no order yet.

2. **Loaded in this Session:** for the selected Session, its repo's own items (`.claude/`, `.mcp.json`), its instruction files (the `CLAUDE.md` or `AGENTS.md` chain and its imports) and memory. Resolved (the Harness's loading rules applied to its directory) and observed (what its Transcript shows ran) are labelled apart. From the Backlog's "What's loaded into a Session".
3. **Starting:** `/` in the composer offers the skills Setup lists. This lifts VIEW's Non-goal on slash-command autocomplete (Backlog: "Decide: `/` and `@` autocomplete").
4. **Usage and clean-up:** each skill's, agent's and MCP server's calls in 30 days and its last use, from facts tb-session gives, with what's gone unused marked; claude.ai connectors as Transcripts show them. From the Backlog's "A catalogue of agents".

## Non-goals

- Creating or editing skills, agents, hooks or MCP servers. That happens in VS Code or in a Session.
- Installing, uninstalling or updating plugins and marketplaces.
- Connecting to MCP servers: no tool lists, no health checks.
- An MCP server's environment and header values (SETUP-2.4).
- Switches for agents, hooks and MCP servers, and Codex's switches until they're checked (Open questions).
- Claude Code's built-in skills and agents: they aren't on disk (SETUP-1.7).
- Plugins installed for one project (`claude plugin list`'s project scope): they're what a Session in that repo loads, so slice 2's.
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

## Technical approach

- Lookout's server reads the files itself, as MEM reads `lsof` and TOOLS looks for binaries ([0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)). Lookout is the only consumer today. The reading moves to a Building block in cli-toolbox when a second one appears ([0005](../../decisions/0005-building-blocks-live-outside-lookout.md)).
- Plugins come from `claude plugin list --json`, the Harness's own answer for what's installed and on, rather than reading `installed_plugins.json` and `enabledPlugins`. Only its `user` scope applies to every Session.
- `config.toml` is parsed with `smol-toml`; a value is read only where a criterion needs it, and an MCP server's `env` and `http_headers` tables give their keys alone.
- `skillOverrides` is written the way Claude Code keeps the file: read, change one key, write to a temporary file and rename it. It takes `"on"`, `"name-only"`, `"user-invocable-only"` and `"off"` (checked in Claude Code 2.1.326); only `"off"` hides a skill from both you and the model.
- A plugin is switched only through `claude plugin enable` and `disable`, with `--scope user` as it was listed, never by editing `enabledPlugins`.
- The API: `GET /api/setup` reads now and answers `{ items, errors, readAt }`; `POST /api/setup/skill` (`{ name, on }`) and `POST /api/setup/plugin` (`{ id, on }`) switch and answer the read that follows. Both POSTs take the token and `Origin`, as every mutation.

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

## Open questions

- [ ] Codex's switches: which `config.toml` keys turn off a skill, a hook or an MCP server, checked against the installed Codex.

## Changelog

- 2026-11-17: Created from a grill with Dario (thirteen questions), merging the Backlog's "What's loaded into a Session (CTX)" and "A catalogue of agents". Slice 1 is what you have; slices 2 to 4 are planned.
- 2026-11-17: Dario chose canvas B, sources folded within each kind. SETUP-1 rewritten for it (groups, one-line rows, one row per hook command, `Puzzle` and `U`), SETUP-3.1 follows DS-21's expanded row, SETUP-5.1 gets the off line; `skillOverrides`' values checked and the canvas, icon and values questions closed. Ready, then In Progress.
- 2026-11-17: Slice 1 built: `server/setup.ts` (the reader and both switches, `GET /api/setup`, `POST /api/setup/skill` and `/plugin`), `web/src/lib/setup.ts` and `SetupPanel.tsx`; SETUP-1.1 to 5.1 ticked on their tests. Decided in building: plugins come from `claude plugin list --json`'s user scope only, as its project-scope entries repeat per repo (146 of 172 on this Mac), and a project's plugin joins the Non-goals; a hook's name falls back to the first path in its command, for a script without an extension (`node "$CLAUDE_PLUGIN_ROOT/scripts/workspaces"`); with text in the filter, a section with no match hides its error rows too; the plugin confirmation's Turn off is Primary, not red, as it's undone with one switch; `turn-off` and `turn-on` join the actions table (`ToggleLeft`, `ToggleRight`), since `Power` is End Session's. `RowActions` no longer passes its first action's `action` to the DOM, which React warned about in every panel. Seen running at 1440 px and at 280 px in dark mode with this Mac's Setup: 187 skills on (Yours 102, of which 89 are Codex's), 14 hooks. SETUP-1.9 waits for Dario's look.
- 2026-11-17: Codex review, round 1. SETUP-2.4 covers credentials in an MCP server's arguments and URL, and parse errors (JSON's and TOML's own messages quote the file). SETUP-4.1: switches run one at a time (a plugin's too, as `claude plugin` writes the same file), a linked settings file keeps its link, and a write starts again if the file changed under it. SETUP-4.5 added: `X` switches the selected row, as More's switches had no key and the listbox keeps More out of the Tab order. SETUP-5.1: with no `config.toml`, a Codex hook is untrusted. Fixed without a spec change: an off plugin's skill with a `skillOverrides` entry no longer adds a "not found on disk" row, and a top-level MCP server in `~/.claude.json` opens at its own line, not a project's of the same name.
- 2026-11-17: Codex review, round 2. SETUP-2.4: a URL's whole user info is hidden (a token can be the user, or the password with no user), a flag's value is scrubbed too (`--env=API_TOKEN=…`), and `claude plugin`'s errors are scrubbed before they reach the tab. SETUP-1.8: a read waits for a switch under way, so closing and opening the tab mid-switch shows its result. SETUP-4.1 now says what the check before the rename covers: another writer between Lookout's read and its write. One in the instant between that check and the rename can still be lost, as between Claude Code's own writers, since none of them lock the file.
- 2026-11-17: Codex review, round 3. SETUP-2.4: a URL's user info is hidden through its last `@` (a password can hold one), and a CLI's error hides a secret-named flag's value after a space too (`--api-key …`). SETUP-1.8: a plugin switch joins the queue before looking for the `claude` binary, so a read in that moment waits as well. SETUP-3.1: an unquoted `argument-hint: [issue-number]`, a YAML list, stays in the skill's call.
