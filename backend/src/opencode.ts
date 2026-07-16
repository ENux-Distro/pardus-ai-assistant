// Wrapper around the OpenCode engine.
//
// OpenCode ships a headless HTTP server plus a typed JS SDK. We spawn that
// server as a hidden child process (the user never sees a terminal) and talk to
// it through the SDK. Nothing here scrapes CLI stdout for answers — we use the
// structured session API so replies, parts and errors are real data.

import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { mkdirSync } from "node:fs"
import {
  OPENCODE_CMD,
  OPENCODE_ARGS,
  OPENCODE_HOST,
  OPENCODE_PORT,
  SDK_ENTRY,
  ENGINE_DIR,
  ENGINE_STORAGE_DIR,
} from "./config.ts"
import { detectLang } from "./locale.ts"

// Ask the OS for a free port near our preferred one, so a leftover/older engine
// holding the default port can never block startup again.
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.listen(0, OPENCODE_HOST, () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
    srv.on("error", () => resolve(OPENCODE_PORT))
  })
}

type Client = any // SDK is imported dynamically; its types live in the SDK package.

let proc: ChildProcess | undefined
let client: Client | undefined
let baseUrl: string | undefined

// Resolve once the server prints its "listening" line, reject on early exit.
function waitForReady(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ""
    let done = false

    const timer = setTimeout(() => {
      if (done) return
      done = true
      reject(new Error("OpenCode server did not start within 30s"))
    }, 30_000)

    const onData = (chunk: Buffer) => {
      if (done) return
      output += chunk.toString()
      const match = output.match(/listening on\s+(https?:\/\/[^\s]+)/i)
      if (!match) return
      done = true
      clearTimeout(timer)
      resolve(match[1])
    }

    child.stdout?.on("data", onData)
    child.stderr?.on("data", onData) // some builds log the banner to stderr
    child.on("exit", (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(new Error(`OpenCode server exited early (code ${code}).\n${output}`))
    })
  })
}

// Start the engine. Safe to call more than once. Sessions are created per
// conversation (see createSession), not here.
export async function start(): Promise<void> {
  if (client) return

  // Keep the engine rooted in its own tiny, empty directory — never the
  // user's home. OpenCode rescans this tree (skills, AGENTS.md, project
  // context) on every prompt, and a real $HOME full of repos/node_modules
  // turns that into a multi-minute crawl per message.
  mkdirSync(ENGINE_DIR, { recursive: true })

  // Give the engine its own storage tree via XDG overrides, instead of
  // inheriting the real $HOME's ~/.config/opencode and ~/.local/share/opencode.
  // Without this, our bundled engine silently shares a sessions/messages
  // SQLite database with any other OpenCode install on the machine — a
  // schema mismatch between the two then surfaces as a random-looking
  // "SQLiteError: no such column" on every chat.
  const xdgData = `${ENGINE_STORAGE_DIR}/data`
  const xdgCache = `${ENGINE_STORAGE_DIR}/cache`
  const xdgConfig = `${ENGINE_STORAGE_DIR}/config`
  const xdgState = `${ENGINE_STORAGE_DIR}/state`
  for (const dir of [xdgData, xdgCache, xdgConfig, xdgState]) mkdirSync(dir, { recursive: true })

  const port = await freePort()
  proc = spawn(
    OPENCODE_CMD,
    [...OPENCODE_ARGS, "serve", "--hostname", OPENCODE_HOST, "--port", String(port)],
    {
      cwd: ENGINE_DIR,
      // Hidden from the user, but NOT discarded: we forward the engine's output
      // to our own log. Without this, engine-side failures (no model/API key
      // configured, provider errors) are invisible and look like the app just
      // hanging forever. The user never sees this — it only hits the log file.
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        XDG_DATA_HOME: xdgData,
        XDG_CACHE_HOME: xdgCache,
        XDG_CONFIG_HOME: xdgConfig,
        XDG_STATE_HOME: xdgState,
      },
    },
  )
  const logEngine = (chunk: Buffer) => process.stderr.write(`[engine] ${chunk}`)
  proc.stdout?.on("data", logEngine)
  proc.stderr?.on("data", logEngine)

  baseUrl = await waitForReady(proc)

  const sdk = await import(SDK_ENTRY)
  client = sdk.createOpencodeClient({ baseUrl, directory: ENGINE_DIR })
}

