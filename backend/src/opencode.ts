// Wrapper around the OpenCode engine.
//
// OpenCode ships a headless HTTP server plus a typed JS SDK. We spawn that
// server as a hidden child process (the user never sees a terminal) and talk to
// it through the SDK. Nothing here scrapes CLI stdout for answers — we use the
// structured session API so replies, parts and errors are real data.

import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import {
  OPENCODE_CMD,
  OPENCODE_ARGS,
  OPENCODE_HOST,
  OPENCODE_PORT,
  SDK_ENTRY,
  WORK_DIR,
} from "./config.ts"

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

  const port = await freePort()
  proc = spawn(
    OPENCODE_CMD,
    [...OPENCODE_ARGS, "serve", "--hostname", OPENCODE_HOST, "--port", String(port)],
    {
      cwd: WORK_DIR,
      // Hidden: we capture stdio for the readiness probe and discard the rest.
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  )

  baseUrl = await waitForReady(proc)

  const sdk = await import(SDK_ENTRY)
  client = sdk.createOpencodeClient({ baseUrl, directory: WORK_DIR })
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
}

// Persona: this is a Linux helper for absolute beginners, not a coding agent.
// Keep answers short and friendly, and put any command on its own ```bash line
// so the GUI can turn it into a safe action button.
const PERSONA = [
  "You are Pardus Assistant, a friendly helper for people who are brand new to Linux.",
  "Many users have just switched from Windows and know nothing technical.",
  "Rules:",
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
async function prompt(system: string, message: string, sessionID: string): Promise<AskResult> {
  if (!client) await start()

  const res = await client.session.prompt({
    path: { id: sessionID },
    // Disable every tool: the model must only talk. It never touches the
    // system itself — commands run only through our confirmed action buttons.
    body: { system, tools: NO_TOOLS, parts: [{ type: "text", text: message }] },
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
async function stream(system: string, message: string, sessionID: string, onDelta: (t: string) => void): Promise<AskResult> {
  if (!client) await start()

  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), 120_000)
  // Subscribe to events BEFORE prompting so we don't miss the first tokens.
  const events = await fetch(`${baseUrl}/event`, { signal: ac.signal })
  const reader = events.body!.getReader()
  const decoder = new TextDecoder()

  client.session
    .promptAsync({
      path: { id: sessionID },
      body: { system, tools: NO_TOOLS, parts: [{ type: "text", text: message }] },
    })
    .catch(() => {})

  let full = ""
  let error: string | undefined
  let gotDelta = false
  let buf = ""
  // Map each part id to its kind. We only stream "text" parts — never the
  // model's internal "reasoning", which the user should not see.
  const partKind = new Map<string, string>()
  try {
    outer: for (;;) {
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

// Plain chat mode, streamed.
export function askStream(message: string, sessionID: string, onDelta: (t: string) => void): Promise<AskResult> {
  return stream(PERSONA, message, sessionID, onDelta)
}

// Agent mode, streamed: the reply contains an ordered, numbered plan.
export function askAgentStream(message: string, sessionID: string, onDelta: (t: string) => void): Promise<AskResult> {
  return stream(AGENT_PERSONA, message, sessionID, onDelta)
}

// Agent mode (blocking — used as a fallback).
export function askAgent(message: string, sessionID: string): Promise<AskResult> {
  return prompt(AGENT_PERSONA, message, sessionID)
}

export function isRunning(): boolean {
  return Boolean(client)
}
