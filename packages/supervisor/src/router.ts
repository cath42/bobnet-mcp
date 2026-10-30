import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { WORKER_SERVER } from "./worker-tools.ts";
import type { RoleConfig } from "./config.ts";
import type { Policy, Tier } from "./policy.ts";
import type { RequestRow, Store, WorkerState } from "./store.ts";

// Every permission request and AskUserQuestion from a worker comes here and
// nothing ever blocks silently: policy decides first; anything it escalates
// is stored, announced to the orchestrator, and holds the worker until it is
// answered or times out. A timeout denies with an instruction to record the
// question in the handoff file and carry on.

export type Answer =
  | { decision: "allow"; message?: string }
  | { decision: "deny"; message?: string }
  | { decision: "answer"; answers: Record<string, string>; message?: string };

export type DecidedBy = "orchestrator" | "human" | "policy" | "timeout";

export interface RouterDeps {
  store: Store;
  policy: Policy;
  timeoutMs: number;
  /** Tells the orchestrator a request is waiting (over BobNet). */
  announce: (req: RequestRow, workerName: string) => void;
  setWorkerState: (workerId: string, state: WorkerState) => void;
  /** Resolves once the call holds a run slot; the slot is freed when the call returns. */
  takeSlot: (workerId: string, toolUseId: string, label: string, signal: AbortSignal) => Promise<void>;
}

interface Waiter {
  resolve: (r: PermissionResult) => void;
  timer: NodeJS.Timeout;
  input: Record<string, unknown>;
  workerId: string;
}

export class AnswerError extends Error {}

export class Router {
  private readonly deps: RouterDeps;
  private readonly waiting = new Map<string, Waiter>();

  constructor(deps: RouterDeps) {
    this.deps = deps;
  }

  /** The canUseTool callback for one worker. */
  forWorker(workerId: string, role: RoleConfig): CanUseTool {
    return async (toolName, input, { signal, mcpServer, toolUseID }) => {
      const { store, policy } = this.deps;

      // The supervisor's own BobNet tools, served in-process: always allowed.
      if (mcpServer?.source === "sdk" && mcpServer.name === WORKER_SERVER) return { behavior: "allow", updatedInput: input };

      if (toolName === "AskUserQuestion") {
        return this.escalate(workerId, role, toolName, input, "question", "orchestrator", "ask-user-question", "The worker asked a question", signal);
      }

      const verdict = policy.evaluate(toolName, input, {
        project: role.project,
        role: role.key,
        writeRoots: role.writeRoots,
        cwd: role.dir,
      });
      const slotted = (result: PermissionResult): Promise<PermissionResult> | PermissionResult =>
        verdict.slot && result.behavior === "allow" ? this.inSlot(workerId, toolUseID, input, signal) : result;
      if (verdict.decision !== "escalate") {
        store.audit("policy", verdict.decision, workerId, { tool: toolName, rule: verdict.rule });
        return verdict.decision === "allow"
          ? slotted({ behavior: "allow", updatedInput: input })
          : { behavior: "deny", message: `Denied by policy (${verdict.rule}): ${verdict.reason}` };
      }
      return slotted(await this.escalate(workerId, role, toolName, input, "approval", verdict.tier, verdict.rule, verdict.reason, signal));
    };
  }

  /** Holds an allowed heavy run until a run slot is free. */
  private async inSlot(workerId: string, toolUseId: string, input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
    if (input["run_in_background"] === true) {
      return { behavior: "deny", message: "This command needs a run slot, and slot runs go in the foreground: run it again without run_in_background." };
    }
    const label = typeof input["command"] === "string" ? input["command"].slice(0, 120) : "run";
    try {
      await this.deps.takeSlot(workerId, toolUseId, label, signal);
    } catch {
      return { behavior: "deny", message: "Worker stopped while waiting for a run slot", interrupt: true };
    }
    return { behavior: "allow", updatedInput: input };
  }

