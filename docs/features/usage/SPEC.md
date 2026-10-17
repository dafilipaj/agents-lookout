---
title: Usage at a glance
code: USAGE
status: In Progress
created: 2026-10-16
updated: 2026-10-17
---

# Usage at a glance

## Summary

See how close you are to each Harness's limits without leaving Lookout: Claude's 5-hour and weekly windows, and Codex's. Also see whether Jev is installed and set up on this machine. That way you can pick the right agent before one stalls on a rate limit.

## Problem

Limits show up only when an agent stalls. Claude's usage page and Codex's `/status` are a context switch away, and Jev's balance is only visible in the Typesafe console. An exhausted window means a Session stuck in "Needs you" on a rate-limit dialog; we saw this with Codex on 2026-10-16.

## Requirements

### USAGE-1 Always visible
- [x] USAGE-1.1 A compact strip at the bottom of the Session sidebar shows, for Claude and for Codex, the tightest window: the Harness mark, a bar with **% used**, and the time to reset. (test)
- [x] USAGE-1.2 A window at 80% or more is marked as a warning (a triangle icon); at 95% or more, as critical (an octagon icon). The marks are recognizable without colour. (test)
- [x] USAGE-1.3 The numbers refresh on their own: Claude every 60 s, Codex whenever one of its Transcripts records new limits. The strip says how old they are. (manual)
- [x] USAGE-1.4 The strip shows whether Jev is ready (tb-jev installed, with credentials) or not set up. Nothing Lookout does here costs a billed call. (test)

### USAGE-2 Details
- [x] USAGE-2.1 Clicking the strip opens details: each provider's plan, and every window (5-hour, weekly, per-model weekly, extra usage) with its bar, % used and reset time, tightest first. Jev shows its version and where its key comes from. (manual)
- [x] USAGE-2.2 A provider whose numbers can't be read says why: not installed, not signed in, no data yet, or an error. It never shows stale numbers as current. (test)

### USAGE-3 In the launcher
- [x] USAGE-3.1 In the launcher's Harness choice, a Harness with a window at 95% or more shows it next to its name (for example "5h limit 100% · resets 17:30"). It stays selectable. (test)

## Non-goals

- Cost estimates from token counts.
- Switching accounts.
- History or charts of usage over time.
- Providers other than Claude, Codex and Jev (Gemini, OpenCode, …).
- Jev's balance: the Typesafe console shows it, but no API endpoint for it is documented. Revisit if one appears.
- OS notifications when a limit is near.

## UX

```
┌ / filter            + ⚙ ┐
├─────────────────────────┤
│ ◆ fix-deal-rates   ✳    │
│ …                       │
├─────────────────────────┤   the line above the composer (SIDE-8)
│ ✳ ██████░░░░ 62% · 2h10 │   tightest Claude window, resets in 2 h 10 min
│ ⊛ ██████████ 100% ⛔ 17:30│   Codex at its 5-hour limit
│ Jev ✓ ready             │
└─────────────────────────┘
```

- The mock-up uses ⛔ and ✓ as shorthand for the critical octagon and the check icon.
- Clicking the strip opens a popover with the details (USAGE-2.1).
- One grid (SIDE-8): the strip is the Session sidebar's cell in the shell's dock row, so its top line is the line above the composer, or above the ended / View only banner. Whichever side is taller sets the row's height; the strip's lines stay at its top.
- Level icons: a warning triangle (lucide `TriangleAlert`, amber in the `needs-you-text` token, as text and strokes use) at 80% or more, a critical octagon (`OctagonAlert`, red) at 95% or more, alongside the bar's colour. The launcher hint (USAGE-3.1) starts with the same octagon. Icons follow [0008](../../decisions/0008-lucide-icons-only.md).

## Technical approach

- **Claude**, from `fleet usage --json`, which exists today ([0004](../../decisions/0004-fleet-cli-as-session-layer.md)).
  - Gives `account.plan_label` (for example "Team · Max 5x") and `limits[]`, each with `kind` (session, weekly_all, weekly_scoped), `label`, `percent`, `severity` and `resets_at`. It also gives `extra_usage`.
  - Fleet caches it for 60 s and backs off for 2 minutes after a failure.
  - It reads an undocumented Anthropic endpoint, so it may break without notice.
