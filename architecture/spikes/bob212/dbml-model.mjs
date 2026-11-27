// BOB-212 (ADR 0017 §7, as amended for Q-22): the library's data model, one DBML file, to what BobNet's own ERD
// viewer draws and what its `ready` carries for the entity card. It replaces dbml-to-liam.mjs: no Liam schema JSON.
// The viewer runs this inside its sandboxed frame; nothing outside the browser parses the model.
import { Compiler, DEFAULT_ENTRY, MemoryProjectLayout } from "@dbml/parse";

const note = (n) => n?.value ?? null;
const dflt = (d) => (d == null ? null : d.type === "number" ? Number(d.value) : d.type === "boolean" ? String(d.value) === "true" : String(d.value));

// -> {tables: [{name, note, line, columns: [{name, type, notNull, default, unique, pk, note}], pk, fks}],
//     enums: [{name, note, values: [{name, note}]}], views: [{id, tables}], note, errors: [{line, message}]}
// fks: [{columns, table, targetColumns, one}]; `one` is a one-to-one (the unique foreign key of 0017 §3).
export function readDbml(text) {
  const layout = new MemoryProjectLayout();
  layout.setSource(DEFAULT_ENTRY, text);
  const c = new Compiler(layout);
  const errors = c.parse.errors(DEFAULT_ENTRY).map((e) => ({ line: e.nodeOrToken?.startPos?.line + 1 || e.location?.start?.line || 0, message: e.diagnostic ?? e.message }));
  if (errors.length) return { tables: [], enums: [], views: [], note: null, errors };
  const db = c.parse.rawDb(DEFAULT_ENTRY), byName = {};
  const tables = db.tables.map((t) => {
    const pk = t.fields.filter((f) => f.pk).map((f) => f.name), unique = new Set(t.fields.filter((f) => f.unique).map((f) => f.name));
    for (const ix of t.indexes) {
      const cols = ix.columns.map((x) => x.value);
      if (ix.pk) pk.push(...cols);
      else if (ix.unique && cols.length === 1) unique.add(cols[0]);
    }
    const columns = t.fields.map((f) => ({ name: f.name, type: f.type.type_name, notNull: !!(f.pk || f.not_null), default: dflt(f.dbdefault), unique: unique.has(f.name), pk: pk.includes(f.name), note: note(f.note) }));
    return (byName[t.name] = { name: t.name, note: note(t.note), line: t.token?.start?.line ?? null, columns, pk, fks: [] });
  });
  // The many side of a ref holds the foreign key; in a one-to-one, the side that isn't its table's key.
  const isPk = (e) => e.fieldNames.every((n) => byName[e.tableName]?.pk.includes(n));
  for (const r of db.refs) {
    const [a, b] = r.endpoints;
    const [from, to] = a.relation === "*" ? [a, b] : b.relation === "*" ? [b, a] : isPk(a) ? [b, a] : [a, b];
    const one = from.relation !== "*" && to.relation !== "*";
    byName[from.tableName]?.fks.push({ columns: from.fieldNames, table: to.tableName, targetColumns: to.fieldNames, one });
  }
  const enums = db.enums.map((e) => ({ name: e.name, note: note(e.note), values: e.values.map((x) => ({ name: x.name, note: note(x.note) })) }));
  const groups = Object.fromEntries(db.tableGroups.map((g) => [g.name, g.tables.map((t) => t.name)]));
  const views = (db.diagramViews ?? []).map((d) => ({ id: d.name, tables: [...new Set([
    ...d.visibleEntities.tables.map((t) => t.name),
    ...d.visibleEntities.tableGroups.flatMap((g) => groups[g.name] ?? []),
  ])] }));
  return { tables, enums, views, note: note(db.project?.note), errors };
}