  /**
   * Settles an open request. `decidedBy` "human" is required for human-tier
   * requests. Returns the request so the caller can resume an orphaned worker.
   */
  answer(requestId: string, answer: Answer, decidedBy: Exclude<DecidedBy, "policy" | "timeout">): RequestRow {
    const { store } = this.deps;
    const req = store.request(requestId);
    if (!req) throw new AnswerError(`No request ${requestId}`);
    if (req.state !== "open" && req.state !== "orphaned") throw new AnswerError(`Request ${requestId} is already ${req.state}`);
    if (req.tier === "human" && decidedBy !== "human") {
      throw new AnswerError(`Request ${requestId} needs the user's own decision; relay it only once they have given it`);
    }
    if (req.kind === "question" && answer.decision === "allow") {
      throw new AnswerError(`Request ${requestId} is a question: answer it, or deny to let the worker proceed without one`);
    }
    if (req.kind === "approval" && answer.decision === "answer") {
      throw new AnswerError(`Request ${requestId} is an approval: allow or deny it`);
    }

    store.settleRequest(requestId, {
      state: "answered",
      decision: answer.decision,
      message: answer.message ?? null,
      answers: answer.decision === "answer" ? JSON.stringify(answer.answers) : null,
      decided_by: decidedBy,
    });
    store.audit(decidedBy, `answer:${answer.decision}`, req.worker_id, { request: requestId, tool: req.tool });

    const waiter = this.waiting.get(requestId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiting.delete(requestId);
      this.deps.setWorkerState(waiter.workerId, "running");
      waiter.resolve(toResult(answer, waiter.input));
    }
    return store.request(requestId)!;
  }

  /** True while a worker has a live request waiting on an answer. */
  isWaiting(workerId: string): boolean {
    for (const w of this.waiting.values()) if (w.workerId === workerId) return true;
    return false;
  }

  private escalate(
    workerId: string,
    role: RoleConfig,
    tool: string,
    input: Record<string, unknown>,
    kind: "approval" | "question",
    tier: Tier,
    rule: string,
    reason: string,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    const { store } = this.deps;
    const req = store.createRequest({ worker_id: workerId, kind, tool, input: JSON.stringify(input), tier, rule, reason });
    store.audit("router", `escalate:${kind}`, workerId, { request: req.id, tool, tier, rule });
    this.deps.setWorkerState(workerId, kind === "question" ? "waiting-answer" : "waiting-approval");
    this.deps.announce(req, role.name);

    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(req.id);
        store.settleRequest(req.id, {
          state: "expired",
          decision: "deny",
          message: null,
          answers: null,
          decided_by: "timeout",
        });
        store.audit("timeout", "expire", workerId, { request: req.id });
        this.deps.setWorkerState(workerId, "running");
        resolve({
          behavior: "deny",
          message:
            `No answer within ${Math.round(this.deps.timeoutMs / 60_000)} minutes (request ${req.id}). ` +
            "Write this under Open questions in your handoff file and continue with other work, or stop cleanly.",
        });
      }, this.deps.timeoutMs);
      timer.unref();
      this.waiting.set(req.id, { resolve, timer, input, workerId });

      signal.addEventListener(
        "abort",
        () => {
          const w = this.waiting.get(req.id);
          if (!w) return;
          clearTimeout(w.timer);
          this.waiting.delete(req.id);
          resolve({ behavior: "deny", message: "Worker stopped", interrupt: true });
        },
        { once: true },
      );
    });
  }
}

function toResult(answer: Answer, input: Record<string, unknown>): PermissionResult {
  switch (answer.decision) {
    case "allow":
      return { behavior: "allow", updatedInput: input };
    case "answer":
      return { behavior: "allow", updatedInput: { ...input, answers: answer.answers } };
    case "deny":
      return { behavior: "deny", message: answer.message ? `Denied: ${answer.message}` : "Denied by the orchestrator" };
  }
}