- **Codex**, from its own Transcripts.
  - Each `token_count` event in `~/.codex/sessions/**/rollout-*.jsonl` carries `rate_limits.primary` and `rate_limits.secondary`: `used_percent`, `window_minutes` (300 = 5 hours, 10080 = weekly) and `resets_at`. It also carries `credits.balance`.
  - The numbers are only as fresh as the last Codex turn; Orca has the same limit.
  - **In the Fleet fork** (commit `usage-codex`, `d0e0227`, [0006](../../decisions/0006-run-a-fork-of-fleet.md)), `fleet usage --json` adds `providers[]`. Each entry is `{ id: claude|codex, label, status: ok|stale|no_data|not_installed|error, plan, limits[], fetched_at, observed_at, error, credits }`. Each limit is `{ kind: session|session_scoped|weekly_all|weekly_scoped, group, label, model, percent, severity, resets_at, active }`. The old top-level fields stay Claude-only.
    - `session_scoped` and `weekly_scoped` are Codex per-model windows (`model` set, label ending "· <model>"). Fleet's `severity` bands (now 70/90) aren't used; Lookout derives its marks from `percent`.
    - **Reading it:** Lookout prefers `providers[]` and falls back to the top-level Claude fields only when `providers` is absent (upstream Fleet). It never reads rollout files itself.
    - **Status mapping:** ok becomes ok (no data when there are no limits); stale stays ok, marked old with its reason; no_data, not_installed and error map one to one (an error mentioning login means "not signed in").
    - **Validation:** enums are allowlisted, and unknown kinds and statuses are dropped or become errors. A shape Lookout doesn't know is an error, never "no data". A limits list that isn't empty but holds nothing Lookout understands (unknown kinds, non-numeric `percent`) is an error that keeps the last numbers.
    - **Codex specifics:** a window whose reset passed comes back as 0% with no reset time. `observed_at` is Codex's last turn, and the age shown comes from it.
    - **When Claude can't be read,** Fleet exits 1 but still prints `{ error, providers: [claude with status error, codex live] }`. Lookout parses that, so Claude shows the error with its last numbers kept and marked old, and Codex stays live. Only when there's no JSON on stdout does it show "usage unavailable: <reason>" for both.