// Open a fresh OpenCode session and return its id. Each saved conversation owns
// one, so their histories/context stay separate.
export async function createSession(): Promise<string> {
  if (!client) await start()
  const created = await client.session.create({ body: { title: "Pardus Assistant" } })
  const id = created.data?.id ?? created.id
  if (!id) throw new Error("Could not create an OpenCode session")
  return id
}

// Make sure a saved conversation's session still exists in the engine (it may
// be gone after, e.g., clearing engine storage). Returns the same id if it's
// alive, or a brand-new session id to fall back to.
export async function ensureSession(sessionID: string): Promise<string> {
  if (!client) await start()
  const res = await client.session.get({ path: { id: sessionID } }).catch(() => ({ error: true }))
  if (res && !res.error && (res.data?.id ?? res.id)) return sessionID
  return createSession()
}

// Stop the engine. Called on shutdown so we never leave an orphan server.
export function stop(): void {
  proc?.kill("SIGTERM")
  proc = undefined
  client = undefined
  modelsCache = undefined
}

// ---------- free models ----------
//
// This app only ever uses OpenCode's built-in "opencode" provider (OpenCode
// Zen), which works with zero configured API keys. We restrict the picker to
// its genuinely free models (cost 0) — never a paid one the user didn't ask
// to be billed for.

export type ModelRef = { providerID: string; modelID: string; label: string }

// Safety net if the live provider list can't be fetched (engine not up yet,
// network hiccup talking to the catalogue, or the "opencode" provider is
// briefly absent). Mirrors OpenCode Zen's free lineup at the time of writing;
// order matters — it's also the fallback chain (see askChain below).
const FALLBACK_CHAIN: ModelRef[] = [
  { providerID: "opencode", modelID: "big-pickle", label: "Big Pickle" },
  { providerID: "opencode", modelID: "hy3-free", label: "Hy3" },
  { providerID: "opencode", modelID: "north-mini-code-free", label: "North Mini Code" },
  { providerID: "opencode", modelID: "mimo-v2.5-free", label: "MiMo V2.5" },
  { providerID: "opencode", modelID: "deepseek-v4-flash-free", label: "DeepSeek V4 Flash" },
  { providerID: "opencode", modelID: "nemotron-3-ultra-free", label: "Nemotron 3 Ultra" },
]

let modelsCache: ModelRef[] | undefined

// The ordered chain of free models to try. Fetched once from the running
// engine (so it stays current if OpenCode Zen's free lineup changes) and
// cached for the life of the process; falls back to FALLBACK_CHAIN if the
// engine can't be asked.
export async function listModels(): Promise<ModelRef[]> {
  if (modelsCache) return modelsCache
  if (!client) await start()
  try {
    const res = await client.config.providers()
    const providers = res.data?.providers ?? res.providers ?? []
    const opencode = providers.find((p: any) => p.id === "opencode")
    const free = Object.values(opencode?.models ?? {})
      .filter((m: any) => m.cost?.input === 0 && m.cost?.output === 0)
      .map((m: any): ModelRef => ({ providerID: "opencode", modelID: m.id, label: m.name ?? m.id }))
    if (free.length) {
      // Keep FALLBACK_CHAIN's ordering for any model both lists agree on
      // (it's tuned: general-purpose first, huge-context last-resort last),
      // then append anything new the catalogue added.
      const known = FALLBACK_CHAIN.map((m) => m.modelID)
      free.sort((a, b) => {
        const ia = known.indexOf(a.modelID)
        const ib = known.indexOf(b.modelID)
        if (ia === -1 && ib === -1) return 0
        if (ia === -1) return 1
        if (ib === -1) return -1
        return ia - ib
      })
      modelsCache = free
      return free
    }
  } catch {}
  modelsCache = FALLBACK_CHAIN
  return FALLBACK_CHAIN
}

