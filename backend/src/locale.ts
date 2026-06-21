// Language detection. The assistant speaks the user's language — Turkish or
// English — based on the system locale. Pardus ships Turkish by default, but we
// respect whatever the OS locale actually says rather than assuming.
//
// Only these two are supported for now; anything else falls back to English.
export type Lang = "tr" | "en"

export function detectLang(): Lang {
  // POSIX precedence: LC_ALL overrides LC_MESSAGES overrides LANG.
  const raw = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "").toLowerCase()
  return raw.startsWith("tr") ? "tr" : "en"
}
