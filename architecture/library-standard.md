# The BobNet library standard: an author's guide

Every project's library is written the same way, in the same place, in every repo. BobNet reads it from the
repo's main and shows it on the project's page. The decision and its reasons are ADR 0017
(`architecture/decisions/0017-library-standard.md`). This guide is what an author needs: where each file goes,
its rules, and a template to copy.

A complete example is Toolshed, a fictional project: `architecture/spikes/bob212/sample/library/`. To check a
library against these rules, run `node architecture/spikes/bob212/check-library.mjs <repo>`.

## Where everything goes

```
library/
  overview.md                     product owner   goals, stakeholders, scope, constraints, quality goals
  architecture/                   architect       the C4 model, in LikeC4
    spec.c4                                       the standard's notation: copy it, never edit it
    model.c4                                      the elements and relations, and the deployment
    views.c4                                      the views, with their fixed ids
  data-model.dbml                 architect       the data model, in DBML, with its diagrams
  decisions/NNNN-slug.md          architect       one ADR each
  usecases/NNNN-slug.md           product owner   one use case each
  ux/NNNN-slug.md                 designer        one UX card per feature
  ux/images/                                      pictures for the UX cards
  glossary.md                     product owner   the terms, in users' words
```

- **Nothing else is read.** BobNet reads nothing outside `library/`. Inside it, a file that isn't in this tree
  isn't shown, and is listed as a problem.
- **A section you haven't written** shows as "not written yet", with who writes it. That is fine: write it when
  you have it.
- **Cards** (decisions, use cases, UX cards) are named `NNNN-slug.md`:
  - four digits from `0001`, the next free number, never reused;
  - a slug of lowercase words and hyphens.

  The card's title is its first `# ` line.
- **Links** between library files are relative Markdown links, such as `[ADR 0001](../decisions/0001-x.md)`. They
  stay in BobNet. A link to any other file in the repo opens it on GitHub.
- **Small diagrams** (a sequence, a flow) may go in any Markdown file as a fenced `mermaid` block. Architecture and
  the data model are never Mermaid.

## Front matter

The overview and every card start with front matter: `key: value` lines between two `---` lines.

```
---
status: accepted
date: 2026-03-02
supersedes: [0002]
verdict: "Yes, this is it."
---
```

- **A value is one of:**
  - plain text to the line's end;
  - a `"quoted string"`, when the value has a `:` or a `#`, or is someone's words;
  - a list, `[a, b]`.
- **Not allowed:** nesting, and a value over two lines.
- **Dates** are `YYYY-MM-DD`. **Card numbers** in a list are four digits.
- **A key the standard doesn't list is a problem.** So is a required key that is missing, or a value outside its
  list.

## Overview: `library/overview.md`

| Key | | Value |
|---|---|---|
| `title` | required | the project's name |
| `tagline` | optional | one line under the title |
| `product-owner`, `architect`, `designer` | optional | the person in each role; their sections show the name |

The headings are fixed, in this order: Goals, Stakeholders, Scope, Constraints, Quality goals.

```markdown
---
title: <Project>
tagline: <one line: what it is, for whom>
product-owner: <name>
architect: <name>
designer: <name>
---
# <Project>

## Goals

- <What a user can do, or what gets better, that wasn't true before. Three to five.>

## Stakeholders

| Who | What they want from <Project> |
|---|---|
| <role> | <in their words> |

## Scope

### In

- <What it does.>

### Out

- <What it deliberately doesn't do, and where that lives instead.>

## Constraints

- <What the team can't choose: money, people, platforms, laws.>

## Quality goals

| Quality | What it means here |
|---|---|
| <e.g. fast at the counter> | <a measurable scenario> |
```

## Architecture: `library/architecture/*.c4`

