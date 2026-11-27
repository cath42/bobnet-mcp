---
status: approved
date: 2026-03-10
feature: TS-4
use-cases: [0001]
prototype: https://example.org/toolshed/prototypes/catalogue
verdict: "Yes, this is it. Make the free days bigger."
verdict-date: 2026-03-09
---
# Catalogue and reserving

## Purpose

A member on a phone finds a tool near them and holds it for a day, in three taps from the catalogue.

## Screens

### Catalogue

Categories as large tiles, then a list of tools with their cover photo, shed and "free today" or the next free day.
Search is at the top.

### A tool

Its photos, its shed with today's hours, and a week strip of free days. Tapping a free day reserves it.

### The hold

The tool, the pickup day, the shed's hours on that day, and "held until" the next day's end.

## States

- Loading: grey tiles, no spinner.
- No tools in a category: "Nothing here yet", with the other sheds' count.
- Blocked by an overdue loan: the week strip is replaced by that loan and its due date.

## Open questions

- None.
