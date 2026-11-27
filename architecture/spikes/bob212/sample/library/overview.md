---
title: Toolshed
tagline: A neighbourhood tool library: borrow the drill, don't buy it
product-owner: Wren
architect: Otto
designer: Ines
---
# Toolshed

## Goals

- A member finds a tool in a shed near them, reserves it for a day, and collects it without a phone call.
- Stewards check tools out and in at the counter in under a minute each.
- Fewer tools come back late: a reminder goes out before a loan is due, and again when it is overdue.

## Stakeholders

| Who | What they want from Toolshed |
|---|---|
| Members | To know what is on the shelf before they walk over, and to hold it |
| Stewards | A quick counter, and to know who has what |
| The association's board | Tools that come back, and a count of loans for its grant reports |

## Scope

### In

- The catalogue of every shed, with photos.
- Reservations, loans, returns, and damage reports.
- Reminders by push, else by email.

### Out

- Payments and deposits: borrowing is free.
- Delivery: members collect at the shed.
- SMS reminders: planned, not built (the architecture marks them `#planned`).

## Constraints

- Volunteers run it: one small server, a managed database, no on-call.
- It runs in a browser on a phone and on the shed's tablet. There is no app-store app.
- Members' data stays in the EU.

## Quality goals

| Quality | What it means here |
|---|---|
| Fast at the counter | A check-out takes one scan and one tap, at most 2 s on the shed's Wi-Fi |
| Usable on a phone | Every member's screen works at 360 px wide, one-handed |
| Nothing lost | A loan written at the counter is never lost, even if the tablet goes offline right after |
