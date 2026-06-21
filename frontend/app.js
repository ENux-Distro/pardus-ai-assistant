// Pardus Assistant — beginner-first chat UI. No terminal, no jargon by default.
// OpenCode is the brain behind the answers; the user never sees it.

const $ = (id) => document.getElementById(id)
const chat = $("chat")

// ---------- i18n (Turkish / English, chosen from the system locale) ----------
// The backend reports the system language via /api/system; we default to English
// until it answers. Translate with t("key"); missing keys fall back to English.
let LANG = "en"
const I18N = {
  en: {
    newChat: "+ New conversation",
    tryAsking: "Try asking",
    suggestions: [
      "My Wi-Fi isn't working",
      "Install Discord for me",
      "Why is my computer slow?",
      "How do I take a screenshot?",
    ],
    conversations: "Conversations",
    noChats: "No saved chats yet.",
    deleteChat: "Delete this conversation",
    checkingComputer: "Checking your computer…",
    yourComputer: "Your computer",
    desktopSuffix: "desktop",
    welcomeTitle: "Hi! How can I help?",
    welcomeBody:
      "Ask me anything about your computer in plain words, I'll explain it simply and, if you want, do it for you. Nothing happens until you say yes.",
    inputPlaceholder: "Ask me anything…",
    agentLabel: "Do it for me (step by step)",
    agentTitle: "Let me plan and carry out a whole task, step by step",
    composerHint: "I'll always ask before changing anything.",
    you: "You",
    assistant: "Pardus Assistant",
    thinking: "Thinking…",
    workingOutSteps: "Working out the steps…",
    working: "Working…",
    // risk cards
    riskSafeTitle: "Check something for you",
    riskSafeVerb: "This just looks at your computer — it won't change anything.",
    riskCautionTitle: "Make a change for you",
    riskCautionVerb: "This will change a setting or install something.",
    riskDangerTitle: "Do something risky",
    riskDangerVerb: "This is powerful and could affect your system. Please read carefully.",
    checkNow: "Check now",
    doIt: "Do it for me",
    // modal
    sure: "Are you sure?",
    goAhead: "Shall I go ahead?",
    doThisStep: "Shall I do this step?",
    seeDetails: "See the technical details",
    hideDetails: "Hide technical details",
    cancelBtn: "No, cancel",
    confirmBtn: "Yes, do it",
    // results
    allDone: "✓ All done!",
    didntWork: "✗ That didn't work — I can help you figure out why.",
    seeWhatHappened: "See what happened",
    // plan
    myPlan: "My plan",
    doneSuffix: "done",
    waiting: "Waiting…",
    askingOk: "Asking for your OK…",
    stepDone: "✓ Done",
    stepFailed: "✗ This step didn't work",
    skipped: "Skipped",
    start: "Start",
    planIntro: "Here's my plan. I'll do one step at a time and check with you each time.",
    // errors
    couldNotReach: "Could not reach the assistant.",
    couldNotConnect: "I couldn't connect right now. Please try again.",
    // hidden prompt sent to the AI when a command fails
    explainPrefix: (cmd, out) =>
      `I tried to run "${cmd}" and it failed. Here is the output:\n\n${out}\n\nExplain what went wrong in simple terms and how to fix it.`,
  },
  tr: {
    newChat: "+ Yeni sohbet",
    tryAsking: "Şunları sorabilirsin",
    suggestions: [
      "Wi-Fi'm çalışmıyor",
      "Discord'u benim için kur",
      "Bilgisayarım neden yavaş?",
      "Nasıl ekran görüntüsü alırım?",
    ],
    conversations: "Sohbetler",
    noChats: "Henüz kayıtlı sohbet yok.",
    deleteChat: "Bu sohbeti sil",
    checkingComputer: "Bilgisayarın kontrol ediliyor…",
    yourComputer: "Bilgisayarın",
    desktopSuffix: "masaüstü",
    welcomeTitle: "Merhaba! Nasıl yardımcı olabilirim?",
    welcomeBody:
      "Bilgisayarınla ilgili her şeyi sade bir dille sor; basitçe açıklarım ve istersen senin için yaparım. Sen onaylamadan hiçbir şey olmaz.",
    inputPlaceholder: "Bana her şeyi sorabilirsin…",
    agentLabel: "Benim için yap (adım adım)",
    agentTitle: "Bütün bir işi adım adım planlayıp yürütmeme izin ver",
    composerHint: "Bir şeyi değiştirmeden önce her zaman sana sorarım.",
    you: "Sen",
    assistant: "Pardus Asistan",
    thinking: "Düşünüyorum…",
    workingOutSteps: "Adımları hazırlıyorum…",
    working: "Çalışıyor…",
    riskSafeTitle: "Senin için bir şeye bakayım",
    riskSafeVerb: "Bu sadece bilgisayarına bakar — hiçbir şeyi değiştirmez.",
    riskCautionTitle: "Senin için bir değişiklik yapayım",
    riskCautionVerb: "Bu bir ayarı değiştirir veya bir şey kurar.",
    riskDangerTitle: "Riskli bir şey yapayım",
    riskDangerVerb: "Bu güçlü bir işlem ve sistemini etkileyebilir. Lütfen dikkatlice oku.",
    checkNow: "Şimdi bak",
    doIt: "Benim için yap",
    sure: "Emin misin?",
    goAhead: "Devam edeyim mi?",
    doThisStep: "Bu adımı yapayım mı?",
    seeDetails: "Teknik ayrıntıları gör",
    hideDetails: "Teknik ayrıntıları gizle",
    cancelBtn: "Hayır, vazgeç",
    confirmBtn: "Evet, yap",
    allDone: "✓ Hepsi tamam!",
    didntWork: "✗ Bu işe yaramadı — nedenini birlikte bulabiliriz.",
    seeWhatHappened: "Ne olduğunu gör",
    myPlan: "Planım",
    doneSuffix: "tamam",
    waiting: "Bekliyor…",
    askingOk: "Onayını bekliyorum…",
    stepDone: "✓ Tamam",
    stepFailed: "✗ Bu adım işe yaramadı",
    skipped: "Atlandı",
    start: "Başla",
    planIntro: "İşte planım. Her adımı tek tek yapıp her seferinde sana danışacağım.",
    couldNotReach: "Asistana ulaşılamadı.",
    couldNotConnect: "Şu anda bağlanamadım. Lütfen tekrar dene.",
    explainPrefix: (cmd, out) =>
      `"${cmd}" komutunu çalıştırmaya çalıştım ve başarısız oldu. İşte çıktısı:\n\n${out}\n\nNeyin yanlış gittiğini basit bir dille açıkla ve nasıl düzeltileceğini söyle.`,
  },
}
function t(key) {
  return I18N[LANG]?.[key] ?? I18N.en[key] ?? key
}

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
    <div class="avatar">${role === "user" ? t("you") : "P"}</div>
    <div class="body">
      <div class="name">${role === "user" ? t("you") : t("assistant")}</div>
      <div class="bubble"></div>
    </div>`
  wrap.querySelector(".bubble").innerHTML = raw ? html : escapeHtml(html)
  chat.appendChild(wrap)
  chat.scrollTop = chat.scrollHeight
  return wrap.querySelector(".body")
}

// ---------- action cards (inline, beginner-friendly) ----------
function riskCopy(risk) {
  const r = ["safe", "caution", "danger"].includes(risk) ? risk : "caution"
  const cap = r[0].toUpperCase() + r.slice(1)
  return { title: t("risk" + cap + "Title"), verb: t("risk" + cap + "Verb") }
}

function renderAction(body, cmd) {
  const copy = riskCopy(cmd.risk)
  const card = document.createElement("div")
  card.className = `action-card ${cmd.risk}`
  card.innerHTML = `
    <div class="ac-title">${copy.title}</div>
    <div class="ac-why">${escapeHtml(cmd.reason || copy.verb)}</div>`
  const btn = document.createElement("button")
  btn.className = "ac-run"
  btn.textContent = cmd.risk === "safe" ? t("checkNow") : t("doIt")
  btn.onclick = () => confirmAndRun(cmd, card, btn)
  card.appendChild(btn)
  body.appendChild(card)
  chat.scrollTop = chat.scrollHeight
}

// ---------- confirmation (shared by chat actions and agent steps) ----------
const modal = $("modal")
let modalResolver = null
function confirmAndRun(cmd, card, btn) {
  const copy = riskCopy(cmd.risk)
  $("modalTitle").textContent = cmd.risk === "danger" ? t("sure") : t("goAhead")
  $("modalReason").textContent = `${copy.verb} ${cmd.reason ? "(" + cmd.reason + ")" : ""}`
  $("modalCmd").textContent = cmd.command
  $("modalCmd").classList.add("hidden")
  $("modalToggle").textContent = t("seeDetails")
  $("modalConfirm").classList.toggle("is-danger", cmd.risk === "danger")
  modal.classList.remove("hidden")
  modalResolver = { onYes: () => runCommand({ cmd, card, btn }), onNo: () => (btn.disabled = false) }
}
$("modalToggle").onclick = () => {
  const el = $("modalCmd")
  el.classList.toggle("hidden")
  $("modalToggle").textContent = el.classList.contains("hidden") ? t("seeDetails") : t("hideDetails")
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
    output = t("couldNotReach")
  }
  return { code, output: output.trim() }
}

// ---------- single action card run (chat mode) ----------
async function runCommand({ cmd, card, btn }) {
  btn.disabled = true
  btn.textContent = t("working")
  const { code, output } = await execute(cmd.command)

  btn.disabled = false
  btn.style.display = "none"
  const ok = code === 0
  const result = document.createElement("div")
  result.className = `result ${ok ? "ok" : "fail"}`
  result.innerHTML = ok ? t("allDone") : t("didntWork")
  card.appendChild(result)
  if (output.trim()) {
    const det = document.createElement("details")
    det.className = "result-details"
    det.innerHTML = `<summary>${t("seeWhatHappened")}</summary><pre>${escapeHtml(output.trim())}</pre>`
    card.appendChild(det)
  }
  chat.scrollTop = chat.scrollHeight

  // If it failed, offer to explain the error in plain language.
  if (!ok && output.trim()) explainError(cmd.command, output.trim())
}

function explainError(command, output) {
  sendMessage(t("explainPrefix")(command, output), { hidden: true })
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
    onError?.(t("couldNotConnect"))
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
  const body = addMessage("assistant", t("workingOutSteps"), { raw: true })
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
        bubble.textContent = d.intro || t("planIntro")
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
      <span class="pt">${t("myPlan")}</span>
      <span class="pc"><span class="done-count">0</span>/${steps.length} ${t("doneSuffix")}</span>
    </div>`
  const list = document.createElement("div")
  steps.forEach((s, i) => {
    const el = document.createElement("div")
    el.className = "step"
    el.innerHTML = `
      <div class="num">${i + 1}</div>
      <div class="st-body">
        <div class="st-title">${escapeHtml(s.title)}</div>
        <div class="st-status">${t("waiting")}</div>
      </div>`
    list.appendChild(el)
  })
  plan.appendChild(list)
  const foot = document.createElement("div")
  foot.className = "plan-foot"
  foot.innerHTML = `<button class="plan-start">${t("start")}</button>`
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
  el.querySelector(".st-status").textContent = t("askingOk")
  chat.scrollTop = chat.scrollHeight

  const proceed = async () => {
    el.querySelector(".st-status").textContent = t("working")
    const { code, output } = await execute(s.command)
    el.classList.remove("active")
    if (code === 0) {
      el.classList.add("done")
      el.querySelector(".st-status").textContent = t("stepDone")
      const c = plan.querySelector(".done-count")
      c.textContent = String(Number(c.textContent) + 1)
      runStep(i + 1, steps, stepEls, plan)
      return
    }
    el.classList.add("fail")
    el.querySelector(".st-status").textContent = t("stepFailed")
    if (output) explainError(s.command, output)
  }

  const cancel = () => {
    el.classList.remove("active")
    el.classList.add("skip")
    el.querySelector(".st-status").textContent = t("skipped")
  }

  confirmStep(s, proceed, cancel)
}

