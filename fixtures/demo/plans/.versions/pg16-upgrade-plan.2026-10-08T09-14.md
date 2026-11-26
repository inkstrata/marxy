---
title: Postgres 14 → 16 upgrade plan
created: 2026-10-08T09:14:00Z
---

# Postgres 14 → 16 upgrade plan

A step-by-step plan for upgrading the primary cluster from Postgres 14 to 16.

## TL;DR

- Upgrade the primary in place with `pg_upgrade --link`.
- Expected downtime is **about 10 minutes**.
- One blocker: the `pg_partman` 4.x extension.

## Context

The primary (`db-prod-1`) runs Postgres 14.11 with 412 GB of data across 38 schemas. Postgres 14 leaves community support in November 2026.

## Phases

### 1. Preparation

- [ ] Inventory extensions with `scripts/pg/list_extensions.sql`.
- [ ] Upgrade `pg_partman` to 5.1.

### 2. Cutover

Stop the application, run `pg_upgrade --link` on the primary, start it, and run `ANALYZE`.

## Risks

1. **Extension drift.** A schema created during the window inherits the old `pg_partman`.
