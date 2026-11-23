// The Board object's migrations (ADR 0001 §2), run in order, once each, like
// the broker's in ../schema.ts. Append new entries; never edit one that has shipped.
//
// Every table has an integer `pk`, and links are foreign keys to it. A link
// between records of one project is a composite key on (project, pk), so the
// store itself refuses one that crosses projects. Free text is never parsed,
// and no column holds Markdown, YAML or JSON as structure.

export const BOARD_MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE projects (
    pk            INTEGER PRIMARY KEY,
    key           TEXT NOT NULL UNIQUE,      -- helix
    name          TEXT NOT NULL,
    prefix        TEXT NOT NULL UNIQUE,      -- LAND
    draft_prefix  TEXT,                      -- DRAFT, for ids imported from Backlog.md's drafts
    lead          TEXT,                      -- BobNet addresses: who gets answers (§7)
    po            TEXT,
    next_item     INTEGER NOT NULL DEFAULT 1 CHECK (next_item > 0),
    next_release  INTEGER NOT NULL DEFAULT 1 CHECK (next_release > 0),
    next_question INTEGER NOT NULL DEFAULT 1 CHECK (next_question > 0),
    next_action   INTEGER NOT NULL DEFAULT 1 CHECK (next_action > 0),
    created_at    TEXT NOT NULL
  );

  CREATE TABLE project_repos (
    project INTEGER NOT NULL REFERENCES projects (pk),
    repo    TEXT NOT NULL,
    PRIMARY KEY (project, repo)
  );

  CREATE TABLE releases (
    pk         INTEGER PRIMARY KEY,
    project    INTEGER NOT NULL REFERENCES projects (pk),
    ref        TEXT NOT NULL,                -- R1
    title      TEXT NOT NULL CHECK (length(title) > 0),
    goal       TEXT,
    status     TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'open', 'closed')),
    ord        INTEGER,                      -- releases in the project; NULL after the ordered ones
    spec_url   TEXT,
    closed_at  TEXT,
    closed_by  TEXT,
    UNIQUE (project, ref),
    UNIQUE (project, pk),
    CHECK ((status = 'closed') = (closed_at IS NOT NULL))
  );

  -- Features, tasks and backlog items: one table, so an item keeps its id when its kind changes.
  CREATE TABLE items (
    pk               INTEGER PRIMARY KEY,
    project          INTEGER NOT NULL REFERENCES projects (pk),
    kind             TEXT NOT NULL CHECK (kind IN ('feature', 'task', 'backlog')),
    type             TEXT NOT NULL CHECK (type IN ('increment', 'task', 'spike', 'bug', 'chore')),
    status           TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Ready', 'In Progress', 'In Review', 'Done')),
    title            TEXT NOT NULL CHECK (length(title) > 0),
    description      TEXT,
    notes            TEXT,
    plan             TEXT,                   -- Backlog.md's Implementation Plan
    parent           INTEGER,                -- a task's feature
    release          INTEGER,                -- a feature's or a backlog item's; a task's is its feature's
    ord              INTEGER,                -- features in a release, backlog items in triage
    open_since       TEXT,                   -- a feature's: set and cleared by session operations only
    archived_at      TEXT,
    archive_reason   TEXT,
    captured_by      TEXT,
    captured_session INTEGER,
    casper_words     TEXT,
    capture_id       TEXT UNIQUE,            -- the offline capture queue's dedupe (§12)
    parent_hint      INTEGER,                -- a backlog item's hint at its feature
    bug_where        TEXT CHECK (bug_where IN ('staging', 'production')),
    blocks_use       INTEGER NOT NULL DEFAULT 0 CHECK (blocks_use IN (0, 1)),
    found_in         INTEGER,                -- a bug's feature
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    UNIQUE (project, pk),
    FOREIGN KEY (project, parent) REFERENCES items (project, pk),
    FOREIGN KEY (project, release) REFERENCES releases (project, pk),
    FOREIGN KEY (project, parent_hint) REFERENCES items (project, pk),
    FOREIGN KEY (project, found_in) REFERENCES items (project, pk),
    FOREIGN KEY (project, captured_session) REFERENCES sessions (project, pk),
    CHECK ((kind = 'feature') = (type = 'increment')),
    CHECK (kind != 'feature' OR parent IS NULL),
    CHECK (kind != 'task' OR (parent IS NOT NULL AND release IS NULL)),
    CHECK (kind != 'backlog' OR parent IS NULL),
    CHECK (kind = 'feature' OR open_since IS NULL),
    CHECK (kind = 'backlog' OR parent_hint IS NULL),
    CHECK ((archived_at IS NULL) = (archive_reason IS NULL)),
    CHECK (type = 'bug' OR (bug_where IS NULL AND blocks_use = 0 AND found_in IS NULL))
  );
  CREATE INDEX items_parent ON items (parent);
  CREATE INDEX items_release ON items (project, release);
  CREATE INDEX items_kind ON items (project, kind, status);

  -- Every id an item has had. A ref is never deleted, so an id is never reused.
  CREATE TABLE item_refs (
    project    INTEGER NOT NULL REFERENCES projects (pk),
    ref        TEXT NOT NULL,
    item       INTEGER NOT NULL,
    is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
    PRIMARY KEY (project, ref),
    FOREIGN KEY (project, item) REFERENCES items (project, pk)
  );
  CREATE UNIQUE INDEX item_refs_primary ON item_refs (item) WHERE is_primary = 1;

  CREATE TABLE item_labels (
    item  INTEGER NOT NULL REFERENCES items (pk),
    label TEXT NOT NULL CHECK (length(label) > 0),
    PRIMARY KEY (item, label)
  );
  CREATE INDEX item_labels_label ON item_labels (label);

  CREATE TABLE item_deps (
    project INTEGER NOT NULL REFERENCES projects (pk),
    item    INTEGER NOT NULL,
    dep     INTEGER NOT NULL,
    PRIMARY KEY (item, dep),
    FOREIGN KEY (project, item) REFERENCES items (project, pk),
    FOREIGN KEY (project, dep) REFERENCES items (project, pk),
    CHECK (item != dep)
  );

  CREATE TABLE criteria (
    pk          INTEGER PRIMARY KEY,
    item        INTEGER NOT NULL REFERENCES items (pk),
    section     TEXT NOT NULL CHECK (section IN ('ac', 'dod')),
    ord         INTEGER NOT NULL CHECK (ord > 0),   -- #1, #2 within the item's section
    text        TEXT NOT NULL CHECK (length(text) > 0),
    evidence    TEXT,
    state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'checked')),
    checked_by  TEXT,
    checked_at  TEXT,
    casper_gate INTEGER NOT NULL DEFAULT 0 CHECK (casper_gate IN (0, 1)),
    UNIQUE (item, section, ord),
    CHECK ((state = 'checked') = (checked_at IS NOT NULL))
  );

  CREATE TABLE sessions (
    pk           INTEGER PRIMARY KEY,
    project      INTEGER NOT NULL REFERENCES projects (pk),
    feature      INTEGER NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('design', 'build', 'review', 'retro')),
    label        TEXT NOT NULL CHECK (length(label) > 0),
    started_at   TEXT NOT NULL,
    ended_at     TEXT,
    imported     INTEGER NOT NULL DEFAULT 0 CHECK (imported IN (0, 1)),
    -- The close (§6), set together with ended_at.
    need         TEXT CHECK (need IN ('none', 'answer', 'casper')),
    minors_fixed INTEGER CHECK (minors_fixed >= 0),
    summary      TEXT CHECK (length(summary) <= 300),
    handoff_path TEXT,
    handoff_text TEXT CHECK (length(handoff_text) <= 65536),
    commit_sha   TEXT,
    closed_by    TEXT,
    UNIQUE (feature, kind, label),
    UNIQUE (project, pk),
    FOREIGN KEY (project, feature) REFERENCES items (project, pk),
    CHECK ((ended_at IS NULL) = (need IS NULL))
  );
  CREATE INDEX sessions_open ON sessions (feature) WHERE ended_at IS NULL;

  -- A close's blockers, majors and tasks sent back.
  CREATE TABLE session_tasks (
    project INTEGER NOT NULL REFERENCES projects (pk),
    session INTEGER NOT NULL,
    item    INTEGER NOT NULL,
    role    TEXT NOT NULL CHECK (role IN ('blocker', 'major', 'sent_back')),
    PRIMARY KEY (session, item, role),
    FOREIGN KEY (project, session) REFERENCES sessions (project, pk),
    FOREIGN KEY (project, item) REFERENCES items (project, pk)
  );

  -- Questions and actions only Casper can answer or do (§7).
  CREATE TABLE questions (
    pk                    INTEGER PRIMARY KEY,
    project               INTEGER NOT NULL REFERENCES projects (pk),
    ref                   TEXT NOT NULL,          -- Q-258, A-17
    kind                  TEXT NOT NULL CHECK (kind IN ('question', 'action')),
    text                  TEXT NOT NULL CHECK (length(text) > 0),
    context               TEXT,
    asked_by              TEXT NOT NULL,
    session               INTEGER,
    needed_before_item    INTEGER,
    needed_before_release INTEGER,
    needed_before_text    TEXT,                   -- when it is neither: "the demo"
    state                 TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'answered', 'done', 'withdrawn')),
    answer_key            TEXT,
    answer_words          TEXT,                   -- Casper's words verbatim, or mark_done's note
    answered_by           TEXT,
    answered_at           TEXT,
    answered_via          TEXT CHECK (answered_via IN ('dashboard', 'conversation')),
    created_at            TEXT NOT NULL,
    UNIQUE (project, ref),
    UNIQUE (project, pk),
    FOREIGN KEY (project, session) REFERENCES sessions (project, pk),
    FOREIGN KEY (project, needed_before_item) REFERENCES items (project, pk),
    FOREIGN KEY (project, needed_before_release) REFERENCES releases (project, pk),
    CHECK ((needed_before_item IS NOT NULL) + (needed_before_release IS NOT NULL) + (needed_before_text IS NOT NULL) <= 1),
    CHECK ((answered_at IS NULL) = (state IN ('open', 'withdrawn')))
  );

  CREATE TABLE question_options (
    question    INTEGER NOT NULL REFERENCES questions (pk),
    ord         INTEGER NOT NULL,
    key         TEXT NOT NULL CHECK (length(key) > 0),
    text        TEXT NOT NULL,
    recommended INTEGER NOT NULL DEFAULT 0 CHECK (recommended IN (0, 1)),
    PRIMARY KEY (question, key),
    UNIQUE (question, ord)
  );

  -- What a question holds up: an item or a session.
  CREATE TABLE question_holds (
    project  INTEGER NOT NULL REFERENCES projects (pk),
    question INTEGER NOT NULL,
    item     INTEGER,
    session  INTEGER,
    FOREIGN KEY (project, question) REFERENCES questions (project, pk),
    FOREIGN KEY (project, item) REFERENCES items (project, pk),
    FOREIGN KEY (project, session) REFERENCES sessions (project, pk),
    CHECK ((item IS NULL) != (session IS NULL)),
    UNIQUE (question, item, session)
  );

  -- A closed session's need: casper questions.
  CREATE TABLE session_waits_on (
    project  INTEGER NOT NULL REFERENCES projects (pk),
    session  INTEGER NOT NULL,
    question INTEGER NOT NULL,
    PRIMARY KEY (session, question),
    FOREIGN KEY (project, session) REFERENCES sessions (project, pk),
    FOREIGN KEY (project, question) REFERENCES questions (project, pk)
  );

  -- Agents' runs (§9). Tokens only: no money column.
  CREATE TABLE runs (
    pk          INTEGER PRIMARY KEY,
    id          TEXT NOT NULL UNIQUE,      -- worker id and run number
    project     INTEGER NOT NULL REFERENCES projects (pk),
    session     INTEGER,                   -- NULL is other work
    agent       TEXT NOT NULL,
    role        TEXT NOT NULL,
    laptop      TEXT NOT NULL,
    model       TEXT,
    effort      TEXT,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    resumed     INTEGER NOT NULL DEFAULT 0 CHECK (resumed IN (0, 1)),
    input       INTEGER NOT NULL DEFAULT 0 CHECK (input >= 0),
    output      INTEGER NOT NULL DEFAULT 0 CHECK (output >= 0),
    cache_read  INTEGER NOT NULL DEFAULT 0 CHECK (cache_read >= 0),
    cache_write INTEGER NOT NULL DEFAULT 0 CHECK (cache_write >= 0),
    calls       INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
    ctx         BLOB,                      -- context per call: little-endian uint32s, up to 2000
    remote_url  TEXT,
    UNIQUE (project, pk),
    FOREIGN KEY (project, session) REFERENCES sessions (project, pk)
  );
  CREATE INDEX runs_session ON runs (session);

  -- The tasks a run's spawn declared.
  CREATE TABLE run_tasks (
    project INTEGER NOT NULL REFERENCES projects (pk),
    run     INTEGER NOT NULL,
    item    INTEGER NOT NULL,
    PRIMARY KEY (run, item),
    FOREIGN KEY (project, run) REFERENCES runs (project, pk),
    FOREIGN KEY (project, item) REFERENCES items (project, pk)
  );

  -- What a supervisor pushed after a land, which ties a CI run to its worker (§10).
  CREATE TABLE pushes (
    pk      INTEGER PRIMARY KEY,
    project INTEGER NOT NULL REFERENCES projects (pk),
    repo    TEXT NOT NULL,
    branch  TEXT NOT NULL,
    sha     TEXT NOT NULL,
    worker  TEXT NOT NULL,
    run     INTEGER,
    at      TEXT NOT NULL,
    UNIQUE (repo, sha),
    FOREIGN KEY (project, run) REFERENCES runs (project, pk)
  );

  -- CI runs from anywhere, and run-slot runs (source 'slot').
  CREATE TABLE ci_runs (
    pk          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL,
    external_id TEXT NOT NULL,
    project     INTEGER NOT NULL REFERENCES projects (pk),
    name        TEXT NOT NULL,
    url         TEXT,
    repo        TEXT,
    branch      TEXT,
    sha         TEXT,
    laptop      TEXT,
    status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed', 'cancelled')),
    started_at  TEXT,
    ended_at    TEXT,
    worker      TEXT,
    session     INTEGER,
    UNIQUE (source, external_id),
    UNIQUE (project, pk),
    FOREIGN KEY (project, session) REFERENCES sessions (project, pk)
  );

  CREATE TABLE ci_run_tasks (
    project INTEGER NOT NULL REFERENCES projects (pk),
    ci_run  INTEGER NOT NULL,
    item    INTEGER NOT NULL,
    PRIMARY KEY (ci_run, item),
    FOREIGN KEY (project, ci_run) REFERENCES ci_runs (project, pk),
    FOREIGN KEY (project, item) REFERENCES items (project, pk)
  );

  -- Who may write what (§5): one row per project (NULL: every project) and agent.
  -- AUTOINCREMENT: a revoked rule's pk is never reused, so its history stays its own.
  CREATE TABLE grants (
    pk        INTEGER PRIMARY KEY AUTOINCREMENT,
    project   INTEGER REFERENCES projects (pk),
    agent     TEXT NOT NULL,
    laptop    TEXT NOT NULL DEFAULT '*',
    role      TEXT NOT NULL,
    read      INTEGER NOT NULL CHECK (read IN (0, 1)),
    items     TEXT NOT NULL CHECK (items IN ('all', 'open_feature', 'not_open_feature', 'none')),
    sessions  INTEGER NOT NULL DEFAULT 0 CHECK (sessions IN (0, 1)),
    questions INTEGER NOT NULL DEFAULT 0 CHECK (questions IN (0, 1)),
    admin     INTEGER NOT NULL DEFAULT 0 CHECK (admin IN (0, 1))
  );
  CREATE UNIQUE INDEX grants_agent ON grants (ifnull(project, 0), lower(agent), lower(laptop));

  CREATE TABLE grant_fields (
    grant_pk INTEGER NOT NULL REFERENCES grants (pk) ON DELETE CASCADE,
    field    TEXT NOT NULL CHECK (field IN ('status', 'order', 'content', 'criteria', 'triage', 'create')),
    PRIMARY KEY (grant_pk, field)
  );

  -- The history (§3): written with every change, in its transaction, never updated or deleted.
  CREATE TABLE events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,
    project    INTEGER REFERENCES projects (pk),   -- NULL: a rule for every project
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('owner', 'agent', 'ci', 'board')),
    actor      TEXT NOT NULL,                      -- an address or the owner's email
    role       TEXT,
    worker     TEXT,
    session    INTEGER,
    op         TEXT NOT NULL,
    tbl        TEXT NOT NULL,
    pk         INTEGER NOT NULL,
    ref        TEXT,
    reason     TEXT,
    undo_of    INTEGER REFERENCES events (seq),
    FOREIGN KEY (project, session) REFERENCES sessions (project, pk)
  );
  CREATE INDEX events_record ON events (tbl, pk);
  CREATE INDEX events_session ON events (session);
  CREATE INDEX events_project ON events (project, seq);

  CREATE TABLE event_changes (
    event INTEGER NOT NULL REFERENCES events (seq),
    field TEXT NOT NULL,
    old   TEXT,
    new   TEXT
  );
  CREATE INDEX event_changes_event ON event_changes (event);

  CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE (ABORT, 'events are never changed'); END;
  CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE (ABORT, 'events are never deleted'); END;
  CREATE TRIGGER event_changes_no_update BEFORE UPDATE ON event_changes BEGIN SELECT RAISE (ABORT, 'events are never changed'); END;
  CREATE TRIGGER event_changes_no_delete BEFORE DELETE ON event_changes BEGIN SELECT RAISE (ABORT, 'events are never deleted'); END;
  `,
  // 2: a write's operation key (§12), so a resent write gets its first reply and writes nothing.
  // `reply` is a cached wire reply, not board data: returned as it is, never exported or queried.
  `
  CREATE TABLE op_keys (
    key   TEXT PRIMARY KEY,
    actor TEXT NOT NULL,                     -- who made the write, as its events name them
    op    TEXT NOT NULL,
    at    TEXT NOT NULL,
    reply TEXT NOT NULL
  );
  CREATE INDEX op_keys_at ON op_keys (at);
  `,
  // 3: how a run ended (ADR 0005 §3), and the status read's time indexes (§2). Old runs keep null: unknown.
  `
  ALTER TABLE runs ADD COLUMN outcome TEXT CHECK (outcome IN ('done', 'failed', 'stopped', 'lost'));
  ALTER TABLE runs ADD COLUMN outcome_reason TEXT CHECK (length(outcome_reason) <= 300);
  CREATE INDEX events_at ON events (project, at);
  CREATE INDEX runs_ended ON runs (project, ended_at);
  CREATE INDEX ci_runs_ended ON ci_runs (project, ended_at);
  `,
  // 4: BobNet's own project gives up draft prefix DRAFT, which its BOB-14 import took but no id of its
  // has (ADR 0006), so Helix's import can bring its DRAFT-n ids. Kept if any id of bobnet's, aliases
  // included, is a DRAFT- one. The change is in the history, as the board's: no op edits a project.
  `
  INSERT INTO events (at, project, actor_kind, actor, op, tbl, pk, ref, reason)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), pk, 'board', 'migration 4', 'update_project', 'projects', pk, key, 'draft prefix freed for Helix''s import (ADR 0006)'
  FROM projects
  WHERE key = 'bobnet' AND draft_prefix = 'DRAFT' AND NOT EXISTS (SELECT 1 FROM item_refs WHERE project = projects.pk AND ref LIKE 'DRAFT-%');
  INSERT INTO event_changes (event, field, old, new)
  SELECT last_insert_rowid(), 'draft_prefix', draft_prefix, NULL
  FROM projects
  WHERE key = 'bobnet' AND draft_prefix = 'DRAFT' AND NOT EXISTS (SELECT 1 FROM item_refs WHERE project = projects.pk AND ref LIKE 'DRAFT-%');
  UPDATE projects SET draft_prefix = NULL
  WHERE key = 'bobnet' AND draft_prefix = 'DRAFT' AND NOT EXISTS (SELECT 1 FROM item_refs WHERE project = projects.pk AND ref LIKE 'DRAFT-%');
  `,
  // 5: grant field 'release' (BOB-122): moving a feature into or out of a release is a grant, not Casper's gate.
  // SQLite can't change a CHECK in place, so the table is made again; nothing refers to it.
  `
  CREATE TABLE grant_fields_new (
    grant_pk INTEGER NOT NULL REFERENCES grants (pk) ON DELETE CASCADE,
    field    TEXT NOT NULL CHECK (field IN ('status', 'order', 'content', 'criteria', 'triage', 'create', 'release')),
    PRIMARY KEY (grant_pk, field)
  );
  INSERT INTO grant_fields_new (grant_pk, field) SELECT grant_pk, field FROM grant_fields;
  DROP TABLE grant_fields;
  ALTER TABLE grant_fields_new RENAME TO grant_fields;
  `,
  // 6: an answer's notice (ADR 0009 §1), written in the answer's transaction, for the broker to send and
  // mark taken. Not board data: never exported, never read by an operation. `seq` is the answer's event.
  `
  CREATE TABLE notices (
    seq      INTEGER PRIMARY KEY,
    project  TEXT NOT NULL,
    question TEXT NOT NULL,
    state    TEXT NOT NULL CHECK (state IN ('answered', 'done', 'withdrawn')),
    to_json  TEXT NOT NULL,                       -- the agents' recipients: the lead and asked_by, minus the writer
    "except" TEXT,                                -- the writer's address; null for the owner
    text     TEXT NOT NULL,                       -- the agents' message
    notice   TEXT NOT NULL,                       -- the supervisor's JSON
    taken_at TEXT
  );
  CREATE INDEX notices_untaken ON notices (seq) WHERE taken_at IS NULL;
  `,
  // 7: Waits is never stale (ADR 0011). A landed fix marks its bug (`bug_fixes`), a release tag the
  // upgrade verified fills its release (`release_tags`), and a row a day unchanged is flagged to its
  // owner once a day (`wait_flags`, not board data: never exported, never read by an operation).
  // `notices` is made again (§4, ADR 0010's shape): `question` is `subject`, with a `kind`.
  `
  CREATE TABLE release_tags (
    pk      INTEGER PRIMARY KEY,
    project INTEGER NOT NULL REFERENCES projects (pk),
    repo    TEXT NOT NULL,
    tag     TEXT NOT NULL,
    sha     TEXT NOT NULL,
    push    INTEGER REFERENCES pushes (pk),        -- the tag's own push; NULL: never pushed, marks nothing
    at      TEXT NOT NULL,
    UNIQUE (repo, tag)
  );

  CREATE TABLE bug_fixes (
    pk      INTEGER PRIMARY KEY,
    project INTEGER NOT NULL REFERENCES projects (pk),
    item    INTEGER NOT NULL,
    sha     TEXT NOT NULL,
    subject TEXT NOT NULL,
    push    INTEGER NOT NULL REFERENCES pushes (pk),
    release TEXT,                                  -- the first release tag at or after its push
    at      TEXT NOT NULL,
    UNIQUE (item, sha),
    FOREIGN KEY (project, item) REFERENCES items (project, pk)
  );
  CREATE INDEX bug_fixes_unreleased ON bug_fixes (project, push) WHERE release IS NULL;

  CREATE TABLE wait_flags (
    project    INTEGER NOT NULL REFERENCES projects (pk),
    ref        TEXT NOT NULL,
    owner      TEXT,
    changed_at TEXT NOT NULL,
    flagged_at TEXT NOT NULL,
    PRIMARY KEY (project, ref)
  );

  CREATE TABLE notices_new (
    seq      INTEGER PRIMARY KEY,
    project  TEXT NOT NULL,
    kind     TEXT NOT NULL CHECK (kind IN ('answer', 'fix', 'stale')),
    subject  TEXT NOT NULL,                       -- the question's or the item's ref
    state    TEXT NOT NULL CHECK (state IN ('answered', 'done', 'withdrawn', 'fix_landed', 'fix_released', 'stale')),
    to_json  TEXT NOT NULL,
    "except" TEXT,
    text     TEXT NOT NULL,
    notice   TEXT NOT NULL,
    taken_at TEXT
  );
  INSERT INTO notices_new (seq, project, kind, subject, state, to_json, "except", text, notice, taken_at)
  SELECT seq, project, 'answer', question, state, to_json, "except", text, notice, taken_at FROM notices;
  DROP TABLE notices;
  ALTER TABLE notices_new RENAME TO notices;
  CREATE INDEX notices_untaken ON notices (seq) WHERE taken_at IS NULL;
  `,
  // 8: a run's tokens by the model that used them (ADR 0014 §2), adding up to the run's own. A run from a
  // supervisor before it, or one that ended mid-turn, has none, and is weighed by its declared model.
  `
  CREATE TABLE run_models (
    project     INTEGER NOT NULL REFERENCES projects (pk),
    run         INTEGER NOT NULL,
    model       TEXT NOT NULL,
    input       INTEGER NOT NULL CHECK (input >= 0),
    output      INTEGER NOT NULL CHECK (output >= 0),
    cache_read  INTEGER NOT NULL CHECK (cache_read >= 0),
    cache_write INTEGER NOT NULL CHECK (cache_write >= 0),
    PRIMARY KEY (run, model),
    FOREIGN KEY (project, run) REFERENCES runs (project, pk)
  );
  `,
];
