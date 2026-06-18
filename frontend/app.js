// Pardus Assistant — beginner-first chat UI. No terminal, no jargon by default.
// OpenCode is the brain behind the answers; the user never sees it.

const $ = (id) => document.getElementById(id)
const chat = $("chat")

// The conversation currently shown. null = a fresh, unsaved chat; the backend
// creates and returns an id on the first message.
let currentConversationId = null

// ---------- tiny markdown (bold, inline code, code blocks) ----------
function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))
}
function renderMarkdown(md) {
  let html = escapeHtml(md)
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, (_, c) => `<pre>${c.replace(/\n$/, "")}</pre>`)
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>")
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  return html
}

function clearWelcome() {
  chat.querySelector(".welcome")?.remove()
}

function addMessage(role, html, { raw = false } = {}) {
  clearWelcome()
  const wrap = document.createElement("div")
  wrap.className = `msg ${role}`
  wrap.innerHTML = `
    <div class="avatar">${role === "user" ? "You" : "P"}</div>
    <div class="body">
      <div class="name">${role === "user" ? "You" : "Pardus Assistant"}</div>
      <div class="bubble"></div>
    </div>`
  wrap.querySelector(".bubble").innerHTML = raw ? html : escapeHtml(html)
  chat.appendChild(wrap)
  chat.scrollTop = chat.scrollHeight
  return wrap.querySelector(".body")
}

// ---------- action cards (inline, beginner-friendly) ----------
const RISK_COPY = {
  safe: { title: "Check something for you", verb: "This just looks at your computer — it won't change anything." },
  caution: { title: "Make a change for you", verb: "This will change a setting or install something." },
  danger: { title: "Do something risky", verb: "This is powerful and could affect your system. Please read carefully." },
}

function renderAction(body, cmd) {
  const copy = RISK_COPY[cmd.risk] ?? RISK_COPY.caution
  const card = document.createElement("div")
  card.className = `action-card ${cmd.risk}`
  card.innerHTML = `
    <div class="ac-title">${copy.title}</div>
    <div class="ac-why">${escapeHtml(cmd.reason || copy.verb)}</div>`
  const btn = document.createElement("button")
  btn.className = "ac-run"
  btn.textContent = cmd.risk === "safe" ? "Check now" : "Do it for me"
  btn.onclick = () => confirmAndRun(cmd, card, btn)
  card.appendChild(btn)
  body.appendChild(card)
  chat.scrollTop = chat.scrollHeight
}

// ---------- confirmation (shared by chat actions and agent steps) ----------
const modal = $("modal")
let modalResolver = null
function confirmAndRun(cmd, card, btn) {
  const copy = RISK_COPY[cmd.risk] ?? RISK_COPY.caution
  $("modalTitle").textContent = cmd.risk === "danger" ? "Are you sure?" : "Shall I go ahead?"
  $("modalReason").textContent = `${copy.verb} ${cmd.reason ? "(" + cmd.reason + ")" : ""}`
  $("modalCmd").textContent = cmd.command
  $("modalCmd").classList.add("hidden")
  $("modalToggle").textContent = "See the technical details"
  $("modalConfirm").classList.toggle("is-danger", cmd.risk === "danger")
  modal.classList.remove("hidden")
  modalResolver = { onYes: () => runCommand({ cmd, card, btn }), onNo: () => (btn.disabled = false) }
}
$("modalToggle").onclick = () => {
  const el = $("modalCmd")
  el.classList.toggle("hidden")
  $("modalToggle").textContent = el.classList.contains("hidden") ? "See the technical details" : "Hide technical details"
}
$("modalCancel").onclick = () => {
  const r = modalResolver
  modalResolver = null
  modal.classList.add("hidden")
  r?.onNo?.()
}
$("modalConfirm").onclick = () => {
  const r = modalResolver
  modalResolver = null
  modal.classList.add("hidden")
  r?.onYes?.()
}

// ---------- core executor: run a confirmed command, return { code, output } ----------
async function execute(command) {
  let output = ""
  let code = null
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command, confirmed: true }),
    })
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const events = buf.split("\n\n")
      buf = events.pop() ?? ""
      for (const e of events) {
        const line = e.replace(/^data: /, "").trim()
        if (!line) continue
        const u = JSON.parse(line)
        if (u.kind === "stdout" || u.kind === "stderr") output += u.data
        if (u.kind === "exit") code = u.code
      }
    }
  } catch {
    code = -1
    output = "Could not reach the assistant."
  }
  return { code, output: output.trim() }
}

