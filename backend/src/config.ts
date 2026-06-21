// Central configuration. Everything here can be overridden by an environment
// variable so the same backend works whether it is launched from `bun dev`,
// from a packaged Tauri sidecar, or from a system service.

import { existsSync } from "node:fs"

const env = process.env

// Locate the OpenCode engine. The installer clones the ENux-Distro/opencode
// fork into ./opencode and compiles it (see `make engine`); it is NOT committed
// to this repo. A sibling checkout (../opencode) is only used in dev setups.
// Resolving nested-first matters: pointing at a non-existent path makes the
// engine fail with "Module not found", which used to look like the app hanging.
const ENGINE_SRC = (() => {
  const nested = new URL("../../opencode/", import.meta.url).pathname
  const sibling = new URL("../../../opencode/", import.meta.url).pathname
  if (existsSync(nested)) return nested
  return sibling
})()

// The compiled single binary produced by the fork's build (build.ts --single):
//   <engine>/packages/opencode/dist/opencode-<platform>-<arch>/bin/opencode
// We prefer this over running raw TypeScript: it starts far faster (no per-boot
// transpile) and is what `make engine` produces. If it's missing (dev setup
// that hasn't compiled yet), we fall back to running from source with Bun.
const ENGINE_BIN = `${ENGINE_SRC}packages/opencode/dist/opencode-${process.platform}-${process.arch}/bin/opencode`
const HAVE_BIN = existsSync(ENGINE_BIN)

// Where the backend listens for the GUI (web UI / Tauri webview).
export const HTTP_HOST = env.PARDUS_HOST ?? "127.0.0.1"
export const HTTP_PORT = Number(env.PARDUS_PORT ?? 5174)

// How we launch the (invisible) OpenCode server. We do not require `opencode`
// on PATH: prefer the compiled binary, else run from source with Bun. Both are
// overridable via OPENCODE_CMD / OPENCODE_ARGS (e.g. a Tauri sidecar).
export const OPENCODE_CMD = env.OPENCODE_CMD ?? (HAVE_BIN ? ENGINE_BIN : "bun")
export const OPENCODE_ARGS = env.OPENCODE_ARGS
  ? env.OPENCODE_ARGS.split(" ")
  : HAVE_BIN
    ? []
    : ["run", `${ENGINE_SRC}packages/opencode/src/index.ts`]

// The OpenCode server binds here. It is never exposed to the user.
export const OPENCODE_HOST = "127.0.0.1"
export const OPENCODE_PORT = Number(env.OPENCODE_PORT ?? 5179)

// Path to the bundled SDK source. We import it directly so there is no build step.
export const SDK_ENTRY = `${ENGINE_SRC}packages/sdk/js/src/index.ts`

// Working directory confirmed commands actually run in (the user's home, so
// "install X" feels like it happened in the normal place).
export const WORK_DIR = env.PARDUS_WORKDIR ?? env.HOME ?? process.cwd()

// Where saved conversations live. Follows the XDG data-dir convention so it
// survives reinstalls and sits where a Linux user expects their app data.
export const DATA_DIR =
  env.PARDUS_DATA_DIR ??
  `${env.XDG_DATA_HOME ?? `${env.HOME}/.local/share`}/pardus-assistant`

// Directory the OpenCode *engine* itself is rooted in. This is deliberately
// NOT the user's home: on every prompt, OpenCode walks this directory (and
// its parents) looking for skills/AGENTS.md/project context, and a $HOME full
// of repos and node_modules turns that into a multi-minute (or worse) crawl
// on every single message. Beginner chat never needs real project context, so
// give the engine its own tiny, empty directory instead.
export const ENGINE_DIR = env.PARDUS_ENGINE_DIR ?? `${DATA_DIR}/engine-workdir`
