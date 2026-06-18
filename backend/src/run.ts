// Command runner. Only ever reached through /api/run AFTER the GUI has shown a
// confirmation and the user clicked through. Output is captured for the
// read-only terminal panel and every run is appended to an audit log.

import { spawn } from "node:child_process"
import { appendFileSync } from "node:fs"
import { WORK_DIR } from "./config.ts"

const LOG = new URL("../actions.log", import.meta.url).pathname

export type RunUpdate =
  | { kind: "stdout" | "stderr"; data: string }
  | { kind: "exit"; code: number | null }

function audit(command: string) {
  const line = `${new Date().toISOString()}\t${command}\n`
  try {
    appendFileSync(LOG, line)
  } catch {
    // Logging must never block a run; ignore failures.
  }
}

// Run a command, calling `onUpdate` for each chunk. Returns the exit code.
// The caller (server) is responsible for having confirmed the command first.
export function run(command: string, onUpdate: (u: RunUpdate) => void): Promise<number | null> {
  audit(command)
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd: WORK_DIR, env: process.env })
    child.stdout.on("data", (d) => onUpdate({ kind: "stdout", data: d.toString() }))
    child.stderr.on("data", (d) => onUpdate({ kind: "stderr", data: d.toString() }))
    child.on("error", (e) => onUpdate({ kind: "stderr", data: String(e.message ?? e) }))
    child.on("close", (code) => {
      onUpdate({ kind: "exit", code })
      resolve(code)
    })
  })
}
