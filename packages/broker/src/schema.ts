// Migrations run in order, once each, inside the Durable Object's SQLite.
// Append new entries; never edit one that has shipped.

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE peers (
    key        TEXT PRIMARY KEY,           -- lower(name)@lower(laptop)
    name       TEXT NOT NULL,
    laptop     TEXT NOT NULL,
    team       TEXT,
    purpose    TEXT,
    expertise  TEXT NOT NULL DEFAULT '[]', -- JSON array
    status     TEXT,
    conn_id    TEXT,                       -- hosting connection; NULL when offline
    last_seen  TEXT NOT NULL
  );
  CREATE INDEX peers_conn ON peers (conn_id);

  CREATE TABLE messages (
    id         TEXT PRIMARY KEY,
    envelope   TEXT NOT NULL,              -- JSON Envelope
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX messages_expiry ON messages (expires_at);

  -- One row per recipient until it acks; the message outlives its deliveries
  -- until it expires, so replies can still reference it.
  CREATE TABLE deliveries (
    message_id TEXT NOT NULL,
    to_key     TEXT NOT NULL,
    PRIMARY KEY (message_id, to_key)
  );
  CREATE INDEX deliveries_to ON deliveries (to_key);

  -- Who did what, never message bodies.
  CREATE TABLE audit (
    seq    INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     TEXT NOT NULL,
    actor  TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL
  );
  CREATE INDEX audit_ts ON audit (ts);
  `,
];

export function migrate(sql: SqlStorage): void {
  sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const row = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'").toArray()[0];
  const current = row ? Number(row.value) : 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    sql.exec(MIGRATIONS[v]!);
    sql.exec(
      "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      String(v + 1),
    );
  }
}
