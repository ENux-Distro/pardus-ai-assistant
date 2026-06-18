// System awareness. Beginner help is only useful if the assistant knows what it
// is looking at: which distro, desktop, and package managers are present. All
// of this is read-only — nothing here changes the system.

import { spawnSync } from "node:child_process"

function read(path: string): string | undefined {
  try {
    return require("node:fs").readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

function has(cmd: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0
}

function distro() {
  const text = read("/etc/os-release") ?? ""
  const grab = (key: string) => text.match(new RegExp(`^${key}="?([^"\n]+)"?`, "m"))?.[1]
  return {
    name: grab("NAME") ?? "Unknown",
    version: grab("VERSION") ?? grab("VERSION_ID") ?? "",
    id: grab("ID") ?? "",
  }
}

const KNOWN_MANAGERS = ["apt", "dnf", "pacman", "apk", "xbps-install", "emerge", "nix", "flatpak", "snap"]

export function collect() {
  return {
    distro: distro(),
    desktop: process.env.XDG_CURRENT_DESKTOP ?? "Unknown",
    kernel: spawnSync("uname", ["-r"], { encoding: "utf8" }).stdout?.trim() ?? "",
    shell: process.env.SHELL ?? "",
    packageManagers: KNOWN_MANAGERS.filter(has).map((m) => m.replace("-install", "")),
    user: process.env.USER ?? "",
  }
}
