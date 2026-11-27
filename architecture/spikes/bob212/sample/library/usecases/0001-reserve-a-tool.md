---
status: built
actor: Member
date: 2026-03-02
feature: TS-4
---
# Reserve a tool

## Goal

A member holds a tool for the day they will collect it, so it is on the shelf when they arrive.

## Preconditions

- The member is signed in and has no overdue loan.

## Main scenario

1. The member finds a tool in the catalogue, by category or by search.
2. Toolshed shows the tool, its shed, the shed's opening hours, and the days it is free.
3. The member picks a pickup day.
4. Toolshed puts the tool on hold until 24 hours after that day (ADR 0001), and shows the hold.

## Extensions

- 2a. The tool is out on loan: Toolshed shows its due date, and the first free day.
- 3a. Another member reserved the same day a moment earlier: Toolshed says so, and offers the next free day.
- 4a. The hold is about to lapse: the reminder worker tells the member.

## Acceptance

- Given a lendable tool and a free day, when the member reserves it, then the tool shows as held for them until the
  next day's end.
- Given a member with an overdue loan, when they open a tool, then they can't reserve it and are told why.
