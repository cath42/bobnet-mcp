---
status: accepted
date: 2026-06-11
decision-makers: [Otto, Wren, Ines]
supersedes: [0002]
feature: TS-15
---
# Reminders go by push, with email as the fallback

## Context

ADR 0002 sent every reminder by email. In three months a third of loans still came back late, and members said they
missed the emails. The web app is now an installable PWA, and browsers on phones support Web Push.

## Options

1. Keep email only.
2. Push only.
3. Push, and email for a member who hasn't turned push on or whose push fails.

## Decision

Option 3. The reminder worker's sender tries push first, then email. `notification.channel` records which one went.

## Consequences

- Members who install the app get reminders where they look.
- Two channels to keep working, and a push subscription per device to store.
- Late returns are measured again in three months.
