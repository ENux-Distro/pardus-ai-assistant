// Safety layer. The single most important part of this app: a beginner plus a
// shell plus an LLM is how machines get bricked. Two rules:
//
//   1. The backend NEVER runs a command on its own. A command only executes
//      when the GUI calls /api/run with an explicit user confirmation.
//   2. Every command is classified first so the GUI can warn appropriately.

export type Risk = "safe" | "caution" | "danger"

export type Verdict = {
  risk: Risk
  reason: string
}

// Read-only inspection commands we are comfortable labelling "safe". This is an
// allow-list, not a block-list: anything not recognised defaults to "caution".
const SAFE = [
  /^(ls|pwd|cat|less|head|tail|echo|whoami|id|date|uptime|uname)\b/,
  /^(df|du|free|lsblk|lscpu|lsusb|lspci|hostnamectl)\b/,
  /^(ip\s+(addr|a|link|route)|nmcli\s+(general|device|connection)\s+(status|show)?)\b/,
  /^(systemctl\s+(status|is-active|list-units|--version))\b/,
  /^(apt\s+(list|search|show)|dpkg\s+-l|flatpak\s+(list|search))\b/,
  /^(grep|find|which|file|stat|wc)\b/,
]

// Patterns that can damage the system or lose data. These stay runnable, but the
// GUI must show a strong, explicit confirmation before they go through.
const DANGER: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b|\brm\s+-rf\b/, "Recursive force delete — can wipe directories irreversibly"],
  [/\b(mkfs|fdisk|parted|sgdisk|wipefs)\b/, "Disk/partition operation — can destroy a drive"],
  [/\bdd\b.*\bof=/, "Raw disk write — can overwrite a device"],
  [/>\s*\/dev\/(sd|nvme|mmcblk)/, "Writing directly to a block device"],
  [/\bchmod\s+-R\b|\bchown\s+-R\b/, "Recursive permission change — easy to break a system"],
  [/\b:\(\)\s*\{.*\};:/, "Fork bomb"],
  [/\b(shutdown|reboot|halt|poweroff)\b/, "Will power off or restart the machine"],
  [/\bmv\s+.*\s+\/(bin|etc|boot|usr|lib)\b/, "Moving files into a system directory"],
]

// Things that change the system but are routine — installs, services, etc.
const CAUTION: Array<[RegExp, string]> = [
  [/\b(apt(-get)?|dnf|pacman|apk|xbps-install|emerge|zypper)\b.*\b(install|remove|upgrade|update)\b/, "Installs or removes system packages (needs sudo)"],
  [/\bflatpak\s+(install|uninstall|update)\b/, "Changes installed Flatpak apps"],
  [/\bsnap\s+(install|remove|refresh)\b/, "Changes installed Snap apps"],
  [/\bsystemctl\s+(start|stop|restart|enable|disable)\b/, "Changes a system service"],
  [/\bsudo\b/, "Runs with administrator privileges"],
  [/[>|]\s*\S/, "Writes to a file or pipes output"],
]

export function classify(command: string): Verdict {
  const cmd = command.trim()
  for (const [re, reason] of DANGER) if (re.test(cmd)) return { risk: "danger", reason }
  for (const [re, reason] of CAUTION) if (re.test(cmd)) return { risk: "caution", reason }
  if (SAFE.some((re) => re.test(cmd))) return { risk: "safe", reason: "Read-only — does not change anything" }
  return { risk: "caution", reason: "Unrecognised command — review before running" }
}
