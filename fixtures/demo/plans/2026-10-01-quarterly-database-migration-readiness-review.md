# Quarterly database migration readiness review

**Verdict:** ready for the Postgres 16 cutover in November, with two conditions.

## Summary

Three of the four services are ready. Billing still pins the `md5` auth method on two cron hosts.

## Verified

- Replica lag stayed under 2 s through the last three load tests.
- The rehearsal restore took 41 minutes from the base backup.

## Not verified

- Whether the analytics export can move off the cutover night.

## Next steps

1. Switch the two cron hosts to SCRAM (owner: Platform).
2. Rehearse the cutover once more after the `pg_partman` upgrade.

## Open questions

- Do we keep the 14 cluster for a week after, or snapshot it and drop it?
