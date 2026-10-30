import { existsSync, readFileSync } from "node:fs";

// Reads a worker's JSONL event log (logs/{project}/{worker}.jsonl) into short
// lines and a digest, so the orchestrator reads summaries, not raw logs.

interface LoggedEvent {
  ts: string;
  event: {
    type: string;
    subtype?: string;
    message?: { content?: unknown };
    result?: string;
    data?: string;
  };
}

type Block = { type: string; text?: string; name?: string; input?: Record<string, unknown>; content?: unknown; is_error?: boolean };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\s+/g, " ").trim();

function read(path: string): LoggedEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as LoggedEvent];
      } catch {
        return [];
      }
    });
}

function blocks(e: LoggedEvent): Block[] {
  const c = e.event.message?.content;
  return Array.isArray(c) ? (c as Block[]) : typeof c === "string" ? [{ type: "text", text: c }] : [];
}

function describeTool(b: Block): string {
  const i = b.input ?? {};
  const arg = i["command"] ?? i["file_path"] ?? i["path"] ?? i["pattern"] ?? i["url"] ?? i["description"];
  return `${b.name}${typeof arg === "string" ? `: ${clip(arg, 120)}` : ""}`;
}

/** The last `n` events as one line each. */
export function tail(path: string, n: number): string[] {
  const lines: string[] = [];
  for (const e of read(path)) {
    const t = e.ts.slice(11, 19);
    const ev = e.event;
    if (ev.type === "assistant") {
      for (const b of blocks(e)) {
        if (b.type === "text" && b.text) lines.push(`${t} say  ${clip(b.text, 200)}`);
        if (b.type === "tool_use") lines.push(`${t} tool ${describeTool(b)}`);
      }
    } else if (ev.type === "user") {
      for (const b of blocks(e)) {
        if (b.type === "tool_result" && b.is_error) lines.push(`${t} err  ${clip(String(typeof b.content === "string" ? b.content : JSON.stringify(b.content)), 160)}`);
        if (b.type === "text" && b.text) lines.push(`${t} in   ${clip(b.text, 160)}`);
      }
    } else if (ev.type === "result") {
      lines.push(`${t} end  ${ev.subtype}${ev.result ? `: ${clip(ev.result, 200)}` : ""}`);
    } else if (ev.type === "system" && ev.subtype === "init") {
      lines.push(`${t} init session started`);
    }
  }
  return lines.slice(-n);
}

export interface Summary {
  events: number;
  tool_calls: Record<string, number>;
  files_changed: string[];
  errors: number;
  last_message: string | null;
  result: string | null;
}

/** A deterministic digest of what the worker has done. */
export function summarize(path: string): Summary {
  const toolCalls: Record<string, number> = {};
  const files = new Set<string>();
  let errors = 0;
  let last: string | null = null;
  let result: string | null = null;
  const events = read(path);
  for (const e of events) {
    for (const b of blocks(e)) {
      if (e.event.type === "assistant" && b.type === "text" && b.text) last = b.text;
      if (b.type === "tool_use" && b.name) {
        toolCalls[b.name] = (toolCalls[b.name] ?? 0) + 1;
        const fp = b.input?.["file_path"] ?? b.input?.["notebook_path"];
        if (["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(b.name) && typeof fp === "string") files.add(fp);
      }
      if (b.type === "tool_result" && b.is_error) errors++;
    }
    if (e.event.type === "result") result = e.event.result ?? e.event.subtype ?? null;
  }
  return {
    events: events.length,
    tool_calls: toolCalls,
    files_changed: [...files],
    errors,
    last_message: last ? clip(last, 600) : null,
    result: result ? clip(result, 600) : null,
  };
}
