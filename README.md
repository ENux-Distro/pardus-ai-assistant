# Pardus AI Assistant

An AI assistant for **absolute Linux beginners** — people who just
switched from Windows and know nothing technical. It uses [OpenCode](./opencode)
as its AI brain (completely hidden from the user) to turn plain-language
questions into simple explanations and one-click, confirmation-gated actions.

This is **not** OpenCode with a skin, a terminal, or an IDE. The user never sees
a terminal, never copies a command, and nothing happens to their system without
an explicit "Yes, do it". Theme: Pardus yellow / black / white.

## Status

First working slice — verified end to end:

- ✅ Invisible OpenCode engine (spawned as a hidden child process, talked to via
  the typed SDK — no CLI stdout scraping)
- ✅ Chat: natural language in, real model reply out
- ✅ System detection (distro, desktop, kernel, package managers)
- ✅ Beginner persona (tools disabled — the AI only talks, never acts on its own)
- ✅ Safety classifier (safe / caution / danger) + plain-language confirmation dialog
- ✅ Command extraction → friendly inline action cards ("Do it for me")
- ✅ Confirmed execution → friendly inline result ("✓ All done" / details tucked away)
- ✅ Failed action auto-explains the error in simple terms
- ✅ Copilot-style centered chat, Pardus yellow/black/white, no terminal

Next steps: token streaming, Agent mode multi-step execution, error explainer,
and the Tauri desktop shell (see below).

## Architecture

```
pardus-assistant/
  backend/                 Bun service — the only thing that touches OpenCode or the shell
    src/
      config.ts            Paths/ports, all env-overridable
      opencode.ts          Spawns the hidden OpenCode server + SDK client + sessions
      system.ts            Read-only distro / DE / package-manager detection
      safety.ts            Command risk classifier (allow-list for "safe")
      run.ts               Executes confirmed commands, streams output, audit log
      server.ts            HTTP + JSON API, serves the frontend
  frontend/                Plain HTML/CSS/JS (framework-free, Tauri-ready)
    index.html  styles.css  app.js
  opencode/                OpenCode engine — cloned + compiled from our fork by
                           `make engine` (not committed; gitignored)
```

**Why the engine is wrapped, not shelled out to:** OpenCode ships a headless
HTTP server and a typed JS SDK. We spawn that server with stdio hidden and use
the SDK's structured session API. Replies, message parts, and errors are real
data — nothing breaks when OpenCode changes its terminal formatting.

### JSON API

| Method | Path           | Body                          | Returns                              |
|--------|----------------|-------------------------------|--------------------------------------|
| GET    | `/api/system`  | —                             | distro / desktop / package managers  |
| POST   | `/api/chat`    | `{ message }`                 | `{ text, commands[] }`               |
| POST   | `/api/run`     | `{ command, confirmed:true }` | SSE stream of stdout/stderr/exit     |

The backend **refuses to run any command** unless `confirmed:true` is sent —
which the GUI only does after the user clicks through the confirmation dialog.

## Installing & running

One-line install (clones the repo, installs prerequisites, runs `make install`):

```bash
curl -fsSL https://raw.githubusercontent.com/ENux-Distro/pardus-ai-assistant/main/install | bash
```

Or manually, requires Bun 1.3+, from this directory:

```bash
make install     # clone+compile the engine + a `pardus-assistant` command + menu entry
pardus-assistant # starts the server (hidden) and opens the app in its own window
```

`make install` does three things: **clones and compiles the OpenCode engine
from our fork** (`ENux-Distro/opencode`) into `./opencode` — the slow,
first-time step, a few minutes — then symlinks a `pardus-assistant` launcher
into `~/.local/bin`, and adds a "Pardus Assistant" entry to your application
menu. Re-running `make install` (or `make engine`) updates and recompiles the
engine, so it stays patchable and current rather than frozen at clone time.

Other targets:

| Command            | What it does                                            |
|--------------------|---------------------------------------------------------|
| `make run`         | run the backend in the foreground (dev)                 |
| `make app`         | start (if needed) and open the app window               |
| `make stop`        | stop the background server                              |
| `make logs`        | follow the server log                                   |
| `make uninstall`   | remove the command and menu entry (keeps your chats)    |

The launcher opens the UI in its own **native window** (a small WebKitGTK
webview — no tabs, address bar or browser chrome), so it feels like an app rather
than a website. Closing the window stops the background server. This needs
WebKitGTK + PyGObject, which Pardus/Debian ship as:

```bash
sudo apt install python3-gi gir1.2-webkit2-4.1
```

If those aren't present it falls back to a Chromium app window, then to your
default browser. Plain dev run is still just `bun run backend/src/server.ts` →
open <http://127.0.0.1:5174>.

## Conversations

Chats are saved automatically under
`~/.local/share/pardus-assistant/conversations/` (one JSON file each) and listed
in the sidebar — click to reopen, 🗑 to delete, "+ New conversation" to start
fresh. Each conversation is backed by its own OpenCode session, so reopening one
continues with its original context. Action buttons and agent plans are
reconstructed from the saved transcript when a chat is reopened.

> OpenCode needs a model provider configured (e.g. an Anthropic API key) to
> answer. If none is set, chat returns a friendly "no model configured" error
> instead of crashing.

### Useful env vars

| Var             | Default              | Purpose                                  |
|-----------------|----------------------|------------------------------------------|
| `PARDUS_PORT`   | `5174`               | UI/API port                              |
| `OPENCODE_PORT` | `5179`               | hidden engine port                       |
| `OPENCODE_CMD`  | `bun`                | how to launch the engine                 |
| `PARDUS_WORKDIR`| `$HOME`              | folder the assistant operates in         |

## Desktop shell (Tauri) — next step

The toolchain isn't installed on this machine yet. To add the desktop wrapper:

```bash
# 1. Rust + Tauri prerequisites (Debian/Pardus)
sudo apt install libwebkit2gtk-4.1-dev build-essential curl libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev
curl https://sh.rustup.rs -sSf | sh
cargo install tauri-cli

# 2. scaffold, pointing Tauri at the existing frontend
cargo tauri init   # frontendDist = ../frontend, devUrl = http://127.0.0.1:5174
```

In `src-tauri`, bundle the Bun backend as a **sidecar** and spawn it on startup
so the user launches a single app. Because the frontend already talks to the
backend over `127.0.0.1`, no frontend changes are needed.

## Safety model

- Commands are classified **before** the user sees them; the card and dialog are
  colour-coded safe / caution / danger.
- `safe` is an allow-list of read-only commands. Anything unrecognised defaults
  to `caution`.
- `danger` (recursive delete, disk writes, fork bombs, power-off, …) shows a red
  dialog and still requires explicit confirmation.
- Every executed command is appended to `backend/actions.log`.
- The user can cancel at the dialog, and execution output is read-only.