// Reply in the user's language. Detected once from the system locale; Pardus is
// Turkish by default but we follow whatever the OS reports. We also tell the
// model to mirror the user if they switch languages mid-conversation.
const LANG = detectLang()
const LANG_DIRECTIVE =
  LANG === "tr"
    ? "- Always answer in Turkish (Türkçe), in natural everyday language. If the user clearly writes in another language, reply in that language instead."
    : "- Always answer in English. If the user clearly writes in another language, reply in that language instead."

// Persona: this is a Linux helper for absolute beginners, not a coding agent.
// Keep answers short and friendly, and put any command on its own ```bash line
// so the GUI can turn it into a safe action button.
const PERSONA = [
  "You are Pardus Assistant, a friendly helper for people who are brand new to Linux.",
  "Many users have just switched from Windows and know nothing technical.",
  "Rules:",
  LANG_DIRECTIVE,
  "- Use plain, warm language. Never assume Linux knowledge. Avoid jargon; if you must use a term, explain it in a few words.",
  "- Keep answers short: a one-line reassurance, then simple numbered steps.",
  "- When a step needs a command, put that command ALONE on its own line inside a ```bash code block. One command per block. The app turns these into safe buttons the user can click.",
  "- Prefer the tools that exist on this machine. Never suggest destructive commands unless explicitly asked.",
  "- Never tell the user to open a terminal or copy-paste — the app runs commands for them after they confirm.",
].join("\n")

const NO_TOOLS = Object.fromEntries(
  ["bash", "shell", "write", "edit", "apply_patch", "read", "grep", "glob", "list", "task", "todo", "question", "plan", "webfetch", "websearch", "skill"].map(
    (t) => [t, false],
  ),
)

// Agent persona: the same friendly helper, but it now plans a whole multi-step
// task up front. It is still a PLANNER, not an executor — tools stay disabled so
// nothing runs without the user confirming each step in the GUI.
const AGENT_PERSONA = [
  PERSONA,
  "",
  "AGENT MODE: The user gave you a goal that takes several steps (for example, setting up a programming environment).",
  "Write a short, friendly intro sentence, then lay out the WHOLE plan as an ordered list.",
  "For every step:",
  "- Start the line with the step number and a short plain-language title (e.g. '1. Install Python').",
  "- On the next lines, put the single command for that step inside a ```bash code block.",
  "Exactly one command per step. Order the steps so each works after the previous one. Do not add steps that need no command.",
].join("\n")

export type AskResult = {
  text: string
  error?: string
}

// Core: send one message under a given persona, return the assistant text.
async function prompt(system: string, message: string, sessionID: string, model?: ModelRef): Promise<AskResult> {
  if (!client) await start()

  const res = await client.session.prompt({
    path: { id: sessionID },
    // Disable every tool: the model must only talk. It never touches the
    // system itself — commands run only through our confirmed action buttons.
    body: {
      system,
      tools: NO_TOOLS,
      parts: [{ type: "text", text: message }],
      ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
    },
  })

  if (res.error) return { text: "", error: typeof res.error === "string" ? res.error : JSON.stringify(res.error) }

  const parts = res.data?.parts ?? res.parts ?? []
  const text = parts
    .filter((p: any) => p.type === "text" && typeof p.text === "string")
    .map((p: any) => p.text)
    .join("\n")
    .trim()

  if (!text) return { text: "", error: "OpenCode returned no text. Is a model/provider configured?" }
  return { text }
}

