// BOB-212 prototype v4: the ERD viewer's DBML parser (ADR 0017 §7), bundled to an IIFE beside Liam's app.
// Toad's dbml-to-liam.mjs does the conversion; this adds what the entity card shows that Liam's schema JSON
// drops (spec §10.2, proposals in §14): each enum's values with their notes, and each table's line in the file.
//   cp <repo>/architecture/spikes/bob212/dbml-to-liam.mjs <dir with @dbml/parse 13.0.0>/
//   cp this file there, then: npx esbuild dbml-entry.mjs --bundle --minify --format=iife --platform=browser --outfile=dbml.js
import { Compiler, DEFAULT_ENTRY, MemoryProjectLayout } from "@dbml/parse";
import { dbmlToLiam, only } from "./dbml-to-liam.mjs";

function extras(text) {
  const layout = new MemoryProjectLayout();
  layout.setSource(DEFAULT_ENTRY, text);
  const c = new Compiler(layout);
  if (c.parse.errors(DEFAULT_ENTRY).length) return { enums: [], lines: {} };
  const db = c.parse.rawDb(DEFAULT_ENTRY);
  return {
    enums: db.enums.map((e) => ({ name: e.name, note: e.note?.value ?? null, values: e.values.map((x) => ({ name: x.name, note: x.note?.value ?? null })) })),
    lines: Object.fromEntries(db.tables.map((t) => [t.name, t.token?.start?.line ?? null])),
  };
}

window.dbmlToLiam = dbmlToLiam;
window.dbmlOnly = only;
window.dbmlExtras = extras;