- **Jev** (Typesafe System One, `api.typesafe.ai`, through `tb-jev` in cli-toolbox).
  - `tb-jev doctor` always makes a tiny *billed* evaluation, so Lookout must not poll it.
  - **Gap, in cli-toolbox:** add `tb-jev status --json`, which makes no network call ([0005](../../decisions/0005-building-blocks-live-outside-lookout.md)). It reports the version, where the credentials come from (env `TYPESAFE_API_KEY`, the config file, or none) and the base URL.
  - Checked 2026-10-16: tb-jev 0.1.0 is installed, and `TYPESAFE_API_KEY` is in the login environment.
  - **Contract (tb-jev 0.2.0, in review):** `tb-jev status --json` always prints one object with 13 fields: `version`, `ready`, `key_present`, `key_source: env|config|none`, `base_url` (already reduced to scheme://host[:port]), `base_url_source`, `base_url_has_path`, `base_url_hidden`, `config_path`, `config_exists`, `config_valid` (null when an env key is set), `config_used` and `error_reason`. Exit 0 means ready, 4 not ready (the object is still printed), 1 an I/O error. Lookout requires `ready` (bool), `version` (string) and `key_source` (in the enum); a malformed or self-contradicting object (ready with exit 4, not ready with exit 0, ready without `key_present: true`, ready with no key source) is an error, never "ready".
  - **How Lookout maps it:**
    - not on PATH or in `~/.local/bin`: "not installed";
    - exit 2 (clap refuses `status`, as 0.1.0 does): "update tb-jev (needs 0.2+ for status)";
    - exit 0: "ready", with a check icon; exit 4: "not set up: <error_reason>";
    - anything else: "error", with a short reason.
  - The details show the version, where the key comes from ("env TYPESAFE_API_KEY", "config file" or "none"), the base URL, and the config path when one is used, never its contents.
  - Lookout runs only `status --json`, never `doctor`, `ask` or `--version`: on start, when the details open (at most once every 10 s), and otherwise at most every 5 minutes.
- **Lookout's side:**
  - **Nothing secret reaches the UI:** reasons from Fleet's stderr, its `error` fields and tb-jev's `error_reason` are cut to one line of about 160 characters, with token-like text redacted (`sk-…`, `Bearer …`, long base64 or hex runs, `user:pass@`). Labels are bounded, and a base URL that isn't plain scheme://host[:port] isn't shown.
  - **Times:**
    - **Claude** is read every 60 s, so numbers more than 5 minutes old mean its reads are failing: they're marked old.
    - **Codex** numbers are as of its last turn (`observed_at`), and stay correct between turns. A successful read shows a neutral grey "as of last turn · 17m", however long ago that turn was. Codex's age comes from `observed_at` only; falling back to the read time is only for legacy Claude data.
    - **Amber "old · …"** is only for failed or stale reads, numbers older than ones already shown, an unknown age (no usable time), or clock skew (a time more than 2 minutes in the future).
    - **High-water mark:** the newest numbers accepted so far stay shown, marked old, until Fleet returns something at least as new; an older reading never becomes current, however often it repeats.
  - **A window whose reset has passed** shows "reset · refreshing", leaves the tightest pick and the launcher hint, and makes the tab ask for a new read (at most every 15 s). The launcher hint says how old the numbers are when they're old.
  - **Cadence and processes:** the 60 s cadence counts from each read's start. One Fleet read and one Jev probe run at a time, shared by every caller. On shutdown the server cancels them, kills their process groups, and waits for them to exit.
  - One server poller for every tab runs `fleet --local usage --json` every 60 s while a tab is connected, with the same runner, cleaned environment and timeouts as the rest. It pushes a `usage` event over the existing event stream, only when something changed, and the snapshot carries the latest numbers.
  - A read that fails keeps the last numbers, marked old, with the reason.
  - Each provider's line in the strip says how old its numbers are ("updated 1m ago", "as of last turn · 17m", or amber "old · …"); the Jev line carries only Jev's own state.
- **Reference:** Orca shows usage in its status bar. Clicking opens a roster per provider (plan, soonest reset, per-window bars, tightest first), with a warning at 80% and a "% used / % remaining" setting. It reads only local state, with no API calls.

### Key decisions

- **At the bottom of the Session sidebar**: always visible, which is the point; the right sidebar is closed most of the time.
- **% used**: what Claude's and Codex's own screens show.
- **No Jev balance**: there's no endpoint for it. Showing that Jev is set up is still useful, and costs nothing.
- **Launcher hint, not a block**: you may know a window resets in a minute.

## Open questions

None.

## Changelog

- 2026-10-16: Created.
- 2026-10-16: Answers: the strip sits at the bottom of the Session sidebar, and shows % used. Jev's balance is skipped (no endpoint); show whether Jev is set up instead, via a new `tb-jev status --json` with no network call.
- 2026-10-16: Launcher hint added (USAGE-3.1). Ready.
- 2026-10-16: In Progress. Claude from `fleet usage --json`, polled every 60 s while a tab is open; Codex read only from Fleet ("not available yet" until the fork adds it); Jev wired to `tb-jev status --json` (0.2.0 contract), probed rarely.
- 2026-10-16: Review round 2: exact Fleet `providers[]` and tb-jev 13-field contracts; sanitized reasons; expired windows and freshness handled; single-flight reads, cancellation on shutdown. USAGE-1.3 verified live: a Codex turn's new numbers showed within the 60 s poll.
- 2026-10-16: Review round 3: `session_scoped` windows; Claude errors with exit 1 keep Codex live; a high-water mark so older readings never become current; rejected limits are errors; Codex age only from `observed_at`, shown neutrally as "as of last turn"; amber only for flagged ages; the five-minute rule now applies to Claude only.
- 2026-10-17: UX: the strip sits in the app shell's dock row (SIDE-8), so its top line continues as the line above the composer.
- 2026-10-17: Icons per [0008](../../decisions/0008-lucide-icons-only.md): the USAGE-1.2 level icons and the launcher hint are lucide icons (a warning triangle, a critical octagon) instead of ⚠ and ⛔; Jev's "ready" carries a check icon instead of ✓.
