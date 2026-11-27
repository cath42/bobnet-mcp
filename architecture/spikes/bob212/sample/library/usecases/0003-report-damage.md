---
status: agreed
actor: Member
date: 2026-07-08
feature: TS-18
---
# Report damage

## Goal

Someone who finds a tool broken says so, and the next member doesn't get a broken tool.

## Preconditions

- The person reporting is a member, and the tool was lent to them or is at their shed.

## Main scenario

1. The member opens the tool, from their loans or by scanning its label.
2. They write what is wrong, and say whether it still works.
3. Toolshed records the damage report against the loan.
4. If it doesn't work, Toolshed sets the tool to repair, which takes it out of the catalogue and tells the shed's
   stewards.

## Extensions

- 2a. A steward reports it at check-in instead (use case 0002, 6a).
- 4a. The tool has reservations: their members are told, and offered the same kind of tool at their shed.

## Acceptance

- Given a tool reported as not working, when anyone opens the catalogue, then the tool isn't offered.
- Given a damage report, when the member who wrote it borrows again, then nothing blocks them.
