import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Laptop settings live in ~/.config/bobnet/config.json:
//   { "url": "wss://…/v1/ws",
//     "keychain": { "clientId": "bobnet-mbp-1-client-id", "clientSecret": "bobnet-mbp-1-client-secret" } }
// The Access service-token credentials come from BOBNET_ACCESS_CLIENT_ID and
// BOBNET_ACCESS_CLIENT_SECRET when set, otherwise from the named macOS
// Keychain items (account "bobnet"). They are never logged.

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

export interface Identity {
  name: string;
  team?: string;
  purpose?: string;
  expertise?: string[];
}

export interface ClientConfig {
  url: string;
  credentials: Credentials;
  /** Registered automatically at startup when BOBNET_NAME is set. */
  identity: Identity | null;
}

interface FileConfig {
  url?: string;
  keychain?: { clientId?: string; clientSecret?: string };
}

const KEYCHAIN_ACCOUNT = "bobnet";

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["BOBNET_CONFIG"] ?? join(homedir(), ".config", "bobnet", "config.json");
}

function readFileConfig(path: string): FileConfig {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FileConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot read ${path}: ${(err as Error).message}`);
  }
}

function keychain(service: string): string {
  try {
    return execFileSync("security", ["find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error(`Keychain item ${KEYCHAIN_ACCOUNT}/${service} not found`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const file = readFileConfig(configPath(env));
  const url = env["BOBNET_URL"] ?? file.url;
  if (!url) throw new Error(`No broker URL: set BOBNET_URL or "url" in ${configPath(env)}`);

  const fromEnv = env["BOBNET_ACCESS_CLIENT_ID"] && env["BOBNET_ACCESS_CLIENT_SECRET"];
  let credentials: Credentials;
  if (fromEnv) {
    credentials = { clientId: env["BOBNET_ACCESS_CLIENT_ID"]!, clientSecret: env["BOBNET_ACCESS_CLIENT_SECRET"]! };
  } else if (file.keychain?.clientId && file.keychain.clientSecret) {
    credentials = { clientId: keychain(file.keychain.clientId), clientSecret: keychain(file.keychain.clientSecret) };
  } else {
    throw new Error(`No Access credentials: set BOBNET_ACCESS_CLIENT_ID/SECRET or "keychain" in ${configPath(env)}`);
  }

  const name = env["BOBNET_NAME"];
  const identity: Identity | null = name
    ? {
        name,
        ...(env["BOBNET_TEAM"] ? { team: env["BOBNET_TEAM"] } : {}),
        ...(env["BOBNET_PURPOSE"] ? { purpose: env["BOBNET_PURPOSE"] } : {}),
        ...(env["BOBNET_EXPERTISE"]
          ? { expertise: env["BOBNET_EXPERTISE"].split(",").map((s) => s.trim()).filter(Boolean) }
          : {}),
      }
    : null;

  return { url, credentials, identity };
}
