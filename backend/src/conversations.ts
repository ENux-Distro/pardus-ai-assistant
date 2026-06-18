// Conversation storage. Each conversation is one JSON file under DATA_DIR.
// We store the plain transcript (who said what) plus the id of the OpenCode
// session that holds the real model context, so reopening a chat continues it.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { DATA_DIR } from "./config.ts"

const DIR = join(DATA_DIR, "conversations")
mkdirSync(DIR, { recursive: true })

export type Message = { role: "user" | "assistant"; text: string; mode: "chat" | "agent" }
export type Conversation = {
  id: string
  title: string
  sessionID: string // OpenCode session backing this conversation
  createdAt: number
  updatedAt: number
  messages: Message[]
}

const file = (id: string) => join(DIR, `${id}.json`)

function read(id: string): Conversation | undefined {
  if (!existsSync(file(id))) return undefined
  try {
    return JSON.parse(readFileSync(file(id), "utf8"))
  } catch {
    return undefined
  }
}

function write(c: Conversation) {
  writeFileSync(file(c.id), JSON.stringify(c, null, 2))
}

export function create(sessionID: string): Conversation {
  const now = Date.now()
  const c: Conversation = {
    id: crypto.randomUUID(),
    title: "New conversation",
    sessionID,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
  write(c)
  return c
}

export function get(id: string): Conversation | undefined {
  return read(id)
}

// Newest first, lightweight (no message bodies) for the sidebar list.
export function list() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => read(f.slice(0, -5)))
    .filter((c): c is Conversation => Boolean(c))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))
}

export function remove(id: string) {
  rmSync(file(id), { force: true })
}

// Point a conversation at a different OpenCode session (used when the original
// session no longer exists, e.g. after engine storage was cleared).
export function setSession(id: string, sessionID: string) {
  const c = read(id)
  if (!c) return
  c.sessionID = sessionID
  write(c)
}

// Append a message and (for the first user message) name the conversation after it.
export function append(id: string, msg: Message): Conversation | undefined {
  const c = read(id)
  if (!c) return undefined
  c.messages.push(msg)
  if (c.title === "New conversation" && msg.role === "user") {
    c.title = msg.text.length > 48 ? msg.text.slice(0, 47).trimEnd() + "…" : msg.text
  }
  c.updatedAt = Date.now()
  write(c)
  return c
}
