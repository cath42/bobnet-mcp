---
status: built
actor: Steward
date: 2026-03-20
feature: TS-6
---
# Borrow and return a tool

## Goal

A steward hands a tool to a member and takes it back, each in under a minute, and Toolshed always knows who has it.

## Preconditions

- The steward is signed in on the shed's tablet.
- The tool has a label with its code.

## Main scenario

1. The member arrives at the counter and gives their name.
2. The steward scans the tool's label.
3. Toolshed shows the member's reservation for it, if there is one, and the due date.
4. The steward taps Check out. Toolshed writes the loan.
5. The day before the due date, the member gets a reminder (ADR 0003).
6. The member brings the tool back; the steward scans it and taps Check in. The loan ends.

## Extensions

- 3a. No reservation, and the tool is free: the steward checks it out as a walk-in.
- 3b. The member has an overdue loan: Toolshed blocks the check-out and shows that loan.
- 6a. The tool is damaged: the steward writes a damage report (use case 0003) before checking it in.
- 6b. The tablet is offline: the check-in is queued on the tablet and sent when it is back.

## Acceptance

- Given a reserved tool, when the steward scans it and checks it out, then the reservation is fulfilled and a loan
  with the tool's loan days is open.
- Given an open loan, when the steward checks the tool in, then the loan is returned and the tool is lendable.
