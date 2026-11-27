// Made by tools/gen_data.mjs from architecture/spikes/bob212/sample/library/ at 1c83f2b. Toolshed is fictional and public.
window.LIBS = {
 "toolshed": {
  "key": "toolshed",
  "ref": "main",
  "commit": "1c83f2bfbc650bb3815744cdfda495d1044fdc4a",
  "committed_at": "2026-11-26T21:34:27-06:00",
  "laptop": "mbp-1",
  "github": "https://github.com/cath42/bobnet-mcp",
  "root": "architecture/spikes/bob212/sample/",
  "index": {
   "standard": 1,
   "files": [
    {
     "path": "library/architecture/model.c4",
     "section": "architecture",
     "blob": "57ffbd2c283dae46df1d961fdf291f9e9f9830dc",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": null,
     "head": null
    },
    {
     "path": "library/architecture/spec.c4",
     "section": "architecture",
     "blob": "5df6ff15b252713444ae5fde51ee903f2fa4c54d",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": null,
     "head": null
    },
    {
     "path": "library/architecture/views.c4",
     "section": "architecture",
     "blob": "f35e62c58228158157fd20e8efd52bc767934a75",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": null,
     "head": null
    },
    {
     "path": "library/data-model.dbml",
     "section": "data",
     "blob": "51c1e511043f0dbfbdef15b3a99a538fef69c750",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": null,
     "head": null
    },
    {
     "path": "library/decisions/0001-reservations-hold-for-24-hours.md",
     "section": "decisions",
     "blob": "0fe2e8e756b6a3e1797efccd30cb4922740f7701",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": "Reservations hold a tool until 24 hours after the pickup day",
     "head": {
      "status": "accepted",
      "date": "2026-03-02",
      "decision-makers": "[Otto, Wren]",
      "feature": "TS-4"
     }
    },
    {
     "path": "library/decisions/0002-email-reminders.md",
     "section": "decisions",
     "blob": "2aa82a2da2fa9e7a1a9ff020ffe55226aa5def8a",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": "Reminders go by email",
     "head": {
      "status": "superseded",
      "date": "2026-03-20",
      "decision-makers": "[Otto]",
      "feature": "TS-9"
     }
    },
    {
     "path": "library/decisions/0003-push-reminders-email-fallback.md",
     "section": "decisions",
     "blob": "5f0407dda15d60a35f5869f1567a021946a5739b",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": "Reminders go by push, with email as the fallback",
     "head": {
      "status": "accepted",
      "date": "2026-06-11",
      "decision-makers": "[Otto, Wren, Ines]",
      "supersedes": "[0002]",
      "feature": "TS-15"
     }
    },
    {
     "path": "library/glossary.md",
     "section": "glossary",
     "blob": "ff0ec024f25951de989875b063baba8a4bb72f97",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": "Glossary",
     "head": null
    },
    {
     "path": "library/overview.md",
     "section": "overview",
     "blob": "1e7e9e04e8d0e492f03ba83c38593813db85bd47",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": "Toolshed",
     "head": {
      "title": "Toolshed",
      "tagline": "A neighbourhood tool library: borrow the drill, don't buy it",
      "product-owner": "Wren",
      "architect": "Otto",
      "designer": "Ines"
     }
    },
    {
     "path": "library/usecases/0001-reserve-a-tool.md",
     "section": "usecases",
     "blob": "6d3f1b843a48367350dd505ee11afe81022ed179",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": "Reserve a tool",
     "head": {
      "status": "built",
      "actor": "Member",
      "date": "2026-03-02",
      "feature": "TS-4"
     }
    },
    {
     "path": "library/usecases/0002-borrow-and-return-a-tool.md",
     "section": "usecases",
     "blob": "328014a96a212e6cfd5074f7c8f79b6df1806713",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": "Borrow and return a tool",
     "head": {
      "status": "built",
      "actor": "Steward",
      "date": "2026-03-20",
      "feature": "TS-6"
     }
    },
    {
     "path": "library/usecases/0003-report-damage.md",
     "section": "usecases",
     "blob": "fc09bf36a694b1d2eafbe5ce7e7ba5711743f0c2",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": "Report damage",
     "head": {
      "status": "agreed",
      "actor": "Member",
      "date": "2026-07-08",
      "feature": "TS-18"
     }
    },
    {
     "path": "library/ux/0001-catalogue-and-reserving.md",
     "section": "ux",
     "blob": "23810e5fd5bf5b115e774b954ad05eee3fe35622",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": "Catalogue and reserving",
     "head": {
      "status": "approved",
      "date": "2026-03-10",
      "feature": "TS-4",
      "use-cases": "[0001]",
      "prototype": "https://example.org/toolshed/prototypes/catalogue",
      "verdict": "Yes, this is it. Make the free days bigger.",
      "verdict-date": "2026-03-09"
     }
    },
    {
     "path": "library/ux/0002-counter-screen.md",
     "section": "ux",
     "blob": "7d7d539d4dcfd35997d418ad6e4332a43c08ae78",
     "changed": {
      "sha": "1c83f2b",
      "date": "2026-11-26T21:34:27-06:00"
     },
     "title": "The steward's counter screen",
     "head": {
      "status": "in review",
      "date": "2026-07-02",
      "feature": "TS-6",
      "use-cases": "[0002, 0003]",
      "prototype": "https://example.org/toolshed/prototypes/counter"
     }
    }
   ]
  },
  "texts": {
   "library/architecture/model.c4": "// Toolshed's architecture: who uses it, what it is made of, and where it runs.\n\nmodel {\n  member = person 'Member' {\n    description 'Borrows tools: browses the catalogue, reserves, collects and returns them'\n  }\n  steward = person 'Steward' {\n    description 'A volunteer at a shed: checks tools out and in, writes damage reports'\n  }\n\n  pushService = external 'Web Push' {\n    technology 'The browsers\\' push services'\n    description 'Delivers reminders to a member\\'s phone or desktop'\n  }\n  email = external 'Email provider' {\n    technology 'Transactional email over SMTP'\n    description 'Sends reminders to a member who has push turned off'\n  }\n\n  toolshed = system 'Toolshed' {\n    description 'A neighbourhood tool library: members borrow tools from the sheds near them'\n\n    app = container 'Web app' {\n      technology 'TypeScript, React, installable PWA'\n      description 'The catalogue, reservations and the steward\\'s counter screen, on a phone or a shed tablet'\n      style {\n        shape browser\n      }\n    }\n\n    api = container 'API' {\n      technology 'Node.js, Fastify'\n      description 'Every read and write; the only container that touches the database'\n\n      catalogue = component 'Catalogue' {\n        description 'Sheds, categories, tools and their photos'\n      }\n      reservations = component 'Reservations' {\n        description 'Holds a tool for a member until 24 h after the pickup day (ADR 0001)'\n      }\n      loans = component 'Loans' {\n        description 'Check-out and check-in at the counter; due dates; blocks a member with an overdue loan'\n      }\n      members = component 'Members' {\n        description 'Sign-up by email link, stewards, home shed'\n      }\n      reports = component 'Damage reports' {\n        description 'Takes a report and sets the tool to repair when it needs it'\n      }\n    }\n\n    worker = container 'Reminder worker' {\n      technology 'Node.js, runs every 15 minutes'\n      description 'Finds loans due soon or overdue and holds about to lapse, and sends one reminder each'\n\n      scheduler = component 'Scheduler' {\n        description 'Picks what is due and queues a notification row for it'\n      }\n      sender = component 'Sender' {\n        description 'Sends each queued notification by push, else by email (ADR 0003)'\n      }\n    }\n\n    db = store 'Database' {\n      technology 'PostgreSQL 16'\n      description 'Members, sheds, tools, reservations, loans, reports and notifications (the data model)'\n    }\n\n    photos = store 'Photo bucket' {\n      technology 'S3-compatible object storage'\n      description 'Tool photos; the database holds their keys'\n    }\n\n    sms = container 'SMS reminders' {\n      #planned\n      description 'For members without a smartphone. Not built'\n    }\n  }\n\n  member -> toolshed.app 'browses, reserves'\n  steward -> toolshed.app 'checks tools out and in'\n  toolshed.app -> toolshed.api 'calls' {\n    technology 'JSON over HTTPS'\n  }\n  toolshed.app -> toolshed.photos 'loads photos' {\n    technology 'signed URLs'\n  }\n\n  toolshed.api.catalogue -> toolshed.db 'reads and writes tools'\n  toolshed.api.catalogue -> toolshed.photos 'stores photos, signs URLs'\n  toolshed.api.reservations -> toolshed.api.catalogue 'checks the tool is lendable'\n  toolshed.api.reservations -> toolshed.db 'reads and writes reservations'\n  toolshed.api.loans -> toolshed.api.reservations 'fulfils a reservation'\n  toolshed.api.loans -> toolshed.api.members 'blocks or unblocks a member'\n  toolshed.api.loans -> toolshed.db 'reads and writes loans'\n  toolshed.api.members -> toolshed.db 'reads and writes members'\n  toolshed.api.reports -> toolshed.api.catalogue 'sets a tool to repair'\n  toolshed.api.reports -> toolshed.db 'writes reports'\n\n  toolshed.worker.scheduler -> toolshed.db 'reads due loans and lapsing holds, queues notifications'\n  toolshed.worker.sender -> toolshed.db 'reads the queue, marks sent'\n  toolshed.worker.sender -> pushService 'sends a reminder'\n  toolshed.worker.sender -> email 'sends a reminder when push is off'\n  pushService -> member 'shows the reminder'\n  email -> member 'delivers the reminder'\n}\n\ndeployment {\n  environment prod 'Production' {\n    node fly 'Fly.io, one region' {\n      instanceOf toolshed.api\n      instanceOf toolshed.worker\n    }\n    node pages 'Static hosting' {\n      instanceOf toolshed.app\n    }\n    node neon 'Managed Postgres' {\n      instanceOf toolshed.db\n    }\n    node bucket 'Object storage' {\n      instanceOf toolshed.photos\n    }\n  }\n}",
   "library/architecture/spec.c4": "// The BobNet library standard's C4 notation (ADR 0017, architecture/library-standard.md).\n// Copy this file as it is into library/architecture/; never edit it in a project.\n\nspecification {\n  // C4 level 1: who uses the system, and the systems around it.\n  element person {\n    style {\n      shape person\n      color green\n    }\n  }\n  element system\n  element external {\n    notation 'A system someone else runs'\n    style {\n      color gray\n    }\n  }\n\n  // C4 level 2: what runs or keeps data inside the system.\n  element container\n  element store {\n    notation 'A container that keeps data'\n    style {\n      shape storage\n      color amber\n    }\n  }\n\n  // C4 level 3: the parts of a container.\n  element component {\n    style {\n      color sky\n    }\n  }\n\n  // Where the containers run (arc42 §7).\n  deploymentNode environment\n  deploymentNode node\n\n  tag planned\n  tag deprecated\n}",
   "library/architecture/views.c4": "// Toolshed's views: the C4 levels, one dynamic view per use case that has a flow, and production.\n\nviews {\n  view index {\n    title 'Context'\n    description 'Toolshed, the people who use it, and the services it sends reminders through'\n    include member, steward, toolshed, pushService, email\n  }\n\n  view containers of toolshed {\n    title 'Containers'\n    include *, member, steward, pushService, email\n  }\n\n  view apiComponents of toolshed.api {\n    title 'API'\n    include *, toolshed.app, toolshed.db, toolshed.photos\n  }\n\n  view workerComponents of toolshed.worker {\n    title 'Reminder worker'\n    include *, toolshed.db, pushService, email\n  }\n\n  dynamic view uc0001 {\n    title 'Reserve a tool'\n    description 'Use case 0001'\n    member -> toolshed.app 'picks a tool and a pickup day'\n    toolshed.app -> toolshed.api.reservations 'reserves'\n    toolshed.api.reservations -> toolshed.api.catalogue 'is the tool lendable that day?'\n    toolshed.api.reservations -> toolshed.db 'writes the reservation, hold until pickup + 24 h'\n    toolshed.app -> member 'shows the hold and the shed\\'s hours'\n  }\n\n  dynamic view uc0002 {\n    title 'Borrow and return a tool'\n    description 'Use case 0002'\n    steward -> toolshed.app 'scans the tool at the counter'\n    toolshed.app -> toolshed.api.loans 'checks out'\n    toolshed.api.loans -> toolshed.api.reservations 'fulfils the member\\'s reservation'\n    toolshed.api.loans -> toolshed.db 'writes the loan with its due date'\n    toolshed.worker.scheduler -> toolshed.db 'finds it due tomorrow, queues a reminder'\n    toolshed.worker.sender -> pushService 'sends \"due tomorrow\"'\n    steward -> toolshed.app 'checks the tool back in'\n    toolshed.app -> toolshed.api.loans 'returns'\n  }\n\n  deployment view prod {\n    title 'Production'\n    include prod.**\n  }\n}",
   "library/data-model.dbml": "// Toolshed's data model. The BobNet library standard (ADR 0017): one DBML file, every table\n// with a Note, every relation written as a ref, a DiagramView per diagram.\n\nProject toolshed {\n  database_type: 'PostgreSQL'\n  Note: 'What Toolshed keeps: who the members are, which tools each shed holds, and who has which tool when.'\n}\n\nEnum loan_state {\n  out [note: 'The member has the tool']\n  returned [note: 'Back on the shelf, checked by a steward']\n  overdue [note: 'Past its due date and not returned']\n  lost [note: 'Written off by a steward']\n}\n\nEnum tool_condition {\n  good\n  worn [note: 'Works, shows its age']\n  repair [note: 'Out of the catalogue until it is fixed']\n  retired\n}\n\nTable member {\n  id uuid [pk]\n  email text [not null, unique, note: 'Where reminders go when push is off']\n  name text [not null]\n  phone text [note: 'Optional; stewards call it for an overdue loan']\n  home_shed_id uuid [not null, ref: > shed.id, note: 'The shed the member joined at']\n  is_steward boolean [not null, default: false, note: 'A steward may check tools out and in']\n  joined_at timestamptz [not null, default: `now()`]\n  Note: 'A person who may borrow tools. Joining is free; a member is blocked while they have an overdue loan.'\n}\n\nTable shed {\n  id uuid [pk]\n  name text [not null, unique]\n  address text [not null]\n  opening_hours text [not null, note: 'Free text, shown as written, e.g. \"Sat 10-13\"']\n  Note: 'A place where tools are kept and handed over. A tool lives in one shed.'\n}\n\nTable category {\n  id uuid [pk]\n  name text [not null, unique]\n  parent_id uuid [ref: > category.id, note: 'Null for a top-level category']\n  Note: 'How the catalogue is browsed, e.g. Garden > Hedge trimmers. Two levels at most.'\n}\n\nTable tool {\n  id uuid [pk]\n  shed_id uuid [not null, ref: > shed.id]\n  category_id uuid [not null, ref: > category.id]\n  name text [not null, note: 'As a member would say it, e.g. \"Cordless drill, 18 V\"']\n  condition tool_condition [not null, default: 'good']\n  loan_days int [not null, default: 7, note: 'How long one loan may last']\n  added_at timestamptz [not null, default: `now()`]\n  Note: 'One physical tool on a shelf. Two identical drills are two tools.'\n}\n\nTable photo {\n  id uuid [pk]\n  tool_id uuid [not null, ref: > tool.id]\n  object_key text [not null, unique, note: 'Its key in the photo bucket']\n  position int [not null, default: 0, note: 'Order in the gallery; 0 is the cover']\n  Note: 'A picture of a tool. The bytes are in object storage; this row is the pointer.'\n}\n\nTable reservation {\n  id uuid [pk]\n  tool_id uuid [not null, ref: > tool.id]\n  member_id uuid [not null, ref: > member.id]\n  pickup_on date [not null, note: 'The day the member means to collect it']\n  hold_until timestamptz [not null, note: 'pickup_on plus 24 h (ADR 0001); after it the hold lapses']\n  created_at timestamptz [not null, default: `now()`]\n  Note: 'A member asking to pick a tool up on a given day. It holds the tool until hold_until.'\n\n  indexes {\n    (tool_id, pickup_on) [unique, note: 'One reservation per tool per day']\n  }\n}\n\nTable loan {\n  id uuid [pk]\n  tool_id uuid [not null, ref: > tool.id]\n  member_id uuid [not null, ref: > member.id]\n  reservation_id uuid [unique, ref: - reservation.id, note: 'The reservation it fulfilled; null for a walk-in']\n  checked_out_by uuid [not null, ref: > member.id, note: 'The steward at the counter']\n  out_at timestamptz [not null]\n  due_at timestamptz [not null, note: 'out_at plus the tool\\'s loan_days']\n  returned_at timestamptz\n  state loan_state [not null, default: 'out']\n  Note: 'A tool in a member\\'s hands, from check-out at the counter to its return.'\n}\n\nTable damage_report {\n  id uuid [pk]\n  loan_id uuid [not null, ref: > loan.id]\n  reported_by uuid [not null, ref: > member.id]\n  description text [not null]\n  needs_repair boolean [not null, default: false, note: 'True sets the tool\\'s condition to repair']\n  reported_at timestamptz [not null, default: `now()`]\n  Note: 'Something wrong with a tool, found during or after a loan. Reports never block a member.'\n}\n\nTable notification {\n  id uuid [pk]\n  member_id uuid [not null, ref: > member.id]\n  loan_id uuid [ref: > loan.id]\n  kind text [not null, note: 'due_soon, overdue, hold_lapsing']\n  channel text [not null, note: 'push or email (ADR 0003)']\n  sent_at timestamptz\n  Note: 'One reminder to a member, queued by the worker and sent once.'\n}\n\n// The diagrams. \"All tables\" is always drawn first; each DiagramView adds one, in this order.\n\nDiagramView catalogue {\n  Tables {\n    shed\n    category\n    tool\n    photo\n  }\n}\n\nDiagramView lending {\n  Tables {\n    member\n    tool\n    reservation\n    loan\n    damage_report\n    notification\n  }\n}",
   "library/decisions/0001-reservations-hold-for-24-hours.md": "---\nstatus: accepted\ndate: 2026-03-02\ndecision-makers: [Otto, Wren]\nfeature: TS-4\n---\n# Reservations hold a tool until 24 hours after the pickup day\n\n## Context\n\nMembers reserve a tool for a pickup day, but sheds open only a few hours a week, and people miss their slot. A\nreservation that holds forever blocks the tool; one that lapses at closing time punishes a member who comes the next\nmorning.\n\n## Options\n\n1. Hold until the shed closes on the pickup day.\n2. Hold until 24 hours after the pickup day.\n3. Hold until a steward releases it by hand.\n\n## Decision\n\nOption 2. `reservation.hold_until` is the pickup day plus 24 hours, written when the reservation is made. The\nreminder worker tells the member when a hold is about to lapse.\n\n## Consequences\n\n- A tool can be blocked for up to two days by a member who never comes. The lapse reminder keeps that rare.\n- Stewards never release holds by hand.\n- Only one reservation per tool per day (a unique index on `tool_id, pickup_on`).",
   "library/decisions/0002-email-reminders.md": "---\nstatus: superseded\ndate: 2026-03-20\ndecision-makers: [Otto]\nfeature: TS-9\n---\n# Reminders go by email\n\n## Context\n\nMembers forget due dates. Toolshed needs to remind them a day before a loan is due, and when it is overdue.\n\n## Options\n\n1. Email.\n2. SMS.\n3. Push notifications to the web app.\n\n## Decision\n\nOption 1: email through a transactional provider. Every member has an address, since sign-up is by email link.\n\n## Consequences\n\n- Cheap, and it needs nothing on the member's phone.\n- Reminders land among other mail and are often missed.",
   "library/decisions/0003-push-reminders-email-fallback.md": "---\nstatus: accepted\ndate: 2026-06-11\ndecision-makers: [Otto, Wren, Ines]\nsupersedes: [0002]\nfeature: TS-15\n---\n# Reminders go by push, with email as the fallback\n\n## Context\n\nADR 0002 sent every reminder by email. In three months a third of loans still came back late, and members said they\nmissed the emails. The web app is now an installable PWA, and browsers on phones support Web Push.\n\n## Options\n\n1. Keep email only.\n2. Push only.\n3. Push, and email for a member who hasn't turned push on or whose push fails.\n\n## Decision\n\nOption 3. The reminder worker's sender tries push first, then email. `notification.channel` records which one went.\n\n## Consequences\n\n- Members who install the app get reminders where they look.\n- Two channels to keep working, and a push subscription per device to store.\n- Late returns are measured again in three months.",
   "library/glossary.md": "# Glossary\n\n## Check-in\n\nAlso: return\n\nA steward taking a tool back at the counter. It ends the loan, and the tool is lendable again.\n\n## Check-out\n\nA steward handing a tool to a member at the counter. It starts a loan.\n\n## Damage report\n\nA note that something is wrong with a tool, written by the member or a steward. If the tool needs repair, it leaves\nthe catalogue until it is fixed.\n\n## Hold\n\nThe time a reservation keeps a tool for its member: until 24 hours after the pickup day. After that it lapses and\nthe tool is free again.\n\n## Loan\n\nA tool in a member's hands, from check-out to check-in. It has a due date.\n\n## Member\n\nSomeone signed up to borrow tools. Joining is free. A member with an overdue loan can't borrow another tool.\n\n## Reservation\n\nA member asking for a tool on a given pickup day. It puts the tool on hold.\n\n## Shed\n\nA place where tools are kept and handed over, with opening hours. Every tool lives in one shed.\n\n## Steward\n\nAlso: volunteer\n\nA member who runs a shed's counter: checks tools out and in, and writes damage reports.\n\n## Tool\n\nOne physical thing on a shelf. Two identical drills are two tools.",
   "library/overview.md": "---\ntitle: Toolshed\ntagline: A neighbourhood tool library: borrow the drill, don't buy it\nproduct-owner: Wren\narchitect: Otto\ndesigner: Ines\n---\n# Toolshed\n\n## Goals\n\n- A member finds a tool in a shed near them, reserves it for a day, and collects it without a phone call.\n- Stewards check tools out and in at the counter in under a minute each.\n- Fewer tools come back late: a reminder goes out before a loan is due, and again when it is overdue.\n\n## Stakeholders\n\n| Who | What they want from Toolshed |\n|---|---|\n| Members | To know what is on the shelf before they walk over, and to hold it |\n| Stewards | A quick counter, and to know who has what |\n| The association's board | Tools that come back, and a count of loans for its grant reports |\n\n## Scope\n\n### In\n\n- The catalogue of every shed, with photos.\n- Reservations, loans, returns, and damage reports.\n- Reminders by push, else by email.\n\n### Out\n\n- Payments and deposits: borrowing is free.\n- Delivery: members collect at the shed.\n- SMS reminders: planned, not built (the architecture marks them `#planned`).\n\n## Constraints\n\n- Volunteers run it: one small server, a managed database, no on-call.\n- It runs in a browser on a phone and on the shed's tablet. There is no app-store app.\n- Members' data stays in the EU.\n\n## Quality goals\n\n| Quality | What it means here |\n|---|---|\n| Fast at the counter | A check-out takes one scan and one tap, at most 2 s on the shed's Wi-Fi |\n| Usable on a phone | Every member's screen works at 360 px wide, one-handed |\n| Nothing lost | A loan written at the counter is never lost, even if the tablet goes offline right after |",
   "library/usecases/0001-reserve-a-tool.md": "---\nstatus: built\nactor: Member\ndate: 2026-03-02\nfeature: TS-4\n---\n# Reserve a tool\n\n## Goal\n\nA member holds a tool for the day they will collect it, so it is on the shelf when they arrive.\n\n## Preconditions\n\n- The member is signed in and has no overdue loan.\n\n## Main scenario\n\n1. The member finds a tool in the catalogue, by category or by search.\n2. Toolshed shows the tool, its shed, the shed's opening hours, and the days it is free.\n3. The member picks a pickup day.\n4. Toolshed puts the tool on hold until 24 hours after that day (ADR 0001), and shows the hold.\n\n## Extensions\n\n- 2a. The tool is out on loan: Toolshed shows its due date, and the first free day.\n- 3a. Another member reserved the same day a moment earlier: Toolshed says so, and offers the next free day.\n- 4a. The hold is about to lapse: the reminder worker tells the member.\n\n## Acceptance\n\n- Given a lendable tool and a free day, when the member reserves it, then the tool shows as held for them until the\n  next day's end.\n- Given a member with an overdue loan, when they open a tool, then they can't reserve it and are told why.",
   "library/usecases/0002-borrow-and-return-a-tool.md": "---\nstatus: built\nactor: Steward\ndate: 2026-03-20\nfeature: TS-6\n---\n# Borrow and return a tool\n\n## Goal\n\nA steward hands a tool to a member and takes it back, each in under a minute, and Toolshed always knows who has it.\n\n## Preconditions\n\n- The steward is signed in on the shed's tablet.\n- The tool has a label with its code.\n\n## Main scenario\n\n1. The member arrives at the counter and gives their name.\n2. The steward scans the tool's label.\n3. Toolshed shows the member's reservation for it, if there is one, and the due date.\n4. The steward taps Check out. Toolshed writes the loan.\n5. The day before the due date, the member gets a reminder (ADR 0003).\n6. The member brings the tool back; the steward scans it and taps Check in. The loan ends.\n\n## Extensions\n\n- 3a. No reservation, and the tool is free: the steward checks it out as a walk-in.\n- 3b. The member has an overdue loan: Toolshed blocks the check-out and shows that loan.\n- 6a. The tool is damaged: the steward writes a damage report (use case 0003) before checking it in.\n- 6b. The tablet is offline: the check-in is queued on the tablet and sent when it is back.\n\n## Acceptance\n\n- Given a reserved tool, when the steward scans it and checks it out, then the reservation is fulfilled and a loan\n  with the tool's loan days is open.\n- Given an open loan, when the steward checks the tool in, then the loan is returned and the tool is lendable.",
   "library/usecases/0003-report-damage.md": "---\nstatus: agreed\nactor: Member\ndate: 2026-07-08\nfeature: TS-18\n---\n# Report damage\n\n## Goal\n\nSomeone who finds a tool broken says so, and the next member doesn't get a broken tool.\n\n## Preconditions\n\n- The person reporting is a member, and the tool was lent to them or is at their shed.\n\n## Main scenario\n\n1. The member opens the tool, from their loans or by scanning its label.\n2. They write what is wrong, and say whether it still works.\n3. Toolshed records the damage report against the loan.\n4. If it doesn't work, Toolshed sets the tool to repair, which takes it out of the catalogue and tells the shed's\n   stewards.\n\n## Extensions\n\n- 2a. A steward reports it at check-in instead (use case 0002, 6a).\n- 4a. The tool has reservations: their members are told, and offered the same kind of tool at their shed.\n\n## Acceptance\n\n- Given a tool reported as not working, when anyone opens the catalogue, then the tool isn't offered.\n- Given a damage report, when the member who wrote it borrows again, then nothing blocks them.",
   "library/ux/0001-catalogue-and-reserving.md": "---\nstatus: approved\ndate: 2026-03-10\nfeature: TS-4\nuse-cases: [0001]\nprototype: https://example.org/toolshed/prototypes/catalogue\nverdict: \"Yes, this is it. Make the free days bigger.\"\nverdict-date: 2026-03-09\n---\n# Catalogue and reserving\n\n## Purpose\n\nA member on a phone finds a tool near them and holds it for a day, in three taps from the catalogue.\n\n## Screens\n\n### Catalogue\n\nCategories as large tiles, then a list of tools with their cover photo, shed and \"free today\" or the next free day.\nSearch is at the top.\n\n### A tool\n\nIts photos, its shed with today's hours, and a week strip of free days. Tapping a free day reserves it.\n\n### The hold\n\nThe tool, the pickup day, the shed's hours on that day, and \"held until\" the next day's end.\n\n## States\n\n- Loading: grey tiles, no spinner.\n- No tools in a category: \"Nothing here yet\", with the other sheds' count.\n- Blocked by an overdue loan: the week strip is replaced by that loan and its due date.\n\n## Open questions\n\n- None.",
   "library/ux/0002-counter-screen.md": "---\nstatus: in review\ndate: 2026-07-02\nfeature: TS-6\nuse-cases: [0002, 0003]\nprototype: https://example.org/toolshed/prototypes/counter\n---\n# The steward's counter screen\n\n## Purpose\n\nOn the shed's tablet, a steward checks a tool out or in with one scan and one tap, with a queue of members waiting.\n\n## Screens\n\n### Scan\n\nThe camera fills the screen. Under it, today's reservations for this shed, so a steward can tap one if a label won't\nscan.\n\n### Check out\n\nThe member, the tool, the due date, and one large Check out button. A block (an overdue loan) replaces the button\nwith that loan.\n\n### Check in\n\nThe tool, who had it, and two buttons: Check in, and Report damage.\n\n## States\n\n- Offline: a band says \"Offline: 2 check-ins waiting to send\". Check-out is still allowed.\n- A label that isn't a Toolshed code: \"Not one of ours\", and the scan stays open.\n\n## Open questions\n\n- Should a steward see a member's past loans here, or only the current one?"
  }
 }
};
