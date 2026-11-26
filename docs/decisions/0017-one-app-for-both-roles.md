---
status: Accepted
date: 2026-11-26
---

# 0017. One app for both roles: places on a rail, one right sidebar, Bots for both

## Context

Lookout serves the contributor half of an engineering manager's job. Since agents write the code, a manager is expected to spend 30 to 70% of the time as a contributor and the rest managing people. The two halves have one shape: hand work off, wait, review, unblock. Dario (2026-11-26) wants the managing half in the same app, to stop switching between tools: reports that arrive by themselves (what the team did last week, progress on a goal from a 1:1), people and their goals, and the scheduled agents that write those reports.

Three layouts were drawn on a canvas. Dario chose the rail, the names "Sessions" and "People", and Bots as a tab of the right sidebar. Seven questions about how a Bot runs were settled the same day.

## Decision

- **Places.** Lookout's top level is a few places, switched on a rail at the window's left edge: the Inbox, Sessions, and later People. Sessions is the Lookout that existed before this decision. Settings and Keyboard shortcuts sit at the rail's bottom.
- **A place owns the left column and the main pane, and nothing else.** There is one main pane, one launcher and one right sidebar, with the same tabs and keys in every place.
- **A place joins the rail when it has a page.** People isn't on it until its first slice is built.
- **Bots belong to both roles.** They are one tab of the right sidebar, not a part of People.
- **A Bot's run is a Session on this Mac**, started the way the launcher starts one ([0002](0002-start-sessions-through-a-login-shell.md)). It shows in Sessions and can Need you.
- **Lookout ends a Bot's Session once its run has finished**, unless you opened that Session in Lookout. It is the one case where Lookout ends a Session by itself.
- **One finished run is one item in the Inbox**, a Report: what the run's Session produced, or its last reply, or why it failed.
- **A time a Bot missed** while the Mac slept or Lookout wasn't running is run once when Lookout is back.

## Alternatives rejected

- **Inbox and People as two more tabs of the right sidebar** (canvas B): the cheapest, and the Session list stays in view. A person's page loses the right sidebar to its own list, and the strip grows to eight tabs.
- **A switch in the left column's header** (canvas C): it costs no width, but three places and Settings are tight at 280 px and a fourth place has no room.
- **Modules with sidebars of their own:** the switch between tools would move inside the window. Work, History, Topics and the Library are about both roles.
- **Bots under People:** a nightly look at flaky tests is as useful as a Monday team report.
- **A Bot's run as a cloud scheduled task:** it runs with the Mac off, but only with claude.ai connectors, and Lookout can't list or manage those tasks by itself.
- **A Bot's run as `claude -p`:** [0013](0013-one-shot-claude-runs-for-lookouts-own-text.md) allows that only with no tools, and a run that can't Need you fails where nobody sees it.
- **Leaving a Bot's Session until you end it:** a daily Bot would leave one live Session a day, each holding memory.
- **One Inbox item per document, or only what a run writes into a folder Lookout names:** the first leaves nothing for a run that wrote no document or failed; the second makes every Bot's prompt follow a rule of Lookout's.

## Consequences

- The shell gains a column. The Session sidebar's header gives Lookout's mark, Settings and Keyboard shortcuts to the rail (NAV).
- The Glossary's Done gains its one exception.
- A Bot needs the Mac on. Lookout doesn't wake it.
- Lookout ships no Bot: what each one asks is Dario's to design.
- Follow-ups, each its own spec or slice: People (people, their folders and Goals); where people's data lives and how it's kept off a shared screen; the composer under a Report, which asks the Session that wrote it; a right-sidebar tab narrowed to what's open in the main pane; Pings and Review requests in the Inbox.
