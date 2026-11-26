---
title: Postgres 14 → 16 upgrade plan
created: 2026-10-08T09:14:00Z
---

# Postgres 14 → 16 upgrade plan

A step-by-step plan for upgrading the primary cluster from Postgres 14 to 16.

## TL;DR

- Upgrade a promoted replica with `pg_upgrade --link`, not the primary in place.
- Expected downtime is **under 4 minutes**, dominated by the final sync and the DNS flip.
- Two blockers: the `pg_partman` 4.x extension and three `regproc` columns in `legacy.audit_log`.

## Context

The primary (`db-prod-1`) runs Postgres 14.11 with 412 GB of data across 38 schemas. Postgres 14 leaves community support in November 2026,[^1] and 16 adds logical decoding on standbys, which the analytics team has asked for twice.

## Phases

### 1. Preparation

- [x] Inventory extensions with `scripts/pg/list_extensions.sql`.
- [x] Confirm every client driver supports SCRAM; two cron hosts still pin `md5`.
- [ ] Upgrade `pg_partman` to 5.1 on the primary, one schema at a time.
- [ ] Rewrite the three `regproc` columns as `text`, behind a view.

### 2. Rehearsal

Restore last night’s base backup to `db-rehearsal-1`, promote it, and run the upgrade there twice. Time each step. The second run is the number we quote.

```sh
pg_upgrade \
  --old-datadir /var/lib/postgresql/14/main \
  --new-datadir /var/lib/postgresql/16/main \
  --link --jobs 8 --check
```

### 3. Cutover

| Step | Owner | Expected | Rollback |
| --- | --- | --- | --- |
| Freeze writes at the pooler | Platform | 10 s | Unfreeze |
| Final sync to the replica | DBA | 90 s | Abandon, keep 14 |
| `pg_upgrade --link` | DBA | 60 s | Restore the snapshot |
| Flip `db-prod` DNS | Platform | 30 s | Flip back |

> The `--link` mode is fast because it hard-links data files instead of copying them. Once the new cluster has started, the old one can no longer be used safely.

### 4. Afterwards

Run `ANALYZE` across all 38 schemas before lifting the freeze on reporting jobs; plans built against stale statistics were the slowest part of the last upgrade.

## Risks

1. **Extension drift.** A schema created during the freeze inherits the old `pg_partman`.
2. **Long transactions.** One nightly export holds a snapshot for 40 minutes; move it off the night of the cutover.
3. **DNS caching.** Two services ignore the TTL and need a restart.

[^1]: The PostgreSQL versioning policy gives each major release five years of support.
