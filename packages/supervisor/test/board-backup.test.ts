import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoardExportV1 } from "@bobnet/protocol";
import { describe, expect, it } from "vitest";
import { BoardBackup, nextRun } from "../src/board-backup.ts";
import { parseSupervisorConfig } from "../src/config.ts";
import { quiet } from "./fakes.ts";

// The board's nightly backup (ADR 0001 §11).

const doc = (seq: number, exportedAt = "2026-11-14T03:00:00.000Z"): BoardExportV1 => ({
  format: "bobnet-board",
  version: 1,
  exported_at: exportedAt,
  source: "BobNet's board",
  last_event_seq: seq,
  grants: [],
  events: [],
  projects: [],
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "backup-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("commit", "-q", "--allow-empty", "-m", "start");
  return dir;
}

const log = (dir: string) => execFileSync("git", ["log", "--format=%s"], { cwd: dir, encoding: "utf8" }).trim().split("\n");

describe("the board's nightly backup", () => {
  it("is configured per laptop as a repository and a time", () => {
    const config = parseSupervisorConfig("orchestrator: Mario\nboard_backup: { repo: /tmp/board, at: '03:00' }\nprojects: {}\n", (d) => d);
    expect(config.boardBackup).toEqual({ repo: "/tmp/board", at: "03:00" });
    expect(parseSupervisorConfig("orchestrator: Mario\nprojects: {}\n", (d) => d).boardBackup).toBeUndefined();
    expect(() => parseSupervisorConfig("orchestrator: Mario\nboard_backup: { repo: /tmp/board, at: '3am' }\nprojects: {}\n", (d) => d)).toThrow(/HH:MM/);
  });

  it("runs next at its time today, or tomorrow once it has passed", () => {
    const now = new Date(2026, 10, 14, 2, 30);
    expect(nextRun(now, "03:00")).toEqual(new Date(2026, 10, 14, 3, 0));
    expect(nextRun(new Date(2026, 10, 14, 3, 0), "03:00")).toEqual(new Date(2026, 10, 15, 3, 0));
  });

  it("commits board.json when the board changed, and nothing when only the export time did", async () => {
    const dir = repo();
    let next: unknown = doc(5);
    const backup = new BoardBackup({ repo: dir, at: "03:00", fetchExport: async () => next, log: quiet });
    expect(await backup.run()).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.parse(readFileSync(join(dir, "board.json"), "utf8"))).toEqual(doc(5));
    next = doc(5, "2026-11-15T03:00:00.000Z");
    expect(await backup.run()).toBeNull();
    next = doc(9, "2026-11-16T03:00:00.000Z");
    expect(await backup.run()).not.toBeNull();
    expect(log(dir)).toEqual(["board backup: 0 projects through event 9", "board backup: 0 projects through event 5", "start"]);
  });

  it("writes nothing when the broker can't be reached or doesn't answer with an export", async () => {
    const dir = repo();
    const failing = new BoardBackup({ repo: dir, at: "03:00", fetchExport: async () => { throw new Error("unreachable"); }, log: quiet });
    expect(await failing.run()).toBeNull();
    const wrong = new BoardBackup({ repo: dir, at: "03:00", fetchExport: async () => ({ format: "other" }), log: quiet });
    expect(await wrong.run()).toBeNull();
    expect(log(dir)).toEqual(["start"]);
  });
});
