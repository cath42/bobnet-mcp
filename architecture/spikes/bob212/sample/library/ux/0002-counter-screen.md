---
status: in review
date: 2026-07-02
feature: TS-6
use-cases: [0002, 0003]
prototype: https://example.org/toolshed/prototypes/counter
---
# The steward's counter screen

## Purpose

On the shed's tablet, a steward checks a tool out or in with one scan and one tap, with a queue of members waiting.

## Screens

### Scan

The camera fills the screen. Under it, today's reservations for this shed, so a steward can tap one if a label won't
scan.

### Check out

The member, the tool, the due date, and one large Check out button. A block (an overdue loan) replaces the button
with that loan.

### Check in

The tool, who had it, and two buttons: Check in, and Report damage.

## States

- Offline: a band says "Offline: 2 check-ins waiting to send". Check-out is still allowed.
- A label that isn't a Toolshed code: "Not one of ours", and the scan stays open.

## Open questions

- Should a steward see a member's past loans here, or only the current one?
