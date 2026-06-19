// HTTP backend for the Pardus AI Assistant.
//
// Serves the static frontend and exposes a small JSON API:
//   GET  /api/system        -> distro / desktop / package managers
//   POST /api/chat          -> { message } -> { text, commands[] }
//   POST /api/run (SSE)     -> { command, confirmed } -> streamed output
//
// The OpenCode engine is started lazily on the first request and torn down on
// shutdown, so the user never sees it.

import { HTTP_HOST, HTTP_PORT } from "./config.ts"
import { askStream, askAgentStream, createSession, ensureSession, isRunning, start, stop } from "./opencode.ts"
import * as Conversations from "./conversations.ts"
import { collect } from "./system.ts"
import { classify } from "./safety.ts"
import { run } from "./run.ts"

const FRONTEND = new URL("../../frontend/", import.meta.url).pathname
// Repo root of THIS running build. Exposed via /api/health so the launcher can
// tell whether the server on the port is this clone or a stale/foreign one.
const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "")

const RISK_ORDER = { safe: 0, caution: 1, danger: 2 } as const

// In chat mode the whole answer becomes ONE action: every command from the reply
// is chained with `&&` (so it stops if a step fails) and shown as a single
// button. Risk is the highest risk among the commands.
function combineCommand(markdown: string) {
  const cmds: string[] = []
  const fence = /```(?:bash|sh|shell|console)?\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = fence.exec(markdown))) {
    for (const raw of m[1].split("\n")) {
      const line = raw.replace(/^\s*[$#]\s?/, "").trim()
      if (line && !line.startsWith("#")) cmds.push(line)
    }
  }
  if (!cmds.length) return null
  const command = cmds.join(" && ")
  const risk = cmds
    .map((c) => classify(c).risk)
    .reduce((a, b) => (RISK_ORDER[b as keyof typeof RISK_ORDER] > RISK_ORDER[a as keyof typeof RISK_ORDER] ? b : a), "safe")
  return { command, risk, reason: classify(command).reason, steps: cmds.length }
}

// Strip markdown noise (bold, headings, numbering, trailing colon) from a title.
function cleanTitle(line: string) {
  return line
    .replace(/[*_`#]/g, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/:\s*$/, "")
    .trim()
}

// Turn an agent reply into ordered steps. Each ```bash block is a step; its
// title is the last non-empty text line before it.
function parseSteps(markdown: string) {
  const steps: Array<{ title: string; command: string; risk: string; reason: string }> = []
  const re = /```(?:bash|sh|shell|console)?\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  let last = 0
  let n = 0
  while ((m = re.exec(markdown))) {
    const command = m[1]
      .split("\n")
      .map((l) => l.replace(/^\s*[$#]\s?/, "").trim())
      .find((l) => l && !l.startsWith("#"))
    const preceding = markdown.slice(last, m.index).split("\n").filter((l) => l.trim())
    last = re.lastIndex
    if (!command) continue
    n++
    const title = cleanTitle(preceding[preceding.length - 1] ?? "") || `Step ${n}`
    const v = classify(command)
    steps.push({ title, command, risk: v.risk, reason: v.reason })
  }
  const intro = markdown.split(/```/)[0].split("\n").map((l) => l.trim()).find((l) => l) ?? ""
  return { intro: cleanTitle(intro) ? intro : "", steps }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })

