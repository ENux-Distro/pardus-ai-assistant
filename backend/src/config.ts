// Central configuration. Everything here can be overridden by an environment
// variable so the same backend works whether it is launched from `bun dev`,
// from a packaged Tauri sidecar, or from a system service.

const env = process.env

// Where the backend listens for the GUI (web UI / Tauri webview).
export const HTTP_HOST = env.PARDUS_HOST ?? "127.0.0.1"
export const HTTP_PORT = Number(env.PARDUS_PORT ?? 5174)

// How we launch the (invisible) OpenCode server.
//
// We do not require `opencode` to be on PATH. By default we run it straight
// from the bundled source with Bun. In a packaged build, point OPENCODE_CMD at
// the real `opencode` binary instead.
export const OPENCODE_CMD = env.OPENCODE_CMD ?? "bun"
export const OPENCODE_ARGS = env.OPENCODE_ARGS
  ? env.OPENCODE_ARGS.split(" ")
  : ["run", new URL("../../../opencode/packages/opencode/src/index.ts", import.meta.url).pathname]

// The OpenCode server binds here. It is never exposed to the user.
export const OPENCODE_HOST = "127.0.0.1"
export const OPENCODE_PORT = Number(env.OPENCODE_PORT ?? 5179)

// Path to the bundled SDK source. We import it directly so there is no build step.
export const SDK_ENTRY = new URL("../../../opencode/packages/sdk/js/src/index.ts", import.meta.url).pathname

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
