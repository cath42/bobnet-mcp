// BOB-212 (ADR 0017): the library's data model, one DBML file, to the schema JSON Liam ERD's app reads.
// The ERD viewer runs this inside its sandboxed frame; nothing outside the browser parses the model.
import { Compiler, DEFAULT_ENTRY, MemoryProjectLayout } from "@dbml/parse";

const v = (n) => n?.value ?? null;
const dflt = (d) => (d == null ? null : d.type === "number" ? Number(d.value) : d.type === "boolean" ? String(d.value) === "true" : String(d.value));
const act = (a) => (a ? a.toUpperCase().replace(/ /g, "_") : "NO_ACTION");

// -> {schema, views: [{id, tables}], note, errors: [{line, message}]}
export function dbmlToLiam(text) {
  const layout = new MemoryProjectLayout();
  layout.setSource(DEFAULT_ENTRY, text);
  const c = new Compiler(layout);
  const errors = c.parse.errors(DEFAULT_ENTRY).map((e) => ({ line: e.nodeOrToken?.startPos?.line + 1 || e.location?.start?.line || 0, message: e.diagnostic ?? e.message }));
  if (errors.length) return { schema: null, views: [], note: null, errors };
  const db = c.parse.rawDb(DEFAULT_ENTRY), tables = {}, enums = {};
  for (const t of db.tables) {
    const columns = {}, constraints = {}, indexes = {};
    for (const f of t.fields) {
      columns[f.name] = { name: f.name, type: f.type.type_name, default: dflt(f.dbdefault), check: null, notNull: !!(f.pk || f.not_null), comment: v(f.note) };
      if (f.unique) constraints[`${t.name}_${f.name}_key`] = { type: "UNIQUE", name: `${t.name}_${f.name}_key`, columnNames: [f.name] };
    }
    const pk = t.fields.filter((f) => f.pk).map((f) => f.name);
    for (const ix of t.indexes) {
      const cols = ix.columns.map((x) => x.value), n = ix.name || `${t.name}_${cols.join("_")}_idx`;
      if (ix.pk) pk.push(...cols);
      else indexes[n] = { name: n, unique: !!ix.unique, columns: cols, type: ix.type || "btree" };
    }
    if (pk.length) constraints[`${t.name}_pkey`] = { type: "PRIMARY KEY", name: `${t.name}_pkey`, columnNames: pk };
    tables[t.name] = { name: t.name, columns, comment: v(t.note), indexes, constraints };
  }
  // The many side of a ref holds the foreign key; in a one-to-one, the side that isn't its table's key.
  const isPk = (e) => e.fieldNames.every((n) => tables[e.tableName]?.constraints[`${e.tableName}_pkey`]?.columnNames.includes(n));
  for (const r of db.refs) {
    const [a, b] = r.endpoints;
    const [from, to] = a.relation === "*" ? [a, b] : b.relation === "*" ? [b, a] : isPk(a) ? [b, a] : [a, b];
    const n = r.name || `${from.tableName}_${from.fieldNames.join("_")}_fkey`;
    tables[from.tableName].constraints[n] = { type: "FOREIGN KEY", name: n, columnNames: from.fieldNames, targetTableName: to.tableName, targetColumnNames: to.fieldNames, updateConstraint: act(r.onUpdate), deleteConstraint: act(r.onDelete) };
  }
  for (const e of db.enums) enums[e.name] = { name: e.name, values: e.values.map((x) => x.name), comment: v(e.note) };
  const groups = Object.fromEntries(db.tableGroups.map((g) => [g.name, g.tables.map((t) => t.name)]));
  const views = (db.diagramViews ?? []).map((d) => ({ id: d.name, tables: [...new Set([
    ...d.visibleEntities.tables.map((t) => t.name),
    ...d.visibleEntities.tableGroups.flatMap((g) => groups[g.name] ?? []),
  ])] }));
  return { schema: { tables, enums, extensions: {} }, views, note: v(db.project?.note), errors };
}

// One diagram's schema: its tables, and only the relations between them.
export function only(schema, names) {
  const keep = new Set(names), tables = {};
  for (const n of names) {
    const t = schema.tables[n]; if (!t) continue;
    tables[n] = { ...t, constraints: Object.fromEntries(Object.entries(t.constraints).filter(([, k]) => k.type !== "FOREIGN KEY" || keep.has(k.targetTableName))) };
  }
  return { ...schema, tables };
}
