---
status: accepted
date: 2026-03-02
decision-makers: [Otto, Wren]
feature: TS-4
---
# Reservations hold a tool until 24 hours after the pickup day

## Context

Members reserve a tool for a pickup day, but sheds open only a few hours a week, and people miss their slot. A
reservation that holds forever blocks the tool; one that lapses at closing time punishes a member who comes the next
morning.

## Options

1. Hold until the shed closes on the pickup day.
2. Hold until 24 hours after the pickup day.
3. Hold until a steward releases it by hand.

## Decision

Option 2. `reservation.hold_until` is the pickup day plus 24 hours, written when the reservation is made. The
reminder worker tells the member when a hold is about to lapse.

## Consequences

- A tool can be blocked for up to two days by a member who never comes. The lapse reminder keeps that rare.
- Stewards never release holds by hand.
- Only one reservation per tool per day (a unique index on `tool_id, pickup_on`).