// ---------- single action card run (chat mode) ----------
async function runCommand({ cmd, card, btn }) {
  btn.disabled = true
  btn.textContent = "Working…"
  const { code, output } = await execute(cmd.command)

  btn.disabled = false
  btn.style.display = "none"
  const ok = code === 0
  const result = document.createElement("div")
  result.className = `result ${ok ? "ok" : "fail"}`
  result.innerHTML = ok ? "✓ All done!" : "✗ That didn't work — I can help you figure out why."
  card.appendChild(result)
  if (output.trim()) {
    const det = document.createElement("details")
    det.className = "result-details"
    det.innerHTML = `<summary>See what happened</summary><pre>${escapeHtml(output.trim())}</pre>`
    card.appendChild(det)
  }
  chat.scrollTop = chat.scrollHeight

  // If it failed, offer to explain the error in plain language.
  if (!ok && output.trim()) explainError(cmd.command, output.trim())
}

function explainError(command, output) {
  sendMessage(
    `I tried to run "${command}" and it failed. Here is the output:\n\n${output}\n\nExplain what went wrong in simple terms and how to fix it.`,
    { hidden: true },
  )
}

// ---------- shared SSE reader: streams delta/done/error events ----------
async function streamPost(url, payload, { onDelta, onDone, onError }) {
  let res
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  } catch {
    onError?.("I couldn't connect right now. Please try again.")
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const events = buf.split("\n\n")
    buf = events.pop() ?? ""
    for (const e of events) {
      const line = e.replace(/^data: /, "").trim()
      if (!line) continue
      const u = JSON.parse(line)
      if (u.type === "delta") onDelta?.(u.text)
      else if (u.type === "error") onError?.(u.error)
      else if (u.type === "done") onDone?.(u)
    }
  }
}

// ---------- agent mode: plan a whole task, run it step by step ----------
async function runAgent(message) {
  addMessage("user", message)
  const body = addMessage("assistant", "Working out the steps…", { raw: true })
  const bubble = body.querySelector(".bubble")
  bubble.classList.add("typing")
  let acc = ""

  await streamPost("/api/agent", { message, conversationId: currentConversationId }, {
    onDelta: (t) => {
      bubble.classList.remove("typing")
      acc += t
      bubble.innerHTML = renderMarkdown(acc)
      chat.scrollTop = chat.scrollHeight
    },
    onError: (e) => {
      bubble.classList.remove("typing")
      bubble.innerHTML = `<span style="color:var(--danger)">⚠️ ${escapeHtml(e)}</span>`
    },
    onDone: (d) => {
      bubble.classList.remove("typing")
      afterDone(d)
      if (d.steps?.length) {
        bubble.textContent = d.intro || "Here's my plan. I'll do one step at a time and check with you each time."
        renderPlan(body, d.steps)
        return
      }
      bubble.innerHTML = renderMarkdown(d.text || acc)
    },
  })
}

// Record the conversation id the backend assigned, and refresh the sidebar list.
function afterDone(d) {
  if (d.conversationId) currentConversationId = d.conversationId
  loadConversations()
}

function renderPlan(body, steps) {
  const plan = document.createElement("div")
  plan.className = "plan"
  plan.innerHTML = `
    <div class="plan-head">
      <span class="pt">My plan</span>
      <span class="pc"><span class="done-count">0</span>/${steps.length} done</span>
    </div>`
  const list = document.createElement("div")
  steps.forEach((s, i) => {
    const el = document.createElement("div")
    el.className = "step"
    el.innerHTML = `
      <div class="num">${i + 1}</div>
      <div class="st-body">
        <div class="st-title">${escapeHtml(s.title)}</div>
        <div class="st-status">Waiting…</div>
      </div>`
    list.appendChild(el)
  })
  plan.appendChild(list)
  const foot = document.createElement("div")
  foot.className = "plan-foot"
  foot.innerHTML = `<button class="plan-start">Start</button>`
  plan.appendChild(foot)
  body.appendChild(plan)
  chat.scrollTop = chat.scrollHeight

  const stepEls = [...list.children]
  foot.querySelector(".plan-start").onclick = () => {
    foot.remove()
    runStep(0, steps, stepEls, plan)
  }
}

// Run steps in order. Each changing step is confirmed first; a failure stops
// the plan and offers a plain-language explanation.
function runStep(i, steps, stepEls, plan) {
  if (i >= steps.length) return
  const s = steps[i]
  const el = stepEls[i]
  el.classList.add("active")
  el.querySelector(".st-status").textContent = "Asking for your OK…"
  chat.scrollTop = chat.scrollHeight

  const proceed = async () => {
    el.querySelector(".st-status").textContent = "Working…"
    const { code, output } = await execute(s.command)
    el.classList.remove("active")
    if (code === 0) {
      el.classList.add("done")
      el.querySelector(".st-status").textContent = "✓ Done"
      const c = plan.querySelector(".done-count")
      c.textContent = String(Number(c.textContent) + 1)
      runStep(i + 1, steps, stepEls, plan)
      return
    }
    el.classList.add("fail")
    el.querySelector(".st-status").textContent = "✗ This step didn't work"
    if (output) explainError(s.command, output)
  }

  const cancel = () => {
    el.classList.remove("active")
    el.classList.add("skip")
    el.querySelector(".st-status").textContent = "Skipped"
  }

  confirmStep(s, proceed, cancel)
}