const server = Bun.serve({
  hostname: HTTP_HOST,
  port: HTTP_PORT,
  idleTimeout: 240, // model replies can take a while
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // Identity probe for the launcher: which build is on this port, its pid, and
    // whether the engine has come up. Lets the launcher refuse to silently reuse
    // a stale or foreign server (the cause of "I edited the code but it's still
    // running the old one").
    if (path === "/api/health") return json({ ok: true, appRoot: APP_ROOT, pid: process.pid, engine: isRunning() })

    if (path === "/api/system") return json(collect())

    // ----- conversation storage -----
    if (path === "/api/conversations" && req.method === "GET") return json(Conversations.list())

    if (path === "/api/conversations" && req.method === "POST") {
      const conv = Conversations.create(await createSession())
      return json({ id: conv.id, title: conv.title })
    }

    const convMatch = path.match(/^\/api\/conversations\/([^/]+)$/)
    if (convMatch) {
      const id = convMatch[1]
      if (req.method === "DELETE") {
        Conversations.remove(id)
        return json({ ok: true })
      }
      const conv = Conversations.get(id)
      if (!conv) return json({ error: "not found" }, 404)
      // Rebuild each assistant turn's action/steps so the saved chat reopens
      // with its buttons intact.
      const messages = conv.messages.map((m) =>
        m.role === "assistant"
          ? m.mode === "agent"
            ? { ...m, ...parseSteps(m.text) }
            : { ...m, action: combineCommand(m.text) }
          : m,
      )
      return json({ id: conv.id, title: conv.title, messages })
    }

    // Both chat and agent stream the reply as it is generated, then send a final
    // "done" event with the structured result (a single combined action, or the
    // ordered agent plan).
    if ((path === "/api/chat" || path === "/api/agent") && req.method === "POST") {
      const body = await req.json().catch(() => ({}))
      const message = (body as any).message
      if (!message) return json({ error: "message is required" }, 400)
      const agent = path === "/api/agent"
      const mode = agent ? "agent" : "chat"

      // Resolve (or start) the conversation this message belongs to.
      let conv = (body as any).conversationId ? Conversations.get(String((body as any).conversationId)) : undefined
      if (!conv) conv = Conversations.create(await createSession())
      // Recover gracefully if this chat's session vanished (e.g. after a reboot
      // that cleared engine storage): start a fresh one and remember it.
      const sessionID = await ensureSession(conv.sessionID)
      if (sessionID !== conv.sessionID) Conversations.setSession(conv.id, sessionID)
      Conversations.append(conv.id, { role: "user", text: String(message), mode })
      const convID = conv.id

      const sse = new ReadableStream({
        async start(controller) {
          const send = (obj: unknown) => controller.enqueue(`data: ${JSON.stringify(obj)}\n\n`)
          const onDelta = (t: string) => send({ type: "delta", text: t })
          const res = agent
            ? await askAgentStream(String(message), sessionID, onDelta)
            : await askStream(String(message), sessionID, onDelta)
          if (res.error) {
            send({ type: "error", error: res.error, conversationId: convID })
          } else {
            const saved = Conversations.append(convID, { role: "assistant", text: res.text, mode })
            const extra = agent ? parseSteps(res.text) : { action: combineCommand(res.text) }
            send({ type: "done", text: res.text, conversationId: convID, title: saved?.title, ...extra })
          }
          controller.close()
        },
      })
      return new Response(sse, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      })
    }

    if (path === "/api/run" && req.method === "POST") {
      const body = await req.json().catch(() => ({}))
      const command = (body as any).command
      const confirmed = (body as any).confirmed === true
      if (!command) return json({ error: "command is required" }, 400)
      // Hard gate: the backend refuses to run anything that was not confirmed.
      if (!confirmed) return json({ error: "command not confirmed" }, 403)

      const stream = new ReadableStream({
        async start(controller) {
          const send = (obj: unknown) => controller.enqueue(`data: ${JSON.stringify(obj)}\n\n`)
          await run(String(command), (u) => send(u))
          controller.close()
        },
      })
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      })
    }

    // Static frontend.
    const rel = path === "/" ? "index.html" : path.slice(1)
    const file = Bun.file(FRONTEND + rel)
    if (await file.exists()) return new Response(file)
    return new Response("Not found", { status: 404 })
  },
})

// Boot the engine in the background so the first chat is fast; don't crash if a
// provider isn't configured yet — that surfaces as a friendly error per-request.
start().catch((e) => console.error("[opencode] failed to start:", e.message))

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stop()
    server.stop()
    process.exit(0)
  })
}

console.log(`Pardus AI Assistant backend on http://${HTTP_HOST}:${HTTP_PORT}`)