function confirmStep(s, onYes, onNo) {
  const copy = riskCopy(s.risk)
  $("modalTitle").textContent = s.risk === "danger" ? t("sure") : t("doThisStep")
  $("modalReason").textContent = `${s.title}. ${copy.verb}`
  $("modalCmd").textContent = s.command
  $("modalCmd").classList.add("hidden")
  $("modalToggle").textContent = t("seeDetails")
  $("modalConfirm").classList.toggle("is-danger", s.risk === "danger")
  modal.classList.remove("hidden")
  modalResolver = { onYes, onNo }
}

// ---------- chat (streamed) ----------
async function sendMessage(message, { hidden = false } = {}) {
  if (!hidden) addMessage("user", message)
  const body = addMessage("assistant", t("thinking"), { raw: true })
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
function welcomeHTML() {
  return `
    <div class="welcome">
      <div class="welcome-mark">P</div>
      <h1>${escapeHtml(t("welcomeTitle"))}</h1>
      <p>${escapeHtml(t("welcomeBody"))}</p>
    </div>`
}

function startNewChat() {
  currentConversationId = null
  chat.innerHTML = welcomeHTML()
  document.querySelectorAll(".conv-item.active").forEach((e) => e.classList.remove("active"))
}

async function loadConversations() {
  const list = await fetch("/api/conversations").then((r) => r.json()).catch(() => [])
  const box = $("convList")
  if (!list.length) {
    box.innerHTML = `<div class="conv-empty">${t("noChats")}</div>`
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
    del.title = t("deleteChat")
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

// ---------- apply the chosen language to the static page ----------
function applyStaticI18n() {
  document.documentElement.lang = LANG
  $("newChat").textContent = t("newChat")
  document.querySelectorAll(".side-title")[0].textContent = t("tryAsking")
  document.querySelectorAll(".side-title")[1].textContent = t("conversations")
  const sugg = t("suggestions")
  document.querySelectorAll(".suggestion").forEach((b, i) => {
    if (!sugg[i]) return
    b.textContent = sugg[i]
    b.dataset.q = sugg[i]
  })
  input.placeholder = t("inputPlaceholder")
  document.querySelector(".agent-toggle span:last-child").textContent = t("agentLabel")
  document.querySelector(".agent-toggle").title = t("agentTitle")
  document.querySelector(".composer-hint").textContent = t("composerHint")
  $("modalCancel").textContent = t("cancelBtn")
  $("modalConfirm").textContent = t("confirmBtn")
  $("modalToggle").textContent = t("seeDetails")
  // Replace the initial welcome panel if it's still showing.
  if (chat.querySelector(".welcome")) chat.innerHTML = welcomeHTML()
}

// ---------- startup: pick language from the system, then render ----------
async function init() {
  let sys = null
  try {
    sys = await fetch("/api/system").then((r) => r.json())
  } catch {}
  LANG = sys?.lang === "tr" ? "tr" : "en"
  applyStaticI18n()
  if (sys) {
    $("sysinfo").innerHTML = `${escapeHtml(t("yourComputer"))}<br /><b>${escapeHtml(sys.distro.name)} ${escapeHtml(sys.distro.version)}</b><br />${escapeHtml(sys.desktop)} ${escapeHtml(t("desktopSuffix"))}`
  } else {
    $("sysinfo").textContent = ""
  }
  loadConversations()
}

init()