function confirmStep(s, onYes, onNo) {
  const copy = RISK_COPY[s.risk] ?? RISK_COPY.caution
  $("modalTitle").textContent = s.risk === "danger" ? "Are you sure?" : "Shall I do this step?"
  $("modalReason").textContent = `${s.title}. ${copy.verb}`
  $("modalCmd").textContent = s.command
  $("modalCmd").classList.add("hidden")
  $("modalToggle").textContent = "See the technical details"
  $("modalConfirm").classList.toggle("is-danger", s.risk === "danger")
  modal.classList.remove("hidden")
  modalResolver = { onYes, onNo }
}

// ---------- chat (streamed) ----------
async function sendMessage(message, { hidden = false } = {}) {
  if (!hidden) addMessage("user", message)
  const body = addMessage("assistant", "Thinking…", { raw: true })
  const bubble = body.querySelector(".bubble")
  bubble.classList.add("typing")
  let acc = ""

  await streamPost("/api/chat", { message, conversationId: currentConversationId }, {
    onDelta: (t) => {
      bubble.classList.remove("typing")
      acc += t
      bubble.innerHTML = renderMarkdown(acc)
      chat.scrollTop = chat.scrollHeight
    },
    onError: (e) => {
      bubble.classList.remove("typing")
      bubble.innerHTML = `<span style="color:var(--danger)">⚠️ ${escapeHtml(e)}</span>`
    },
    onDone: (d) => {
      bubble.classList.remove("typing")
      afterDone(d)
      bubble.innerHTML = renderMarkdown(d.text || acc)
      if (d.action) renderAction(body, d.action)
    },
  })
}

// ---------- composer ----------
const form = $("composer")
const input = $("input")
function submit(msg) {
  if ($("agentMode").checked) return runAgent(msg)
  sendMessage(msg)
}
form.onsubmit = (e) => {
  e.preventDefault()
  const msg = input.value.trim()
  if (!msg) return
  input.value = ""
  input.style.height = "auto"
  submit(msg)
}
input.addEventListener("input", () => {
  input.style.height = "auto"
  input.style.height = Math.min(input.scrollHeight, 160) + "px"
})
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    form.requestSubmit()
  }
})

// suggestions + new chat
for (const b of document.querySelectorAll(".suggestion")) {
  b.onclick = () => submit(b.dataset.q)
}
$("newChat").onclick = () => startNewChat()

// ---------- conversation persistence ----------
function startNewChat() {
  currentConversationId = null
  chat.innerHTML = `
    <div class="welcome">
      <div class="welcome-mark">P</div>
      <h1>Hi! How can I help?</h1>
      <p>Ask me anything about your computer in plain words, I'll explain it
        simply and, if you want, do it for you. Nothing happens until you say yes.</p>
    </div>`
  document.querySelectorAll(".conv-item.active").forEach((e) => e.classList.remove("active"))
}

async function loadConversations() {
  const list = await fetch("/api/conversations").then((r) => r.json()).catch(() => [])
  const box = $("convList")
  if (!list.length) {
    box.innerHTML = '<div class="conv-empty">No saved chats yet.</div>'
    return
  }
  box.innerHTML = ""
  for (const c of list) {
    const item = document.createElement("div")
    item.className = "conv-item" + (c.id === currentConversationId ? " active" : "")
    item.innerHTML = `<span class="ci-title">${escapeHtml(c.title)}</span>`
    item.onclick = () => openConversation(c.id)
    const del = document.createElement("button")
    del.className = "ci-del"
    del.textContent = "×"
    del.title = "Delete this conversation"
    del.onclick = (e) => {
      e.stopPropagation()
      deleteConversation(c.id)
    }
    item.appendChild(del)
    box.appendChild(item)
  }
}

async function openConversation(id) {
  const conv = await fetch(`/api/conversations/${id}`).then((r) => r.json()).catch(() => null)
  if (!conv || conv.error) return
  currentConversationId = id
  chat.innerHTML = ""
  for (const m of conv.messages) {
    if (m.role === "user") {
      addMessage("user", m.text)
      continue
    }
    const body = addMessage("assistant", renderMarkdown(m.text), { raw: true })
    if (m.steps?.length) renderPlan(body, m.steps)
    else if (m.action) renderAction(body, m.action)
  }
  chat.scrollTop = 0
  loadConversations()
}

async function deleteConversation(id) {
  await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => {})
  if (id === currentConversationId) startNewChat()
  loadConversations()
}

loadConversations()

// ---------- system info (plain language) ----------
fetch("/api/system")
  .then((r) => r.json())
  .then((s) => {
    $("sysinfo").innerHTML = `Your computer<br /><b>${escapeHtml(s.distro.name)} ${escapeHtml(s.distro.version)}</b><br />${escapeHtml(s.desktop)} desktop`
  })
  .catch(() => ($("sysinfo").textContent = ""))
