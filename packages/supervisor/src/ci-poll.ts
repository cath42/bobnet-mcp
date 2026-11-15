import type { BoardOpInput, CiStatus } from "@bobnet/protocol";
import type { Logger } from "@bobnet/client/log";
import { exec as run, type Exec } from "./board.ts";
import type { ProjectConfig } from "./config.ts";

// The gh adapter (ADR 0001 §10): a project on the board service has its GitHub Actions runs read
// with `gh run list` in its checkout and reported as the board's CI runs, so GitHub needs no secret.

/** How often each project's runs are read. */
export const CI_POLL_MS = 120_000;
const RUNS = 20;

/** `owner/name` from a git remote's URL, as a push and a CI run name their repo. */
export function repoName(url: string): string | null {
  const m = /[/:]([^/:]+\/[^/]+?)(\.git)?\/?$/.exec(url.trim());
  return m ? m[1]! : null;
}

/** One run as `gh run list --json` gives it. */
export interface GhRun {
  databaseId: number;
  attempt: number;
  workflowName: string;
  name: string;
  status: string;
  conclusion: string;
  startedAt: string;
  updatedAt: string;
  headSha: string;
  headBranch: string;
  url: string;
}

/**
 * A GitHub status and conclusion as the board's. `stale`, `skipped`, `neutral` and `action_required`
 * are taken as cancelled, a choice: the dashboard shows them as not passed.
 */
export function ciStatus(status: string, conclusion: string): CiStatus {
  if (status === "in_progress") return "running";
  if (status !== "completed") return "queued";
  if (conclusion === "success") return "passed";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure") return "failed";
  return "cancelled";
}

/** A run as the board's `ci_run`: a re-run is its own run, by its attempt. */
export function ghCiRun(project: string, repo: string, r: GhRun): BoardOpInput & { op: "ci_run" } {
  const status = ciStatus(r.status, r.conclusion);
  const ended = status !== "queued" && status !== "running";
  return {
    op: "ci_run",
    project,
    external_id: `${r.databaseId}-${r.attempt}`,
    name: (r.workflowName && r.name && r.name !== r.workflowName ? `${r.workflowName} / ${r.name}` : r.workflowName || r.name || "GitHub Actions").slice(0, 200),
    url: r.url || null,
    repo,
    branch: r.headBranch || null,
    sha: /^[0-9a-f]{40}$/.test(r.headSha) ? r.headSha : null,
    status,
    started_at: r.startedAt && !r.startedAt.startsWith("0001") ? r.startedAt : null,
    ended_at: ended ? r.updatedAt : null,
  };
}

/** Reads the service projects' runs, and says which changed since it last said: each run's status once. */
export class GhCiPoll {
  private readonly sent = new Map<string, CiStatus>();
  private readonly log: Logger;
  private readonly exec: Exec;

  constructor(log: Logger, execImpl: Exec = run) {
    this.log = log;
    this.exec = execImpl;
  }

  async poll(projects: ProjectConfig[]): Promise<Array<BoardOpInput & { op: "ci_run" }>> {
    const out: Array<BoardOpInput & { op: "ci_run" }> = [];
    for (const p of projects) {
      let repo: string | null;
      let runs: GhRun[];
      try {
        repo = repoName(await this.exec("git", ["remote", "get-url", "origin"], p.path));
        if (!repo) continue;
        const json = await this.exec(
          "gh",
          ["run", "list", "-L", String(RUNS), "--json", "databaseId,attempt,workflowName,name,status,conclusion,startedAt,updatedAt,headSha,headBranch,url"],
          p.path,
        );
        runs = JSON.parse(json) as GhRun[];
      } catch (err) {
        // no gh, not signed in, or no GitHub remote: this project reports no runs from here
        this.log.debug("no GitHub runs read", { project: p.key, err: (err as Error).message });
        continue;
      }
      for (const r of runs) {
        const op = ghCiRun(p.key, repo, r);
        const key = `${p.key} ${op.external_id}`;
        if (this.sent.get(key) === op.status) continue;
        this.sent.set(key, op.status);
        out.push(op);
      }
    }
    return out;
  }
}
