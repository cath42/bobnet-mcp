CREATE TYPE "loan_state" AS ENUM (
  'out',
  'returned',
  'overdue',
  'lost'
);

CREATE TYPE "tool_condition" AS ENUM (
  'good',
  'worn',
  'repair',
  'retired'
);

CREATE TABLE "member" (
  "id" uuid PRIMARY KEY,
  "email" text UNIQUE NOT NULL,
  "name" text NOT NULL,
  "phone" text,
  "home_shed_id" uuid NOT NULL,
  "is_steward" boolean NOT NULL DEFAULT false,
  "joined_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "shed" (
  "id" uuid PRIMARY KEY,
  "name" text UNIQUE NOT NULL,
  "address" text NOT NULL,
  "opening_hours" text NOT NULL
);

CREATE TABLE "category" (
  "id" uuid PRIMARY KEY,
  "name" text UNIQUE NOT NULL,
  "parent_id" uuid
);

CREATE TABLE "tool" (
  "id" uuid PRIMARY KEY,
  "shed_id" uuid NOT NULL,
  "category_id" uuid NOT NULL,
  "name" text NOT NULL,
  "condition" tool_condition NOT NULL DEFAULT 'good',
  "loan_days" int NOT NULL DEFAULT 7,
  "added_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "photo" (
  "id" uuid PRIMARY KEY,
  "tool_id" uuid NOT NULL,
  "object_key" text UNIQUE NOT NULL,
  "position" int NOT NULL DEFAULT 0
);

CREATE TABLE "reservation" (
  "id" uuid PRIMARY KEY,
  "tool_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "pickup_on" date NOT NULL,
  "hold_until" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "loan" (
  "id" uuid PRIMARY KEY,
  "tool_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "reservation_id" uuid UNIQUE,
  "checked_out_by" uuid NOT NULL,
  "out_at" timestamptz NOT NULL,
  "due_at" timestamptz NOT NULL,
  "returned_at" timestamptz,
  "state" loan_state NOT NULL DEFAULT 'out'
);

CREATE TABLE "damage_report" (
  "id" uuid PRIMARY KEY,
  "loan_id" uuid NOT NULL,
  "reported_by" uuid NOT NULL,
  "description" text NOT NULL,
  "needs_repair" boolean NOT NULL DEFAULT false,
  "reported_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "notification" (
  "id" uuid PRIMARY KEY,
  "member_id" uuid NOT NULL,
  "loan_id" uuid,
  "kind" text NOT NULL,
  "channel" text NOT NULL,
  "sent_at" timestamptz
);

CREATE UNIQUE INDEX ON "reservation" ("tool_id", "pickup_on");

COMMENT ON TABLE "member" IS 'A person who may borrow tools. Joining is free; a member is blocked while they have an overdue loan.';

COMMENT ON COLUMN "member"."email" IS 'Where reminders go when push is off';

COMMENT ON COLUMN "member"."phone" IS 'Optional; stewards call it for an overdue loan';

COMMENT ON COLUMN "member"."home_shed_id" IS 'The shed the member joined at';

COMMENT ON COLUMN "member"."is_steward" IS 'A steward may check tools out and in';

COMMENT ON TABLE "shed" IS 'A place where tools are kept and handed over. A tool lives in one shed.';

COMMENT ON COLUMN "shed"."opening_hours" IS 'Free text, shown as written, e.g. "Sat 10-13"';

COMMENT ON TABLE "category" IS 'How the catalogue is browsed, e.g. Garden > Hedge trimmers. Two levels at most.';

COMMENT ON COLUMN "category"."parent_id" IS 'Null for a top-level category';

COMMENT ON TABLE "tool" IS 'One physical tool on a shelf. Two identical drills are two tools.';

COMMENT ON COLUMN "tool"."name" IS 'As a member would say it, e.g. "Cordless drill, 18 V"';

COMMENT ON COLUMN "tool"."loan_days" IS 'How long one loan may last';

COMMENT ON TABLE "photo" IS 'A picture of a tool. The bytes are in object storage; this row is the pointer.';

COMMENT ON COLUMN "photo"."object_key" IS 'Its key in the photo bucket';

COMMENT ON COLUMN "photo"."position" IS 'Order in the gallery; 0 is the cover';

COMMENT ON TABLE "reservation" IS 'A member asking to pick a tool up on a given day. It holds the tool until hold_until.';

COMMENT ON COLUMN "reservation"."pickup_on" IS 'The day the member means to collect it';

COMMENT ON COLUMN "reservation"."hold_until" IS 'pickup_on plus 24 h (ADR 0001); after it the hold lapses';

COMMENT ON TABLE "loan" IS 'A tool in a member''s hands, from check-out at the counter to its return.';

COMMENT ON COLUMN "loan"."reservation_id" IS 'The reservation it fulfilled; null for a walk-in';

COMMENT ON COLUMN "loan"."checked_out_by" IS 'The steward at the counter';

COMMENT ON COLUMN "loan"."due_at" IS 'out_at plus the tool''s loan_days';

COMMENT ON TABLE "damage_report" IS 'Something wrong with a tool, found during or after a loan. Reports never block a member.';

COMMENT ON COLUMN "damage_report"."needs_repair" IS 'True sets the tool''s condition to repair';

COMMENT ON TABLE "notification" IS 'One reminder to a member, queued by the worker and sent once.';

COMMENT ON COLUMN "notification"."kind" IS 'due_soon, overdue, hold_lapsing';

COMMENT ON COLUMN "notification"."channel" IS 'push or email (ADR 0003)';

ALTER TABLE "member" ADD FOREIGN KEY ("home_shed_id") REFERENCES "shed" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "category" ADD FOREIGN KEY ("parent_id") REFERENCES "category" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "tool" ADD FOREIGN KEY ("shed_id") REFERENCES "shed" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "tool" ADD FOREIGN KEY ("category_id") REFERENCES "category" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "photo" ADD FOREIGN KEY ("tool_id") REFERENCES "tool" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "reservation" ADD FOREIGN KEY ("tool_id") REFERENCES "tool" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "reservation" ADD FOREIGN KEY ("member_id") REFERENCES "member" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "loan" ADD FOREIGN KEY ("tool_id") REFERENCES "tool" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "loan" ADD FOREIGN KEY ("member_id") REFERENCES "member" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "loan" ADD FOREIGN KEY ("reservation_id") REFERENCES "reservation" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "loan" ADD FOREIGN KEY ("checked_out_by") REFERENCES "member" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "damage_report" ADD FOREIGN KEY ("loan_id") REFERENCES "loan" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "damage_report" ADD FOREIGN KEY ("reported_by") REFERENCES "member" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification" ADD FOREIGN KEY ("member_id") REFERENCES "member" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification" ADD FOREIGN KEY ("loan_id") REFERENCES "loan" ("id") DEFERRABLE INITIALLY IMMEDIATE;
