---
status: Accepted
date: 2026-10-16
---

# 0003. Browser first: React web UI served by a local Node server

## Context

- In-house setups (Fleet, YugoTool) and nearly all public agent apps use React + Vite + Tailwind + shadcn/ui.
- Claude can verify a web UI itself (Playwright, Chrome DevTools); that's the fix for the old dashboard's "ugly" outcome.
- The desktop shell is split in-house (Fleet: Tauri, YugoTool: Electron), and both UIs also run in a plain browser.

## Decision

- UI: React + Vite + TypeScript + Tailwind + shadcn/ui, opened in Chrome.
- A small local Node server does the real work (starting Sessions, killing processes, reading Transcripts) by calling Building blocks, and talks to the UI over HTTP and server-sent events.
- The server binds `127.0.0.1` only and checks the `Origin` header or a token, because it can start and kill processes.
- No desktop shell yet. Chrome's "Install as app" covers the Dock icon and ⌘-Tab until a real need appears.

## Alternatives rejected

- **Native macOS app (Swift)**: Dario's weakest stack, Claude can't verify it visually, and nothing can be shared with colleagues' UIs.
- **Choosing Electron or Tauri now**: a wrapper around a working web app is a small, late step.

## Consequences

- The server needs to start on its own (launchd) once Lookout is used daily.
- Notifications while the tab is closed need either the shell or another channel.
