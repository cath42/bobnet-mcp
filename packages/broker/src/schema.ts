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
  `
  -- The latest snapshot each laptop's supervisor reported.
  CREATE TABLE laptop_reports (
    laptop   TEXT PRIMARY KEY,
    snapshot TEXT NOT NULL,             -- JSON LaptopSnapshot
    at       TEXT NOT NULL
  );

  -- Short session updates for the dashboard feed.
  CREATE TABLE updates (
    seq      INTEGER PRIMARY KEY AUTOINCREMENT,
    laptop   TEXT NOT NULL,
    from_addr TEXT NOT NULL,
    text     TEXT NOT NULL,
    at       TEXT NOT NULL
  );
  CREATE INDEX updates_at ON updates (at);
  `,
  `
  ALTER TABLE peers ADD COLUMN instance TEXT;
  `,
  `
  -- The supervisor peer that reports for each laptop, which dashboard actions go to.
  ALTER TABLE laptop_reports ADD COLUMN reporter TEXT;

  -- Each owner connection's Access JWT, forwarded with its actions so the
  -- supervisor can verify the owner itself. Deleted when the socket closes.
  CREATE TABLE owner_tokens (
    conn_id TEXT PRIMARY KEY,
    token   TEXT NOT NULL
  );
  `,
  `
  -- Each project's latest board (backlog, sessions, past runs), as its laptop's supervisor sent it.
  CREATE TABLE project_boards (
    laptop  TEXT NOT NULL,
    project TEXT NOT NULL,
    board   TEXT NOT NULL,              -- JSON ProjectBoard
    at      TEXT NOT NULL,
    PRIMARY KEY (laptop, project)
  );
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
