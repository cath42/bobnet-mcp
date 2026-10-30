import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Runs the supervisor as a per-user LaunchAgent: starts at login, restarts if
// it exits. Load with `launchctl bootstrap gui/$(id -u) <plist>`.

export const LABEL = "com.bobnet.supervisor";

/**
 * A PATH that outlives the installing shell: node's own folder first, then the
 * shell's PATH minus per-shell temporaries (fnm's multishell folders).
 */
export function servicePath(nodePath: string, shellPath = process.env["PATH"] ?? ""): string {
  const parts = [dirname(nodePath), ...shellPath.split(":"), "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return [...new Set(parts.filter((p) => p && !p.includes("fnm_multishells")))].join(":");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function launchAgentPlist(binPath: string, nodePath = process.execPath, home = homedir()): string {
  const logDir = join(home, ".local", "state", "bobnet");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${esc(nodePath)}</string><string>${esc(binPath)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${esc(join(logDir, "supervisor.out.log"))}</string>
  <key>StandardErrorPath</key><string>${esc(join(logDir, "supervisor.log"))}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${esc(servicePath(nodePath))}</string></dict>
</dict>
</plist>
`;
}

export function installLaunchAgent(binPath: string): string {
  const dir = join(homedir(), "Library", "LaunchAgents");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(homedir(), ".local", "state", "bobnet"), { recursive: true });
  const file = join(dir, `${LABEL}.plist`);
  writeFileSync(file, launchAgentPlist(binPath));
  return file;
}