// Streaming core: start generation and forward text as it is produced, so the
// GUI can show the answer flowing word by word instead of appearing all at once.
async function stream(
  system: string,
  message: string,
  sessionID: string,
  onDelta: (t: string) => void,
  model?: ModelRef,
): Promise<AskResult> {
  if (!client) await start()

  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), 120_000)
  // Subscribe to events BEFORE prompting so we don't miss the first tokens.
  const events = await fetch(`${baseUrl}/event`, { signal: ac.signal })
  const reader = events.body!.getReader()
  const decoder = new TextDecoder()

  let error: string | undefined
  // Kick off generation. If the prompt itself fails (e.g. no model/provider
  // configured, auth error), surface that and stop waiting — otherwise we'd
  // block on events that never arrive until the 120s timeout fires, which the
  // user experiences as an endless hang with no answer.
  client.session
    .promptAsync({
      path: { id: sessionID },
      body: {
        system,
        tools: NO_TOOLS,
        parts: [{ type: "text", text: message }],
        ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
      },
    })
    .then((res: any) => {
      if (res?.error) error = typeof res.error === "string" ? res.error : JSON.stringify(res.error)
    })
    .catch((e: any) => {
      error = e?.message ? String(e.message) : String(e)
    })
    .finally(() => {
      // Wake the read loop so it notices the error instead of waiting on /event.
      if (error) ac.abort()
    })

  let full = ""
  let gotDelta = false
  let buf = ""
  // Map each part id to its kind. We only stream "text" parts — never the
  // model's internal "reasoning", which the user should not see.
  const partKind = new Map<string, string>()
  try {
    outer: for (;;) {
      if (error) break
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const chunks = buf.split("\n\n")
      buf = chunks.pop() ?? ""
      for (const c of chunks) {
        const dataLine = c.split("\n").find((l) => l.startsWith("data:"))
        if (!dataLine) continue
        const ev = JSON.parse(dataLine.slice(5).trim())
        const p = ev.properties ?? {}
        if (p.sessionID && p.sessionID !== sessionID) continue
        if (ev.type === "message.part.updated" && p.part?.id) partKind.set(p.part.id, p.part.type)
        if (
          ev.type === "message.part.delta" &&
          p.field === "text" &&
          typeof p.delta === "string" &&
          partKind.get(p.partID) === "text"
        ) {
          gotDelta = true
          full += p.delta
          onDelta(p.delta)
        }
        if (ev.type === "session.error") {
          error = typeof p.error === "string" ? p.error : JSON.stringify(p.error ?? "Unknown error")
          break outer
        }
        // The turn is finished once the session goes idle (after producing text).
        if (ev.type === "session.idle" && gotDelta) break outer
      }
    }
  } catch (e: any) {
    // An intentional abort (prompt error or timeout) is normal termination, not
    // a crash — the real reason is already in `error` or surfaced below.
    if (e?.name !== "AbortError" && !error) error = e?.message ? String(e.message) : String(e)
  } finally {
    clearTimeout(timeout)
    ac.abort()
  }

  if (error) return { text: "", error }
  if (!full.trim()) return { text: "", error: "OpenCode returned no text. Is a model/provider configured?" }
  return { text: full.trim() }
}

// Plain chat mode (blocking — used as a fallback).
export function ask(message: string, sessionID: string): Promise<AskResult> {
  return prompt(PERSONA, message, sessionID)
}

// Agent mode (blocking — used as a fallback).
export function askAgent(message: string, sessionID: string): Promise<AskResult> {
  return prompt(AGENT_PERSONA, message, sessionID)
}

// ---------- streamed chat/agent with automatic model fallback ----------
//
// Try the user's chosen model first (or the chain's default if none chosen).
// If it errors — hit its context limit, got rate-limited, quota exhausted,
// whatever — move to the next free model in the chain and retry the SAME
// message from scratch. Only once every model in the chain has failed do we
// give up, so the caller can show the "please start a new conversation" copy.
export type AskChainResult = AskResult & { model?: ModelRef; exhausted?: boolean }

export async function askChain(
  kind: "chat" | "agent",
  message: string,
  sessionID: string,
  preferredModelID: string | undefined,
  onDelta: (t: string) => void,
  onRetry?: (model: ModelRef) => void,
): Promise<AskChainResult> {
  const chain = await listModels()
  const ordered = preferredModelID
    ? [...chain.filter((m) => m.modelID === preferredModelID), ...chain.filter((m) => m.modelID !== preferredModelID)]
    : chain
  const system = kind === "agent" ? AGENT_PERSONA : PERSONA

  let lastError: string | undefined
  for (let i = 0; i < ordered.length; i++) {
    const model = ordered[i]
    if (i > 0) onRetry?.(model)
    const res = await stream(system, message, sessionID, onDelta, model)
    if (!res.error) return { ...res, model }
    lastError = res.error
  }
  return { text: "", error: lastError ?? "All free models are unavailable right now.", exhausted: true }
}

export function isRunning(): boolean {
  return Boolean(client)
}
