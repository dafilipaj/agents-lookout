---
status: Accepted
date: 2026-11-27
---

# 0018. People's data lives in your vault: Lookout reads it, keeps none, and never shows a Private folder

## Context

[0017](0017-one-app-for-both-roles.md) left two questions for the People place: where people's data lives, and how it is kept off a shared screen. Dario (2026-11-27) pointed at the folder of notes he keeps in Obsidian: "I think thats where people and meeting data should be kept. I'm also thinking about storing reports there instead of work output folder. If we decide to use Obsidian vault as storage we might want to make its path configurable in settings."

A read of that folder's structure (names and repeated headings only) found:

- A folder per person, with their 1on1 notes in a folder inside it, named by date, and their review notes beside them.
- Meeting notes in a folder per series, named by date or week.
- Everything arranged by folder and file name. No note of a person or a meeting has properties.
- No Goal per person anywhere outside the review notes.
- Most notes kept in the cloud and not on disk: reading one downloads it.

Lookout's Library already listed 69 files from a review cycle's folder, because Sessions had written them, and since the Document view ([DOC](../features/document-view/SPEC.md)) they open in the main pane. The second question was no longer about a place that doesn't exist yet.

## Decision

- **The Vault is the system of record** for people, their 1on1 notes, their Goals and meeting notes. Lookout keeps no copy and no index of it on disk.
- **Lookout reads the Vault by its folders and file names**, the convention the notes already follow: a folder per Person, `1on1s/` and `Goals/` inside it. It asks for no properties and no schema.
- **Lookout doesn't write to the Vault.** Notes are written in the notes app, or by a Session or a Bot's run.
- **Where a Bot's run writes is its prompt's to say** ([0017](0017-one-app-for-both-roles.md)): a Report can be a note in the Vault, and Lookout names no folder for it.
- **The Vault's folder is a setting.** Nothing in Lookout, its specs or its tests names a path of yours.
- **A Goal is a top-level checklist item** in a Person's note for one quarter, in that Person's `Goals` folder.
- **Private folders are a list in Settings.** No file under one is an Output, and the Document view never shows one. It is a rule about folders, never about file names.

## Alternatives rejected

- **A store of Lookout's own for people and Goals:** a second system of record, which drifts from the notes the moment one is edited in the notes app.
- **Properties on each note, or a database:** about 300 notes would need rewriting, and the views he already has filter by folder and name.
- **Hiding by file name** (`360`, `feedback`): names drift, and one note named differently would show.
- **Reports kept in the work repo's ignored `output/` folder:** they stay out of the notes app, where he reads and links everything else.
- **A plugin for the notes app instead of a place in Lookout:** the switch between tools is what 0017 set out to remove.
- **Goals read from the review notes:** those are the notes that must stay off the screen.

## Consequences

- People needs the Vault's folder set, and macOS's permission to read it. Without either, the place says what to do.
- Lists come from folder and file names alone, so drawing one downloads nothing. Opening a note reads it, which downloads a note kept in the cloud, and fails offline.
- A Person's review notes have to sit in a folder of their own to be private: a move in the notes app, once. A note that was moved leaves no row behind under its old name: a file in the Vault that no longer exists is no Output.
- A Private folder covers Lookout's lists of documents and its reader. It doesn't cover what a Session's own chat shows, what History finds in a Transcript, or the changed files of a Session working in a Vault kept in git.
- A Markdown note's links to other notes (`[[…]]`) show as written, until a slice gives them a meaning.
- The repo is public: fixtures are invented people and notes, never copies.
- Follow-ups, each a slice of [PEOPLE](../features/people/SPEC.md) or its own spec: meeting series; starting a Session about a Person; a Bot per Person; the People place hidden while you share your screen.
