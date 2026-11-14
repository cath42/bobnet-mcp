import type { BoardCaller, GrantField, GrantItems } from "@bobnet/protocol";
import { BoardError } from "./errors.ts";

// Who may write what (ADR 0001 §5). The rules are board data, one `grants` row
// per project and agent; the owner is under none of them. A refusal says why
// and who may make the write instead.

interface GrantRow {
  pk: number;
  agent: string;
  laptop: string;
  role: string;
  read: number;
  items: GrantItems;
  sessions: number;
  questions: number;
  admin: number;
  fields: string | null;
  [k: string]: SqlStorageValue;
}

/** The feature an item belongs to, as far as the rules ask: itself for a feature, its parent for a task, none for a backlog item. */
export interface Scope {
  ref: string;
  open: boolean;
}

/** Field groups as a refusal names them. */
const SAYS: Record<GrantField, string> = {
  status: "change status",
  order: "change order",
  content: "change content",
  criteria: "change criteria",
  triage: "triage",
  create: "create items",
};

const FLAGS = { sessions: "close sessions", questions: "ask Casper or record his answers", admin: "change the rules" } as const;
export type Flag = keyof typeof FLAGS;

export class Rules {
  constructor(private readonly sql: SqlStorage) {}

  /** Every row that applies to an agent on a project: the project's own and the every-project ones. */
  private rows(project: number | null, name: string, laptop: string): GrantRow[] {
    return this.sql
      .exec<GrantRow>(
        `SELECT g.*, (SELECT group_concat(field) FROM grant_fields WHERE grant_pk = g.pk) AS fields FROM grants g
         WHERE (g.project IS NULL OR g.project = ?) AND lower(g.agent) = lower(?) AND (g.laptop = '*' OR lower(g.laptop) = lower(?))`,
        project,
        name,
        laptop,
      )
      .toArray();
  }

  /** Projects an agent may read: null means every one. */
  readable(caller: BoardCaller): Set<number> | null {
    if (caller.kind === "owner") return null;
    const rows = this.sql
      .exec<{ project: number | null }>(
        "SELECT project FROM grants WHERE read = 1 AND lower(agent) = lower(?) AND (laptop = '*' OR lower(laptop) = lower(?))",
        caller.name,
        caller.laptop,
      )
      .toArray();
    if (rows.some((r) => r.project === null)) return null;
    return new Set(rows.map((r) => r.project!));
  }

  requireRead(caller: BoardCaller, project: { pk: number; key: string }): void {
    if (caller.kind === "owner") return;
    if (!this.rows(project.pk, caller.name, caller.laptop).some((r) => r.read === 1)) {
      throw new BoardError("forbidden", `${caller.name} may not read ${project.key}'s board`);
    }
  }

  /**
   * A write of one field group to an item under `scope` (null: no feature, as a backlog item or a
   * release). `open_feature` covers a feature that is open and that the caller's declared session is
   * on; `not_open_feature` covers every item whose feature isn't open.
   */
  require(caller: BoardCaller, project: { pk: number; key: string }, field: GrantField, scope: Scope | null, what: string): void {
    if (caller.kind === "owner" || this.may(caller, project, field, scope)) return;
    const rows = this.rows(project.pk, caller.name, caller.laptop);
    const scoped = rows.some((r) => hasField(r, field));
    const why = scoped && scope?.open ? ` (${scope.ref} is open${caller.ctx?.session ? ` and ${caller.name}'s session is on ${caller.ctx.session.feature}` : ""})` : "";
    throw new BoardError("forbidden", `${caller.name} may not ${SAYS[field]} on ${what} in ${project.key}${why}; ${this.whoMay(project.pk, field)}`);
  }

  /** Whether the caller may write `field` under `scope`, as `require` decides it. */
  may(caller: BoardCaller, project: { pk: number; key: string }, field: GrantField, scope: Scope | null): boolean {
    if (caller.kind === "owner") return true;
    const covers = (items: GrantItems) => {
      if (items === "all") return true;
      if (items === "none") return false;
      const mine = scope !== null && scope.open && caller.ctx?.project === project.key && caller.ctx.session?.feature === scope.ref;
      return items === "open_feature" ? mine : !scope?.open;
    };
    return this.rows(project.pk, caller.name, caller.laptop).some((r) => hasField(r, field) && covers(r.items));
  }

  requireFlag(caller: BoardCaller, project: { pk: number; key: string }, flag: Flag): void {
    if (caller.kind === "owner") return;
    if (this.rows(project.pk, caller.name, caller.laptop).some((r) => r[flag] === 1)) return;
    const who = this.sql
      .exec<{ agent: string }>(`SELECT agent FROM grants WHERE (project IS NULL OR project = ?) AND ${flag} = 1 ORDER BY agent`, project.pk)
      .toArray()
      .map((r) => r.agent);
    throw new BoardError("forbidden", `${caller.name} may not ${FLAGS[flag]} on ${project.key}; ${sayWho(who)}`);
  }

  /** "Picard may, or Riker on the open feature", from the project's rows. */
  private whoMay(project: number, field: GrantField): string {
    const rows = this.sql
      .exec<{ agent: string; items: GrantItems }>(
        `SELECT g.agent, g.items FROM grants g JOIN grant_fields f ON f.grant_pk = g.pk
         WHERE (g.project IS NULL OR g.project = ?) AND f.field = ? AND g.items != 'none' ORDER BY g.items, g.agent`,
        project,
        field,
      )
      .toArray();
    const where = { all: "", open_feature: " on the open feature", not_open_feature: " off the open feature", none: "" };
    return sayWho(rows.map((r) => `${r.agent}${where[r.items]}`));
  }
}

function hasField(row: GrantRow, field: GrantField): boolean {
  return (row.fields ?? "").split(",").includes(field);
}

function sayWho(who: string[]): string {
  if (who.length === 0) return "only the owner may";
  return `${who.slice(0, -1).join(", ")}${who.length > 1 ? ", or " : ""}${who.at(-1)} may`;
}
