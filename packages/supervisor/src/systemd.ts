import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { servicePath } from "./launchd.ts";

// Runs the supervisor as a systemd user service on Linux, as launchd.ts does on a
// Mac: starts with the user's session (or at boot, with lingering on), restarts
// if it fails. Linux has no Keychain, so the Access credentials come from an
// environment file beside the config, which workers can't read (policy.ts's
// guard on the supervisor's folder).

export const UNIT = "bobnet-supervisor.service";

/** A value for a unit file line: quoted, with its quotes, backslashes and % escaped. */
const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

export function systemdUnit(binPath: string, nodePath = process.execPath, home = homedir()): string {
  const logDir = join(home, ".local", "state", "bobnet");
  return `[Unit]
Description=BobNet supervisor: runs role agents headless on this laptop
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${q(nodePath)} ${q(binPath)}
Restart=on-failure
RestartSec=10
Environment=${q(`PATH=${servicePath(nodePath)}`)}
# BOBNET_ACCESS_CLIENT_ID and BOBNET_ACCESS_CLIENT_SECRET (mode 0600): no Keychain on Linux.
EnvironmentFile=-%h/.config/bobnet/supervisor.env
StandardOutput=append:${join(logDir, "supervisor.out.log")}
StandardError=append:${join(logDir, "supervisor.log")}

[Install]
WantedBy=default.target
`;
}

export function installSystemdUnit(binPath: string): string {
  const dir = join(homedir(), ".config", "systemd", "user");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(homedir(), ".local", "state", "bobnet"), { recursive: true });
  const file = join(dir, UNIT);
  writeFileSync(file, systemdUnit(binPath));
  return file;
}