Write it in [LikeC4](https://likec4.dev/), with C4's levels as its views.

- **`spec.c4`** is the standard's. Copy it from the sample (`sample/library/architecture/spec.c4`) unchanged.
  - Its element kinds are `person`, `system`, `external`, `container`, `store` and `component`.
  - Its deployment nodes are `environment` and `node`, and its tags are `#planned` and `#deprecated`.
  - Add no kinds of your own. An element may set its own `style { shape browser }` (or `mobile`).
- **The model and the views** go in other `.c4` files in the same folder, with no subfolders, and at most 64 files.
  Every element has a `description`, and a container also has its `technology`.
- **The view ids are fixed:**

  | View id | What it shows |
  |---|---|
  | `index` | The context, C4 level 1: the system, its users, and the systems around it |
  | `containers` | Level 2: the system's containers, with the people and systems they talk to |
  | `<container>Components` | Level 3: one per container that has components, e.g. `apiComponents` |
  | `uc<NNNN>` | A dynamic view: use case NNNN's flow, e.g. `uc0001`. The use case links to it |
  | any id | A `deployment view`: where the containers run |

  Level 4, code, isn't drawn.
- **Check it** with `npx likec4 validate library/architecture`.

```
// model.c4
model {
  user = person '<Role>' {
    description '<What they do with the system>'
  }
  other = external '<Service>' {
    description '<What the system uses it for>'
  }
  sys = system '<Project>' {
    description '<One line>'

    web = container '<Name>' {
      technology '<Language, framework>'
      description '<What it does>'
    }
    api = container '<Name>' {
      technology '<…>'
      description '<…>'

      orders = component '<Name>' {
        description '<What it is responsible for>'
      }
    }
    db = store 'Database' {
      technology '<Engine and version>'
      description '<What it keeps: the data model>'
    }
  }

  user -> sys.web '<does what>'
  sys.web -> sys.api '<calls>' {
    technology '<protocol>'
  }
  sys.api.orders -> sys.db '<reads and writes …>'
}

deployment {
  environment prod 'Production' {
    node host '<Where>' {
      instanceOf sys.api
    }
  }
}
```

```
// views.c4
views {
  view index {
    title 'Context'
    include user, sys, other
  }
  view containers of sys {
    title 'Containers'
    include *, user, other
  }
  view apiComponents of sys.api {
    title '<Container name>'
    include *, sys.db
  }
  dynamic view uc0001 {
    title '<Use case 0001's title>'
    user -> sys.web '<step>'
    sys.web -> sys.api.orders '<step>'
  }
  deployment view prod {
    title 'Production'
    include prod.**
  }
}
```

## Data model: `library/data-model.dbml`

Write it in [DBML](https://dbml.dbdiagram.io/docs/), in one file.

- **A `Project` block** with `database_type` and a `Note`: what the model keeps, in one sentence.
- **Every table has a `Note`**: what one row is, in users' words. Give a column a `note:` when its name doesn't
  say it all.
- **Write keys and nullability:** `[pk]`, `[not null]`, `[unique]`, `[default: …]`. A column without `not null` may
  be null.
- **Every relation is a ref:** inline, `[ref: > other.id]`, or as a `Ref:` line.
  - `>` is many-to-one.
  - `-` is one-to-one, with `[unique]` on the referring column.
  - Don't use `<>`. A many-to-many is its join table, written out.
- **`Enum`s** for fixed sets of values, with a `note:` per value where it helps.
- **The diagrams.** BobNet always draws "All tables" first. Each `DiagramView` adds a diagram, in file order. Make
  one per area a reader thinks in, of about 4-8 tables. A table may be in several.
- **Toggling attributes.** The reader toggles each diagram between tables only and tables with their attributes.
  Nothing in the file sets that.
- **Check it** with `npx -p @dbml/cli dbml2sql library/data-model.dbml`. It prints each error as `file(line,col)`,
  but still exits 0, so read its output. To start one from an existing Postgres schema, use
  `npx -p @dbml/cli sql2dbml schema.sql --postgres`, then add the notes.

```dbml
Project <project> {
  database_type: 'PostgreSQL'
  Note: '<What the model keeps, in one sentence.>'
}

Enum <thing>_state {
  open [note: '<what it means>']
  closed
}

Table <thing> {
  id uuid [pk]
  owner_id uuid [not null, ref: > <owner>.id]
  name text [not null, unique]
  state <thing>_state [not null, default: 'open']
  closed_at timestamptz [note: '<when, and who sets it>']
  Note: '<What one row is, in users\' words.>'
}

Table <owner> {
  id uuid [pk]
  Note: '<…>'
}

DiagramView <area> {
  Tables {
    <thing>
    <owner>
  }
}
```

## Decisions: `library/decisions/NNNN-slug.md`

One ADR per decision. Keep it short; cite the code.

| Key | | Value |
|---|---|---|
| `status` | required | `proposed`, `accepted`, `rejected`, `deprecated` or `superseded` |
| `date` | required | when the status last changed |
| `decision-makers` | optional | `[names]` |
| `supersedes` | optional | `[NNNN]`, the ADRs this one replaces. Set theirs to `superseded`; BobNet shows "superseded by" on them |
| `feature` | optional | the board item, e.g. `BOB-212` |

The headings are fixed: Context, Options, Decision, Consequences.

```markdown
---
status: proposed
date: YYYY-MM-DD
decision-makers: [<name>]
feature: <REF>
---
# <The decision, as a sentence>

## Context

<What forces the decision: the problem, the facts, what holds. Cite the code.>

## Options

1. <Option.>
2. <Option.>

## Decision

<The option chosen, and why, in a few lines.>

## Consequences

- <What becomes easier, what becomes harder, what to watch.>
```

## Use cases: `library/usecases/NNNN-slug.md`

One goal of one actor, with its scenario.

| Key | | Value |
|---|---|---|
| `status` | required | `draft`, `agreed`, `built` or `retired` |
| `actor` | required | the primary actor, a `person` in the architecture |
| `date` | required | when the status last changed |
| `feature` | optional | the board item |

The headings are fixed: Goal, Preconditions, Main scenario, Extensions, Acceptance. If the architecture has a
dynamic view `uc<NNNN>` with the same number, BobNet links the two.

```markdown
---
status: draft
actor: <Role>
date: YYYY-MM-DD
feature: <REF>
---
# <Verb phrase: what the actor gets done>

## Goal

<One sentence: what the actor wants, and why.>

## Preconditions

- <What is true before it starts.>

## Main scenario

1. <The actor does …>
2. <The system shows …>

## Extensions

- 2a. <When … : what happens instead.>

## Acceptance

- Given <state>, when <action>, then <outcome>.
```

## UX design: `library/ux/NNNN-slug.md`

One card per feature, as the designer and the owner agreed it.

| Key | | Value |
|---|---|---|
| `status` | required | `draft`, `in review`, `approved`, `changes asked` or `built` |
| `date` | required | when the status last changed |
| `feature` | optional | the board item |
| `use-cases` | optional | `[NNNN]`, the use cases it serves |
| `prototype` | optional | the prototype's URL |
| `verdict` | optional | the owner's words, verbatim and quoted |
| `verdict-date` | optional | when they said it |

- The headings are fixed: Purpose, Screens, States, Open questions.
- Pictures go in `library/ux/images/`, linked as `![Name](images/NNNN-name.png)`.

```markdown
---
status: draft
date: YYYY-MM-DD
feature: <REF>
use-cases: [NNNN]
prototype: <URL>
---
# <The feature, as the user sees it>

## Purpose

<Who uses it, on what device, to do what, in one or two sentences.>

## Screens

### <Screen>

<What is on it, and what each action does.>

## States

- <Loading, empty, error, blocked, offline: what each shows.>

## Open questions

- <Or "None.">
```

## Glossary: `library/glossary.md`

- **The layout:** `# Glossary`, then one `## Term` per entry, in alphabetical order.
- **Other words** for the same thing go on a first line, `Also: <other words>`.
- **The definition** is a short paragraph, in users' words. Say what the term is not when people mix it up.

```markdown
# Glossary

## <Term>

Also: <other word>

<What it is, in one to three sentences.>
```
