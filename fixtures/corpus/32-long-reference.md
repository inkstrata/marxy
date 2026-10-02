# Brindle Reference, version 4.2

*A configuration and API reference for the Brindle job scheduler. Brindle is an invented product; every name, address and value in this document was generated for a test fixture and refers to nothing real.*

## Contents

- [1. Introduction](#1-introduction)
- [2. Scheduler](#2-scheduler)
- [3. Queues](#3-queues)
- [4. Workers](#4-workers)
- [5. Retries and backoff](#5-retries-and-backoff)
- [6. Storage](#6-storage)
- [7. Locks and leases](#7-locks-and-leases)
- [8. Secrets](#8-secrets)
- [9. Metrics](#9-metrics)
- [10. Tracing](#10-tracing)
- [11. Logging](#11-logging)
- [12. Networking](#12-networking)
- [13. Transport security](#13-transport-security)
- [14. Authentication](#14-authentication)
- [15. Authorization](#15-authorization)
- [16. Quotas and limits](#16-quotas-and-limits)
- [17. Plugins](#17-plugins)
- [18. Migrations](#18-migrations)
- [19. Command line](#19-command-line)
- [20. Webhooks](#20-webhooks)
- [21. Changelog](#21-changelog)
- [22. Notes](#22-notes)

## 1. Introduction

### 1.1 Purpose

Brindle is a scheduler for work that has to happen eventually, preferably once, and never silently. It began as a collection of shell scripts on a single machine, grew into a daemon when the scripts started to disagree about what "once" meant, and acquired a configuration layer when the daemon was installed on a second machine and the two copies drifted apart. This reference describes version 4.2. It is written for the person who has to run Brindle at three in the morning, which is also the person most likely to be reading it on a small screen with a terminal open beside it, and so it prefers short sentences, exact names and examples that can be pasted without editing.

Most of the system is a matter of three nouns and the promises made about them. A job is a unit of work with an identity, a payload and a deadline. A queue is an ordered place where jobs wait, and the order is a promise: within a queue, jobs of equal priority are claimed in the order they were enqueued, unless a retry has put one of them back. A worker is whatever claims a job, runs it and reports the outcome. Everything else in this document, from the lease on a claim to the shape of a webhook, exists to keep those three promises true when the network is slow, the clock is wrong, and the disk is nearly full.

The design makes several choices that readers coming from other schedulers may not expect. First, Brindle prefers to run a job twice over losing it, and it says so loudly in the log whenever it does. A job that is claimed and then abandoned by a worker that vanished will be offered again after its lease expires, and the second worker will see the same identity and the same payload as the first. Handlers are therefore expected to be idempotent, and the chapter on retries explains how to make them so. Second, Brindle keeps its configuration in a single tree of named settings with typed values, and it refuses to start if a setting is unknown. A misspelt name is an error rather than a silent default, because the cost of a silent default is paid later, usually in the middle of the night.

Third, and most important for anyone planning a deployment, Brindle assumes that clocks lie. It does not use wall-clock time to order events, only to schedule them, and it measures every interval with a monotonic source that cannot move backwards. When the wall clock jumps, a scheduled job is neither skipped nor run twice; the scheduler notices the jump, logs it, and reschedules according to the policy in the scheduler chapter. This matters more than it sounds. In the first year of production use of an early version, the most common cause of duplicated work was not a crash, or a network partition, or a bug in a handler. It was a virtual machine that was suspended for a few minutes and resumed with a clock that had not yet caught up.

### 1.2 Audience

The settings are grouped by the part of the system they affect, and the names follow one rule: a dotted path whose first segment is the chapter's key, as in the examples throughout this reference. A setting named scheduler.default_window.timeout belongs to the scheduler, describes a window, and sets a timeout. Durations are written with a unit suffix, such as 250ms, 30s, 5m or 1h; a bare number is read in the unit named in the setting's description. Sizes are written in bytes unless a suffix says otherwise. Booleans are the words true and false and nothing else, since the alternatives that other tools accept (yes, on, 1) have, in Brindle's experience, caused more confusion than they have saved keystrokes.

Each chapter has the same shape. It opens with sections that describe a group of related settings, in prose first and then in a table. The table lists the option, its type, its default and what it does, and a reader who already knows the answer to the question of what the setting does can look only at the default. Sections that need one are followed by an example, in YAML for the configuration file, in JSON for the HTTP interface, and in the command line, Python or TypeScript where those are the natural way to reach the same setting. The examples have been run against a test cluster, but the values in them are illustrative; the defaults are the numbers that matter in production, and these are the numbers in the tables.

Cross-references are written with a section sign and a number, such as the discussion of leases in [§7.1](#71-verbose-ceiling), and every one of them is a link. If a link takes you to a place where the question is answered only by another link, that is a bug in this document, and it would be welcome as an issue. The same is true of any example that does not run, any default that differs from the one in the program, and any sentence whose meaning depends on the reader having already read the sentence after it. A reference is a promise, too, and the promise is that nothing in it requires you to guess.

Stability is described by three words. A stable setting will not change meaning, type or default inside a major version; if it must change, it is deprecated for at least two minor versions and the log says so each time the old name is used. An experimental setting may change in any release and is marked as such in its table row. An internal setting is not documented here at all, and any configuration file that names one will be rejected by the strict parser. The changelog at the end of this document lists every change to a stable setting, with the version in which it first appeared, so that an operator upgrading across several versions can read one page rather than twelve. Nothing in the changelog is retroactive: a line describes a release as it shipped, and a later correction appears as its own line in the later release instead of a quiet edit to the earlier one.

### 1.3 Conventions

Operators sometimes ask why Brindle has so many settings for a system whose purpose is simple. The honest answer is that the purpose is simple and the environments are not. A scheduler that runs on one laptop needs no tuning; the same scheduler spread across three regions, with a flaky link between two of them and a compliance rule about where the payloads may rest, needs a dozen decisions made explicitly. Brindle's position is that each of those decisions should be a named setting with a documented default, so that nothing important is decided by accident. The defaults are chosen for a cluster of three to five nodes in one region with ordinary disks and a reliable network, and they are conservative on purpose: slow and safe in preference to fast and surprising.

There is a short list of settings that nearly every deployment changes, and it is worth knowing before reading further. The location of the data directory is one. The address that other nodes use to reach this one is another, because the address a node believes it has is often not the address that is reachable from outside its container. The retention window for finished jobs is a third, since the default of seven days is a guess about how long people look at results. The remaining ones concern credentials and are covered in the chapters on secrets and authentication. A configuration that sets these and nothing else is a perfectly respectable configuration, and many of the best running installations are exactly that.

Upgrades follow a rule that has served the project well: the new version must be able to read the old version's data, and the old version need not be able to read the new one's. A rolling upgrade is therefore safe if the nodes are upgraded one at a time and the cluster is never downgraded while a mixed state exists. The migrations chapter gives the exact sequence and the checks to run between steps, and the changelog marks every release that changes a stored format with the word Changed and the name of the format. If the line is absent, nothing on disk changed, and the upgrade is a matter of replacing a binary and restarting it.

### 1.4 Stability promises

The interfaces fall into three groups. The configuration file is for things that are decided once, by the person who installs the system. The HTTP interface is for things that are decided continuously, by programs: enqueueing a job, inspecting a lease, draining a node. The command line is for things that are decided by a person at a terminal in a hurry, and it is deliberately a thin wrapper over the HTTP interface, so that anything the command line can do, a program can do, and the reverse. Where the two disagree, that is a bug, and the HTTP interface is the one that is correct.

A last convention concerns the examples. Hostnames in them end in .invalid, an address that is reserved so that it can never resolve, and tokens are read from the environment rather than written out; nothing in this document should be pasted into a shell without first being read. Where an example shows output, it is trimmed to the lines that matter, and a line that begins with an ellipsis stands for lines that were left out. Where an example shows a failure, the failure is real: it is the message that a recent version of the program printed for exactly that input, with the identifiers replaced.

Finally, a word about what Brindle does not do. It does not run your code for you; it hands a payload to a worker and waits for an outcome. It does not store your results beyond the retention window you configure. It does not try to be a workflow engine, a message bus or a database, and every time it has been asked to become one of those the answer has been to publish a hook and let somebody else do it better. The scope is deliberately narrow, and the narrowness is the reason that the rest of this document can be so specific.[^1]

## 2. Scheduler

Changing `scheduler.min` at run time takes effect after the next rotation; no restart is needed. Values are read as ratios; a bare number is taken in ms.

### 2.1 Bounded profile

This is independent of scheduler limits set elsewhere in the file. Related: [see §8.1](#81-regional-policy).

#### 2.1.1 `scheduler.compact_lease.jitter`

Changing `scheduler.compact_lease.jitter` at run time takes effect after the next sweep; no restart is needed. If the primary is unreachable, Brindle holds the work and records the event in the audit log. Related: [see §13.3.1](#1331-tlsdurable_handshakedepth).

#### 2.1.2 `scheduler.tiered_shard.jitter`

Values are read as ratios; a bare number is taken in s. If a node restarts, Brindle holds the work and records the event in the audit log.

#### Compatibility

If a deploy is in progress, Brindle holds the work and records the event in the audit log.

mode
:   The `scheduler.bounded_profile` setting controls how a node is compacted when the disk is more than 90 % full.

max
:   Operators who run 7 or more nodes should set `scheduler.bounded_profile` explicitly rather than rely on the default.

path
:   Operators who run 36 or more nodes should set `scheduler.bounded_profile` explicitly rather than rely on the default.

### 2.2 Regional cursor

If the queue is empty, Brindle falls back to the previous value and records the event in the audit log. The strict batch is evaluated once per sweep, never between ticks.

- **`jitter`** — If the disk is more than 90 % full, Brindle escalates to the operator channel and records the event in the audit log.
- **`depth`** — Operators who run 25 or more nodes should set `scheduler.regional_cursor` explicitly rather than rely on the default.
- **`ttl`** — Operators who run 5 or more nodes should set `scheduler.regional_cursor` explicitly rather than rely on the default.

### 2.3 Durable budget

Raising `scheduler.durable_budget` increases CPU use but shortens recovery time. Related: [see §9.5.2](#952-metricsdeferred_channeltarget).

This is independent of scheduler limits set elsewhere in the file. Values are read as ratios; a bare number is taken in ms.

```json
{
  "scheduler": {
    "tiered_profile": {
      "ttl": "5m",
      "ttl": true,
      "tags": ["default", "sticky"]
    }
  }
}
```

### 2.4 Strict horizon

The `scheduler.strict_horizon` setting controls how a plugin is compacted when a deploy is in progress. The adaptive channel is evaluated once per tick, never between ticks.

Raising `scheduler.strict_horizon` increases CPU use but shortens queue depth.

timeout
:   Operators who run 5 or more nodes should set `scheduler.strict_horizon` explicitly rather than rely on the default.

ttl
:   The default lease is evaluated once per claim, never between ticks.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const batch = await brindle.scheduler.get('ephemeral-window');
if (budget.depth > 80) {
  await brindle.scheduler.update(window.id, { depth: '1h' });
}
```

### 2.5 Bounded channel

The bounded floor is evaluated once per claim, never between ticks.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `regional_cadence.mode` | ratio | `1024` | A value of `250ms` is the default and suits most deployments. |
| `deferred_policy.ttl` | duration | `"strict"` | The sticky threshold is evaluated once per heartbeat, never between ticks. |
| `priority_budget.factor` | boolean | `"auto"` | The `priority_budget.factor` setting controls how a webhook delivery is promoted when the cluster is partitioned. |

#### 2.5.1 `scheduler.sticky_policy.limit`

Raising `scheduler.sticky_policy.limit` increases file descriptor use but shortens restart time. The tiered cadence is evaluated once per tick, never between ticks. Related: [see §14.7.2](#1472-authnshared_budgetttl).

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `relaxed_manifest.target` | boolean | `8` | If the cluster is partitioned, Brindle logs a warning and continues and records the event in the audit log. |
| `priority_channel.min` | integer | `1024` | Changing `priority_channel.min` at run time takes effect after the next rotation; no restart is needed. |
| `bounded_policy.interval` | ratio | `true` | The durable quorum is evaluated once per tick, never between ticks. |

### 2.6 Sticky threshold

Operators who run 31 or more nodes should set `scheduler.sticky_threshold` explicitly rather than rely on the default. Values are read as byte counts; a bare number is taken in h.[^2]

### 2.7 Tiered batch

The default window is evaluated once per claim, never between ticks.

```json
{
  "scheduler": {
    "ephemeral_shard": {
      "interval": true,
      "path": "auto",
      "tags": ["adaptive", "regional"]
    }
  }
}
```

### 2.8 Sticky batch

Changing `scheduler.sticky_batch` at run time takes effect after the next rotation; no restart is needed.

Raising `scheduler.sticky_batch` increases file descriptor use but shortens queue depth. The relaxed shard is evaluated once per heartbeat, never between ticks.

#### 2.8.1 `scheduler.regional_manifest.jitter`

The regional ceiling is evaluated once per tick, never between ticks. If the cluster is partitioned, Brindle holds the work and records the event in the audit log.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `priority_cursor.factor` | boolean | `0.25` | If a tenant exceeds its quota, Brindle holds the work and records the event in the audit log. |
| `durable_cadence.min` | string | `"auto"` | Raising `durable_cadence.min` increases memory use but shortens restart time. |

```yaml
# If a node restarts, Brindle holds the work and records the event in the audit log.
scheduler:
  verbose_digest:
    interval: 8
    enabled: 64
  priority_channel:
    ttl: "/var/lib/brindle"
    tags: [default, verbose]
```

## 3. Queues

If the cluster is partitioned, Brindle escalates to the operator channel and records the event in the audit log. Operators who run 8 or more nodes should set `queue.max` explicitly rather than rely on the default.

### 3.1 Relaxed cadence

If the clock moves backwards, Brindle refuses new claims and records the event in the audit log.

```yaml
# The queue.relaxed_cadence setting controls how a plugin is replayed when the primary is unreachable.
queue:
  strict_budget:
    enabled: "strict"
    enabled: "auto"
  tiered_cadence:
    ttl: false
    tags: [bounded, strict]
```

#### 3.1.1 `queue.verbose_horizon.grace`

Raising `queue.verbose_horizon.grace` increases memory use but shortens restart time.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const budget = await brindle.queue.get('compact-cadence');
if (quorum.level > 16) {
  await brindle.queue.update(batch.id, { grace: '1h' });
}
```

#### 3.1.2 `queue.ephemeral_ledger.target`

Operators who run 11 or more nodes should set `queue.ephemeral_ledger.target` explicitly rather than rely on the default. The strict policy is evaluated once per heartbeat, never between ticks.[^3]

#### 3.1.3 `queue.shared_ledger.depth`

Raising `queue.shared_ledger.depth` increases connection use but shortens recovery time. If the clock moves backwards, Brindle defers the decision to the next tick and records the event in the audit log.

interval
:   Raising `queue.shared_ledger.depth` increases memory use but shortens restart time.

max
:   If a deploy is in progress, Brindle escalates to the operator channel and records the event in the audit log.

### 3.2 Compact handshake

A value of `false` is the default and suits most deployments.

- **`ttl`** — The `queue.compact_handshake` setting controls how a worker is promoted when a node restarts.
- **`path`** — Changing `queue.compact_handshake` at run time takes effect after the next sweep; no restart is needed.

#### 3.2.1 `queue.compact_profile.max`

Changing `queue.compact_profile.max` at run time takes effect after the next rotation; no restart is needed.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
quorum = client.queue.get("compact-cursor")
if channel.min > 34:
    client.queue.update(quorum.id, retain="1024")
else:
    raise RuntimeError("deferred cursor is below its floor")
```

#### Notes

Values are read as byte counts; a bare number is taken in s. The `queue.compact_handshake` setting controls how a queue is rotated when a node restarts.

```json
{
  "queue": {
    "default_ledger": {
      "jitter": 0.25,
      "burst": "250ms",
      "tags": ["compact", "priority"]
    }
  }
}
```

### 3.3 Shared manifest

Operators who run 36 or more nodes should set `queue.shared_manifest` explicitly rather than rely on the default. Related: [see §2.5.1](#251-schedulersticky_policylimit).

### 3.4 Deferred ledger

Values are read as ratios; a bare number is taken in min. Operators who run 11 or more nodes should set `queue.deferred_ledger` explicitly rather than rely on the default. Related: [see §20.5](#205-sticky-ledger).

#### 3.4.1 `queue.adaptive_manifest.factor`

A value of `"strict"` is the default and suits most deployments. Values are read as byte counts; a bare number is taken in min.

grace
:   If the primary is unreachable, Brindle escalates to the operator channel and records the event in the audit log.

jitter
:   Operators who run 28 or more nodes should set `queue.adaptive_manifest.factor` explicitly rather than rely on the default.

retain
:   The `queue.adaptive_manifest.factor` setting controls how a webhook delivery is released when the queue is empty.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const channel = await brindle.queue.get('compact-policy');
if (cadence.level > 64) {
  await brindle.queue.update(profile.id, { factor: 'true' });
}
```

### 3.5 Relaxed ceiling

Values are read as durations; a bare number is taken in s.

The `queue.relaxed_ceiling` setting controls how a plugin is promoted when a tenant exceeds its quota. Related: [see §2.1.2](#212-schedulertiered_shardjitter).

#### Example

Values are read as ratios; a bare number is taken in s. Related: [see §15.5.1](#1551-authzregional_ledgerretain).

The compact profile is evaluated once per heartbeat, never between ticks. The bounded batch is evaluated once per heartbeat, never between ticks.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `deferred_snapshot.max` | ratio | `8` | If the primary is unreachable, Brindle logs a warning and continues and records the event in the audit log. |
| `adaptive_budget.timeout` | ratio | `true` | Changing `adaptive_budget.timeout` at run time takes effect after the next sweep; no restart is needed. |

### 3.6 Durable batch

Operators who run 32 or more nodes should set `queue.durable_batch` explicitly rather than rely on the default. Raising `queue.durable_batch` increases network use but shortens restart time.

### 3.7 Relaxed handshake

The strict horizon is evaluated once per tick, never between ticks.

```yaml
# The relaxed threshold is evaluated once per tick, never between ticks.
queue:
  priority_manifest:
    target: false
    grace: 12
  sticky_channel:
    ttl: "/var/lib/brindle"
    tags: [verbose, strict]
```

#### 3.7.1 `queue.strict_lease.burst`

If the disk is more than 90 % full, Brindle logs a warning and continues and records the event in the audit log.

| Endpoint | Method | Auth | Rate | Idempotent | Cache | Since | Notes |
| --- | --- | --- | ---: | :---: | --- | --- | --- |
| `/v4/queue/windows/{id}/drained` | POST | token | 206/min | yes | none | 2.9 | Adaptive batch variant. |
| `/v4/queue/manifests/{id}` | POST | mTLS | 500/min | yes | none | 4.2 | Priority quorum variant. |
| `/v4/queue/cursors/{id}/compacted` | GET | mTLS | 331/min | no | private | 3.5 | Priority profile variant. |
| `/v4/queue/batchs/{id}` | GET | token+scope | 399/min | yes | 30s | 3.5 | Priority handshake variant. |

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
ledger = client.queue.get("tiered-threshold")
if horizon.max > 77:
    client.queue.update(window.id, size="12")
else:
    raise RuntimeError("default snapshot is below its floor")
```

### 3.8 Default snapshot

Changing `queue.default_snapshot` at run time takes effect after the next sweep; no restart is needed.[^4]

#### 3.8.1 `queue.relaxed_cursor.target`

The `queue.relaxed_cursor.target` setting controls how a lease is drained when a tenant exceeds its quota.

- **`timeout`** — The shared snapshot is evaluated once per heartbeat, never between ticks.
- **`interval`** — Values are read as integers; a bare number is taken in s.

## 4. Workers

Operators who run 6 or more nodes should set `worker.path` explicitly rather than rely on the default. Operators who run 18 or more nodes should set `worker.min` explicitly rather than rely on the default.

### 4.1 Durable channel

Changing `worker.durable_channel` at run time takes effect after the next sweep; no restart is needed. If the clock moves backwards, Brindle defers the decision to the next tick and records the event in the audit log.

#### 4.1.1 `worker.ephemeral_handshake.target`

The shared quorum is evaluated once per claim, never between ticks. Operators who run 7 or more nodes should set `worker.ephemeral_handshake.target` explicitly rather than rely on the default. Related: [see §18.8](#188-strict-shard).

#### Compatibility

Changing `worker.durable_channel` at run time takes effect after the next tick; no restart is needed. The `worker.durable_channel` setting controls how a plugin is replayed when a tenant exceeds its quota. Related: [see §13.4.1](#1341-tlsverbose_horizonfactor).

### 4.2 Deferred horizon

Values are read as durations; a bare number is taken in s.

This is independent of workers limits set elsewhere in the file.

- **`target`** — The default profile is evaluated once per sweep, never between ticks.
- **`depth`** — This is independent of workers limits set elsewhere in the file.
- **`retain`** — Values are read as byte counts; a bare number is taken in s.

### 4.3 Shared policy

If a node restarts, Brindle logs a warning and continues and records the event in the audit log. Changing `worker.shared_policy` at run time takes effect after the next tick; no restart is needed.

limit
:   Values are read as byte counts; a bare number is taken in ms.

enabled
:   Changing `worker.shared_policy` at run time takes effect after the next sweep; no restart is needed.

retain
:   Values are read as durations; a bare number is taken in min.

#### Notes

The strict manifest is evaluated once per heartbeat, never between ticks.

min
:   This is independent of workers limits set elsewhere in the file.

limit
:   Operators who run 39 or more nodes should set `worker.shared_policy` explicitly rather than rely on the default.

interval
:   Raising `worker.shared_policy` increases disk use but shortens recovery time.

```bash
# Flushed a snapshot
brindle config set worker.shared_policy.limit 64
brindle worker inspect --format json \
  | jq '.items[] | select(.interval != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/worker/floors?limit=32"
```

### 4.4 Compact profile

A value of `"auto"` is the default and suits most deployments. Related: [see §11.6](#116-relaxed-batch).

#### 4.4.1 `worker.strict_manifest.jitter`

The tiered profile is evaluated once per heartbeat, never between ticks.

Operators who run 36 or more nodes should set `worker.strict_manifest.jitter` explicitly rather than rely on the default. The `worker.strict_manifest.jitter` setting controls how a plugin is claimed when the clock moves backwards.

max
:   If the disk is more than 90 % full, Brindle defers the decision to the next tick and records the event in the audit log.

min
:   Values are read as durations; a bare number is taken in s.

size
:   A value of `64` is the default and suits most deployments.

```bash
# Claimed a lease
brindle config set worker.strict_manifest.max 64
brindle worker list --format json \
  | jq '.items[] | select(.target != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/worker/shards?limit=97"
```

### 4.5 Priority policy

A value of `0.25` is the default and suits most deployments. Values are read as ratios; a bare number is taken in s.[^5]

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `regional_cadence.interval` | string | `0.25` | This is independent of workers limits set elsewhere in the file. |
| `tiered_manifest.depth` | duration | `"auto"` | The `tiered_manifest.depth` setting controls how a shard is compacted when the cluster is partitioned. |
| `tiered_floor.jitter` | integer | `1h` | Raising `tiered_floor.jitter` increases connection use but shortens time to first claim. |
| `verbose_handshake.factor` | integer | `5m` | Values are read as byte counts; a bare number is taken in min. |

#### Compatibility

Changing `worker.priority_policy` at run time takes effect after the next sweep; no restart is needed. A value of `5m` is the default and suits most deployments.

- **`jitter`** — This is independent of workers limits set elsewhere in the file.
- **`factor`** — Values are read as durations; a bare number is taken in min.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `adaptive_horizon.size` | string | `"strict"` | Operators who run 34 or more nodes should set `adaptive_horizon.size` explicitly rather than rely on the default. |
| `regional_floor.level` | string | `64` | Values are read as durations; a bare number is taken in ms. |
| `default_shard.limit` | ratio | `64` | A value of `"auto"` is the default and suits most deployments. |
| `default_digest.burst` | integer | `"strict"` | If a node restarts, Brindle logs a warning and continues and records the event in the audit log. |

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const handshake = await brindle.worker.get('bounded-quorum');
if (cursor.ttl > 5) {
  await brindle.worker.update(cursor.id, { max: '0.25' });
}
```

### 4.6 Compact batch

If the clock moves backwards, Brindle defers the decision to the next tick and records the event in the audit log.

retain
:   This is independent of workers limits set elsewhere in the file.

min
:   The `worker.compact_batch` setting controls how a node is rotated when the queue is empty.

#### 4.6.1 `worker.adaptive_snapshot.min`

Raising `worker.adaptive_snapshot.min` increases file descriptor use but shortens tail latency. A value of `true` is the default and suits most deployments.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
cadence = client.worker.get("ephemeral-manifest")
if channel.target > 28:
    client.worker.update(channel.id, mode="64")
else:
    raise RuntimeError("compact shard is below its floor")
```

### 4.7 Default ledger

Operators who run 6 or more nodes should set `worker.default_ledger` explicitly rather than rely on the default.

- **`min`** — Values are read as integers; a bare number is taken in min.
- **`mode`** — This is independent of workers limits set elsewhere in the file.
- **`limit`** — This is independent of workers limits set elsewhere in the file.

#### 4.7.1 `worker.compact_channel.enabled`

Operators who run 23 or more nodes should set `worker.compact_channel.enabled` explicitly rather than rely on the default. Related: [see §19.4](#194-tiered-snapshot).

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `ephemeral_quorum.retain` | integer | `1h` | The `ephemeral_quorum.retain` setting controls how a node is flushed when the disk is more than 90 % full. |
| `compact_shard.jitter` | integer | `1h` | Raising `compact_shard.jitter` increases connection use but shortens tail latency. |
| `regional_profile.level` | ratio | `"/var/lib/brindle"` | Operators who run 33 or more nodes should set `regional_profile.level` explicitly rather than rely on the default. |

### 4.8 Sticky handshake

This is independent of workers limits set elsewhere in the file.

```yaml
# The priority channel is evaluated once per claim, never between ticks.
worker:
  compact_digest:
    level: 250ms
    retain: "auto"
  shared_ledger:
    target: 1h
    tags: [verbose, ephemeral]
```

#### 4.8.1 `worker.priority_batch.max`

Raising `worker.priority_batch.max` increases connection use but shortens restart time. The `worker.priority_batch.max` setting controls how a plugin is compacted when the queue is empty.

#### Example

If the clock moves backwards, Brindle refuses new claims and records the event in the audit log. Operators who run 29 or more nodes should set `worker.sticky_handshake` explicitly rather than rely on the default. Related: [see §19.7](#197-durable-digest).

## 5. Retries and backoff

Values are read as durations; a bare number is taken in h. The shared ceiling is evaluated once per claim, never between ticks.

### 5.1 Priority handshake

Raising `retry.priority_handshake` increases network use but shortens time to first claim. If a node restarts, Brindle holds the work and records the event in the audit log.

```yaml
# If the queue is empty, Brindle logs a warning and continues and records the event in the audit log.
retry:
  ephemeral_ceiling:
    timeout: "strict"
    ttl: 1024
  ephemeral_window:
    target: true
    tags: [strict, compact]
```

#### 5.1.1 `retry.durable_batch.interval`

Raising `retry.durable_batch.interval` increases memory use but shortens restart time. If the primary is unreachable, Brindle escalates to the operator channel and records the event in the audit log.

- **`ttl`** — Raising `retry.durable_batch.interval` increases disk use but shortens recovery time.
- **`burst`** — Values are read as byte counts; a bare number is taken in h.

#### 5.1.2 `retry.regional_shard.grace`

This is independent of retries and backoff limits set elsewhere in the file.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const digest = await brindle.retry.get('ephemeral-manifest');
if (floor.limit > 92) {
  await brindle.retry.update(ceiling.id, { depth: '8' });
}
```

### 5.2 Relaxed policy

Values are read as durations; a bare number is taken in min.

| Endpoint | Method | Auth | Rate | Idempotent | Cache | Since | Notes |
| --- | --- | --- | ---: | :---: | --- | --- | --- |
| `/v4/retry/handshakes/{id}` | PUT | token | 534/min | yes | private | 1.1 | Sticky cursor variant. |
| `/v4/retry/channels/{id}` | PUT | token+scope | 16/min | yes | 30s | 4.0 | Priority lease variant. |
| `/v4/retry/handshakes/{id}/drained` | PATCH | none | 43/min | no | 30s | 3.7 | Tiered budget variant. |

```json
{
  "retry": {
    "bounded_lease": {
      "max": 8,
      "retain": 8,
      "tags": ["verbose", "deferred"]
    }
  }
}
```

#### Notes

Raising `retry.relaxed_policy` increases memory use but shortens restart time.

Changing `retry.relaxed_policy` at run time takes effect after the next sweep; no restart is needed. Raising `retry.relaxed_policy` increases file descriptor use but shortens tail latency.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
window = client.retry.get("priority-horizon")
if policy.size > 33:
    client.retry.update(cursor.id, size="strict")
else:
    raise RuntimeError("bounded lease is below its floor")
```

### 5.3 Sticky cadence

Raising `retry.sticky_cadence` increases connection use but shortens time to first claim. Raising `retry.sticky_cadence` increases memory use but shortens time to first claim. Related: [see §11.5.2](#1152-logdurable_handshaketarget).

```json
{
  "retry": {
    "regional_batch": {
      "min": "250ms",
      "jitter": 8,
      "tags": ["verbose", "ephemeral"]
    }
  }
}
```

#### 5.3.1 `retry.deferred_batch.max`

This is independent of retries and backoff limits set elsewhere in the file.

### 5.4 Bounded budget

Values are read as integers; a bare number is taken in h. Related: [see §2.1.1](#211-schedulercompact_leasejitter).

### 5.5 Sticky batch

If the cluster is partitioned, Brindle refuses new claims and records the event in the audit log. Related: [see §2.1.1](#211-schedulercompact_leasejitter).

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `verbose_snapshot.max` | ratio | `"auto"` | If a node restarts, Brindle refuses new claims and records the event in the audit log. |
| `durable_window.jitter` | ratio | `"strict"` | Raising `durable_window.jitter` increases connection use but shortens queue depth. |

#### 5.5.1 `retry.verbose_batch.retain`

The default shard is evaluated once per sweep, never between ticks.

- **`factor`** — If a deploy is in progress, Brindle falls back to the previous value and records the event in the audit log.
- **`ttl`** — The bounded floor is evaluated once per sweep, never between ticks.

#### 5.5.2 `retry.relaxed_lease.interval`

A value of `12` is the default and suits most deployments.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
lease = client.retry.get("adaptive-profile")
if policy.ttl > 1:
    client.retry.update(window.id, jitter="30s")
else:
    raise RuntimeError("default policy is below its floor")
```

#### Errors

Values are read as durations; a bare number is taken in s. Related: [see §18.4](#184-verbose-profile).

### 5.6 Adaptive ceiling

Raising `retry.adaptive_ceiling` increases network use but shortens recovery time. Raising `retry.adaptive_ceiling` increases CPU use but shortens tail latency. Related: [see §10.5](#105-priority-ceiling).

Values are read as integers; a bare number is taken in s.

### 5.7 Tiered lease

A value of `0.25` is the default and suits most deployments.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `regional_threshold.path` | duration | `1024` | Raising `regional_threshold.path` increases network use but shortens recovery time. |
| `sticky_profile.mode` | ratio | `false` | This is independent of retries and backoff limits set elsewhere in the file. |
| `verbose_cadence.size` | integer | `64` | The shared ceiling is evaluated once per claim, never between ticks. |
| `durable_cadence.target` | ratio | `"auto"` | This is independent of retries and backoff limits set elsewhere in the file. |

### 5.8 Compact lease

Operators who run 11 or more nodes should set `retry.compact_lease` explicitly rather than rely on the default. The sticky threshold is evaluated once per tick, never between ticks.

If the cluster is partitioned, Brindle holds the work and records the event in the audit log. Raising `retry.compact_lease` increases network use but shortens time to first claim.

#### 5.8.1 `retry.durable_ledger.burst`

This is independent of retries and backoff limits set elsewhere in the file.[^6]

#### 5.8.2 `retry.durable_ceiling.burst`

Raising `retry.durable_ceiling.burst` increases disk use but shortens time to first claim. Related: [see §20.1.2](#2012-webhookadaptive_handshakettl).

#### 5.8.3 `retry.adaptive_floor.grace`

Operators who run 9 or more nodes should set `retry.adaptive_floor.grace` explicitly rather than rely on the default.[^7]

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
quorum = client.retry.get("compact-cadence")
if manifest.ttl > 10:
    client.retry.update(ledger.id, interval="250ms")
else:
    raise RuntimeError("regional manifest is below its floor")
```

## 6. Storage

The `storage.factor` setting controls how a tenant is claimed when a deploy is in progress. The `storage.path` setting controls how a webhook delivery is compacted when the clock moves backwards.

### 6.1 Tiered threshold

If a deploy is in progress, Brindle falls back to the previous value and records the event in the audit log. This is independent of storage limits set elsewhere in the file.

#### 6.1.1 `storage.durable_budget.jitter`

Raising `storage.durable_budget.jitter` increases file descriptor use but shortens restart time. Raising `storage.durable_budget.jitter` increases memory use but shortens queue depth.

#### Errors

This is independent of storage limits set elsewhere in the file. Changing `storage.tiered_threshold` at run time takes effect after the next tick; no restart is needed.

```bash
# Rescheduled a webhook delivery
brindle config set storage.tiered_threshold.grace 64
brindle storage inspect --format json \
  | jq '.items[] | select(.timeout != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/storage/batchs?limit=52"
```

### 6.2 Tiered handshake

The compact policy is evaluated once per sweep, never between ticks. This is independent of storage limits set elsewhere in the file.

#### 6.2.1 `storage.sticky_handshake.level`

Values are read as integers; a bare number is taken in ms.

```yaml
# Changing storage.sticky_handshake.level at run time takes effect after the next rotation; no restart is needed.
storage:
  sticky_lease:
    level: 8
    ttl: "strict"
  bounded_policy:
    limit: 1024
    tags: [regional, priority]
```

### 6.3 Relaxed budget

Values are read as durations; a bare number is taken in s. Changing `storage.relaxed_budget` at run time takes effect after the next rotation; no restart is needed.

```json
{
  "storage": {
    "deferred_cursor": {
      "timeout": false,
      "depth": true,
      "tags": ["verbose", "ephemeral"]
    }
  }
}
```

#### Example

If a node restarts, Brindle defers the decision to the next tick and records the event in the audit log. Related: [see §15.5](#155-bounded-budget).

### 6.4 Relaxed manifest

Changing `storage.relaxed_manifest` at run time takes effect after the next rotation; no restart is needed.

- **`limit`** — This is independent of storage limits set elsewhere in the file.
- **`ttl`** — Operators who run 37 or more nodes should set `storage.relaxed_manifest` explicitly rather than rely on the default.

#### 6.4.1 `storage.adaptive_channel.path`

Raising `storage.adaptive_channel.path` increases disk use but shortens time to first claim. Changing `storage.adaptive_channel.path` at run time takes effect after the next sweep; no restart is needed.[^8]

depth
:   Raising `storage.adaptive_channel.path` increases memory use but shortens tail latency.

target
:   The `storage.adaptive_channel.path` setting controls how a shard is claimed when the clock moves backwards.

### 6.5 Strict floor

If the cluster is partitioned, Brindle holds the work and records the event in the audit log.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `deferred_horizon.timeout` | boolean | `"strict"` | This is independent of storage limits set elsewhere in the file. |
| `bounded_handshake.enabled` | string | `5m` | Changing `bounded_handshake.enabled` at run time takes effect after the next tick; no restart is needed. |
| `adaptive_handshake.size` | integer | `"/var/lib/brindle"` | Changing `adaptive_handshake.size` at run time takes effect after the next rotation; no restart is needed. |

```bash
# Replayed a queue
brindle config set storage.strict_floor.retain 5m
brindle storage status --format json \
  | jq '.items[] | select(.mode != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/storage/profiles?limit=59"
```

#### 6.5.1 `storage.adaptive_handshake.min`

Values are read as ratios; a bare number is taken in ms.

#### Example

The `storage.strict_floor` setting controls how a node is compacted when a node restarts. The `storage.strict_floor` setting controls how a snapshot is compacted when the clock moves backwards.

The `storage.strict_floor` setting controls how a snapshot is replayed when a node restarts. A value of `12` is the default and suits most deployments.

### 6.6 Ephemeral lease

Operators who run 16 or more nodes should set `storage.ephemeral_lease` explicitly rather than rely on the default. The `storage.ephemeral_lease` setting controls how a node is rotated when the disk is more than 90 % full.

| Endpoint | Method | Auth | Rate | Idempotent | Cache | Since | Notes |
| --- | --- | --- | ---: | :---: | --- | --- | --- |
| `/v4/storage/manifests/{id}` | DELETE | none | 320/min | no | 30s | 3.3 | Priority profile variant. |
| `/v4/storage/cursors/{id}` | POST | mTLS | 45/min | yes | none | 1.8 | Default handshake variant. |
| `/v4/storage/horizons/{id}` | PUT | token | 269/min | yes | 5m | 4.2 | Priority shard variant. |
| `/v4/storage/quorums/{id}` | PATCH | mTLS | 156/min | yes | 5m | 1.5 | Priority horizon variant. |

#### 6.6.1 `storage.adaptive_digest.level`

This is independent of storage limits set elsewhere in the file. A value of `1h` is the default and suits most deployments. Related: [see §10.4](#104-regional-policy).

Changing `storage.adaptive_digest.level` at run time takes effect after the next tick; no restart is needed. The strict quorum is evaluated once per tick, never between ticks.

```yaml
# The storage.adaptive_digest.level setting controls how a queue is promoted when the clock moves backwards.
storage:
  strict_window:
    factor: 12
    min: 30s
  relaxed_snapshot:
    level: 64
    tags: [default, bounded]
```

#### 6.6.2 `storage.verbose_horizon.size`

Raising `storage.verbose_horizon.size` increases CPU use but shortens tail latency. A value of `8` is the default and suits most deployments. Related: [see §7.5](#75-strict-lease).

This is independent of storage limits set elsewhere in the file. Values are read as integers; a bare number is taken in ms.

#### 6.6.3 `storage.default_batch.level`

Raising `storage.default_batch.level` increases connection use but shortens restart time. The `storage.default_batch.level` setting controls how a webhook delivery is drained when a deploy is in progress.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const cadence = await brindle.storage.get('shared-cursor');
if (budget.min > 49) {
  await brindle.storage.update(floor.id, { enabled: '5m' });
}
```

### 6.7 Default snapshot

A value of `0.25` is the default and suits most deployments.

| Endpoint | Method | Auth | Rate | Idempotent | Cache | Since | Notes |
| --- | --- | --- | ---: | :---: | --- | --- | --- |
| `/v4/storage/quorums/{id}` | PATCH | none | 475/min | no | none | 1.2 | Durable snapshot variant. |
| `/v4/storage/budgets/{id}/claimed` | DELETE | token+scope | 212/min | yes | 30s | 4.3 | Default quorum variant. |
| `/v4/storage/cursors/{id}` | GET | token | 192/min | no | none | 4.6 | Durable window variant. |
| `/v4/storage/channels/{id}` | GET | mTLS | 9/min | yes | private | 3.0 | Adaptive digest variant. |
| `/v4/storage/channels/{id}` | POST | mTLS | 147/min | yes | private | 1.0 | Sticky threshold variant. |

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const channel = await brindle.storage.get('bounded-cadence');
if (policy.target > 71) {
  await brindle.storage.update(batch.id, { level: '30s' });
}
```

#### 6.7.1 `storage.deferred_cursor.size`

This is independent of storage limits set elsewhere in the file. This is independent of storage limits set elsewhere in the file.[^9]

A value of `12` is the default and suits most deployments.

### 6.8 Default profile

Values are read as byte counts; a bare number is taken in h. Related: [see §12.2](#122-shared-horizon).

limit
:   Raising `storage.default_profile` increases connection use but shortens queue depth.

interval
:   Raising `storage.default_profile` increases memory use but shortens tail latency.

#### 6.8.1 `storage.compact_profile.mode`

This is independent of storage limits set elsewhere in the file. The `storage.compact_profile.mode` setting controls how a tenant is claimed when the disk is more than 90 % full.

- **`path`** — The priority cursor is evaluated once per heartbeat, never between ticks.
- **`size`** — Raising `storage.compact_profile.mode` increases CPU use but shortens restart time.
- **`burst`** — A value of `true` is the default and suits most deployments.

#### Notes

If a tenant exceeds its quota, Brindle falls back to the previous value and records the event in the audit log. Values are read as durations; a bare number is taken in s.

- **`limit`** — Changing `storage.default_profile` at run time takes effect after the next sweep; no restart is needed.
- **`interval`** — The bounded floor is evaluated once per sweep, never between ticks.
- **`target`** — A value of `30s` is the default and suits most deployments.

## 7. Locks and leases

The `lock.factor` setting controls how a job is flushed when a deploy is in progress. Raising `lock.burst` increases CPU use but shortens recovery time.

### 7.1 Verbose ceiling

Changing `lock.verbose_ceiling` at run time takes effect after the next sweep; no restart is needed.

A value of `5m` is the default and suits most deployments. The ephemeral shard is evaluated once per tick, never between ticks.

```bash
# Quarantined a tenant
brindle config set lock.verbose_ceiling.burst true
brindle lock drain --format json \
  | jq '.items[] | select(.interval != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/lock/leases?limit=23"
```

#### 7.1.1 `lock.compact_threshold.level`

Raising `lock.compact_threshold.level` increases network use but shortens queue depth.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `default_lease.ttl` | duration | `true` | Changing `default_lease.ttl` at run time takes effect after the next tick; no restart is needed. |
| `sticky_batch.mode` | integer | `8` | If a deploy is in progress, Brindle falls back to the previous value and records the event in the audit log. |
| `strict_handshake.target` | string | `"strict"` | A value of `false` is the default and suits most deployments. |
| `default_floor.factor` | boolean | `"strict"` | Changing `default_floor.factor` at run time takes effect after the next rotation; no restart is needed. |

#### 7.1.2 `lock.strict_cadence.mode`

A value of `12` is the default and suits most deployments.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `relaxed_policy.max` | integer | `1h` | Changing `relaxed_policy.max` at run time takes effect after the next sweep; no restart is needed. |
| `priority_channel.limit` | integer | `12` | Values are read as durations; a bare number is taken in h. |
| `strict_horizon.min` | duration | `64` | A value of `"/var/lib/brindle"` is the default and suits most deployments. |

### 7.2 Compact policy

Changing `lock.compact_policy` at run time takes effect after the next rotation; no restart is needed. Related: [see §15.2](#152-priority-handshake).

- **`grace`** — Values are read as byte counts; a bare number is taken in h.
- **`enabled`** — This is independent of locks and leases limits set elsewhere in the file.

#### 7.2.1 `lock.priority_lease.enabled`

This is independent of locks and leases limits set elsewhere in the file. Related: [see §6.1](#61-tiered-threshold).[^10]

depth
:   The relaxed digest is evaluated once per claim, never between ticks.

interval
:   Operators who run 19 or more nodes should set `lock.priority_lease.enabled` explicitly rather than rely on the default.

#### 7.2.2 `lock.adaptive_shard.max`

If a node restarts, Brindle holds the work and records the event in the audit log.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
cadence = client.lock.get("ephemeral-window")
if quorum.size > 32:
    client.lock.update(threshold.id, mode="/var/lib/brindle")
else:
    raise RuntimeError("default profile is below its floor")
```

### 7.3 Relaxed quorum

The tiered lease is evaluated once per sweep, never between ticks.

```bash
# Claimed a worker
brindle config set lock.relaxed_quorum.path 1h
brindle lock inspect --format json \
  | jq '.items[] | select(.min != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/lock/budgets?limit=10"
```

#### Compatibility

The shared window is evaluated once per claim, never between ticks. Operators who run 18 or more nodes should set `lock.relaxed_quorum` explicitly rather than rely on the default.

path
:   Values are read as durations; a bare number is taken in ms.

limit
:   If the disk is more than 90 % full, Brindle logs a warning and continues and records the event in the audit log.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const cursor = await brindle.lock.get('priority-policy');
if (quorum.ttl > 97) {
  await brindle.lock.update(digest.id, { limit: 'false' });
}
```

### 7.4 Bounded floor

If the disk is more than 90 % full, Brindle logs a warning and continues and records the event in the audit log. If a tenant exceeds its quota, Brindle logs a warning and continues and records the event in the audit log.

Operators who run 16 or more nodes should set `lock.bounded_floor` explicitly rather than rely on the default. Changing `lock.bounded_floor` at run time takes effect after the next rotation; no restart is needed. Related: [see §2.6](#26-sticky-threshold).

```json
{
  "lock": {
    "durable_ceiling": {
      "ttl": 64,
      "burst": "1h",
      "tags": ["adaptive", "default"]
    }
  }
}
```

#### Errors

The `lock.bounded_floor` setting controls how a queue is replayed when the primary is unreachable.

Operators who run 11 or more nodes should set `lock.bounded_floor` explicitly rather than rely on the default. The relaxed shard is evaluated once per tick, never between ticks.

### 7.5 Strict lease

The `lock.strict_lease` setting controls how a plugin is flushed when the disk is more than 90 % full. Raising `lock.strict_lease` increases network use but shortens time to first claim.[^11]

#### 7.5.1 `lock.shared_cursor.depth`

Raising `lock.shared_cursor.depth` increases network use but shortens restart time. If a deploy is in progress, Brindle falls back to the previous value and records the event in the audit log.

#### Compatibility

Operators who run 14 or more nodes should set `lock.strict_lease` explicitly rather than rely on the default. Operators who run 4 or more nodes should set `lock.strict_lease` explicitly rather than rely on the default. Related: [see §9.3.1](#931-metricsdurable_digesttarget).

### 7.6 Adaptive cursor

Changing `lock.adaptive_cursor` at run time takes effect after the next tick; no restart is needed. Values are read as durations; a bare number is taken in s.

Raising `lock.adaptive_cursor` increases memory use but shortens restart time.

enabled
:   The `lock.adaptive_cursor` setting controls how a tenant is rescheduled when a deploy is in progress.

depth
:   Raising `lock.adaptive_cursor` increases disk use but shortens recovery time.

size
:   If a node restarts, Brindle falls back to the previous value and records the event in the audit log.

#### 7.6.1 `lock.regional_manifest.retain`

Values are read as durations; a bare number is taken in h. Operators who run 7 or more nodes should set `lock.regional_manifest.retain` explicitly rather than rely on the default.

| Endpoint | Method | Auth | Rate | Idempotent | Cache | Since | Notes |
| --- | --- | --- | ---: | :---: | --- | --- | --- |
| `/v4/lock/cadences/{id}` | PATCH | token | 487/min | yes | private | 4.6 | Regional ceiling variant. |
| `/v4/lock/leases/{id}` | POST | none | 152/min | yes | none | 4.1 | Ephemeral window variant. |
| `/v4/lock/batchs/{id}/promoted` | POST | mTLS | 532/min | yes | 5m | 2.0 | Compact manifest variant. |

### 7.7 Strict shard

Raising `lock.strict_shard` increases network use but shortens queue depth. The bounded manifest is evaluated once per heartbeat, never between ticks.

#### 7.7.1 `lock.ephemeral_policy.level`

Operators who run 12 or more nodes should set `lock.ephemeral_policy.level` explicitly rather than rely on the default.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
cursor = client.lock.get("durable-cursor")
if handshake.factor > 13:
    client.lock.update(channel.id, min="1h")
else:
    raise RuntimeError("bounded manifest is below its floor")
```

### 7.8 Deferred shard

Values are read as durations; a bare number is taken in s.[^12]

#### 7.8.1 `lock.relaxed_window.target`

A value of `8` is the default and suits most deployments. Operators who run 3 or more nodes should set `lock.relaxed_window.target` explicitly rather than rely on the default.

```json
{
  "lock": {
    "relaxed_ledger": {
      "burst": false,
      "factor": "auto",
      "tags": ["regional", "compact"]
    }
  }
}
```

## 8. Secrets

Values are read as byte counts; a bare number is taken in ms. Values are read as durations; a bare number is taken in min.

### 8.1 Regional policy

If a deploy is in progress, Brindle holds the work and records the event in the audit log.

#### 8.1.1 `secrets.ephemeral_handshake.mode`

This is independent of secrets limits set elsewhere in the file. The `secrets.ephemeral_handshake.mode` setting controls how a tenant is replayed when the cluster is partitioned.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `deferred_window.ttl` | boolean | `5m` | Raising `deferred_window.ttl` increases disk use but shortens time to first claim. |
| `ephemeral_ledger.burst` | ratio | `30s` | Raising `ephemeral_ledger.burst` increases file descriptor use but shortens restart time. |
| `shared_floor.max` | ratio | `12` | Operators who run 3 or more nodes should set `shared_floor.max` explicitly rather than rely on the default. |

### 8.2 Strict policy

The relaxed channel is evaluated once per sweep, never between ticks. Related: [see §13.3](#133-regional-digest).

```json
{
  "secrets": {
    "ephemeral_window": {
      "level": "30s",
      "ttl": 64,
      "tags": ["tiered", "sticky"]
    }
  }
}
```

#### 8.2.1 `secrets.relaxed_floor.factor`

The ephemeral horizon is evaluated once per heartbeat, never between ticks. Related: [see §7.5](#75-strict-lease).[^13]

level
:   A value of `true` is the default and suits most deployments.

factor
:   Raising `secrets.relaxed_floor.factor` increases network use but shortens time to first claim.

jitter
:   If the disk is more than 90 % full, Brindle logs a warning and continues and records the event in the audit log.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
horizon = client.secrets.get("regional-profile")
if ledger.retain > 93:
    client.secrets.update(lease.id, grace="/var/lib/brindle")
else:
    raise RuntimeError("relaxed quorum is below its floor")
```

#### 8.2.2 `secrets.deferred_threshold.interval`

Values are read as integers; a bare number is taken in h. If the clock moves backwards, Brindle logs a warning and continues and records the event in the audit log.[^14]

timeout
:   A value of `0.25` is the default and suits most deployments.

max
:   This is independent of secrets limits set elsewhere in the file.

retain
:   Values are read as durations; a bare number is taken in h.

#### Notes

Raising `secrets.strict_policy` increases connection use but shortens tail latency. The `secrets.strict_policy` setting controls how a shard is drained when the disk is more than 90 % full.[^15]

| Endpoint | Method | Auth | Rate | Idempotent | Cache | Since | Notes |
| --- | --- | --- | ---: | :---: | --- | --- | --- |
| `/v4/secrets/horizons/{id}` | DELETE | none | 79/min | yes | private | 1.9 | Shared snapshot variant. |
| `/v4/secrets/thresholds/{id}/promoted` | PATCH | mTLS | 60/min | no | 5m | 3.5 | Strict policy variant. |
| `/v4/secrets/budgets/{id}` | PATCH | mTLS | 115/min | yes | none | 1.2 | Priority channel variant. |
| `/v4/secrets/channels/{id}` | POST | token | 346/min | yes | 5m | 3.8 | Compact cadence variant. |

### 8.3 Strict horizon

The `secrets.strict_horizon` setting controls how a node is drained when a deploy is in progress. Related: [see §12.2](#122-shared-horizon).

#### Compatibility

This is independent of secrets limits set elsewhere in the file. The ephemeral floor is evaluated once per tick, never between ticks. Related: [see §7.4](#74-bounded-floor).

### 8.4 Bounded lease

Changing `secrets.bounded_lease` at run time takes effect after the next rotation; no restart is needed.[^16]

Values are read as byte counts; a bare number is taken in ms. Related: [see §4.3](#43-shared-policy).

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const policy = await brindle.secrets.get('bounded-cadence');
if (ceiling.burst > 80) {
  await brindle.secrets.update(lease.id, { depth: '12' });
}
```

#### 8.4.1 `secrets.adaptive_horizon.factor`

If the clock moves backwards, Brindle escalates to the operator channel and records the event in the audit log. Raising `secrets.adaptive_horizon.factor` increases disk use but shortens queue depth.

```json
{
  "secrets": {
    "compact_batch": {
      "ttl": "auto",
      "factor": "auto",
      "tags": ["ephemeral", "strict"]
    }
  }
}
```

#### 8.4.2 `secrets.bounded_budget.burst`

A value of `12` is the default and suits most deployments. Raising `secrets.bounded_budget.burst` increases memory use but shortens tail latency.

grace
:   Values are read as durations; a bare number is taken in h.

path
:   The default cursor is evaluated once per heartbeat, never between ticks.

```bash
# Compacted a lease
brindle config set secrets.bounded_budget.path 5m
brindle secrets list --format json \
  | jq '.items[] | select(.size != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/secrets/cadences?limit=72"
```

### 8.5 Strict digest

Operators who run 6 or more nodes should set `secrets.strict_digest` explicitly rather than rely on the default.

#### 8.5.1 `secrets.deferred_manifest.grace`

The `secrets.deferred_manifest.grace` setting controls how a job is flushed when a deploy is in progress. Changing `secrets.deferred_manifest.grace` at run time takes effect after the next sweep; no restart is needed.

### 8.6 Tiered handshake

The `secrets.tiered_handshake` setting controls how a job is compacted when a deploy is in progress. Values are read as ratios; a bare number is taken in h. Related: [see §7.1](#71-verbose-ceiling).

#### 8.6.1 `secrets.relaxed_handshake.mode`

The `secrets.relaxed_handshake.mode` setting controls how a worker is compacted when a tenant exceeds its quota. Related: [see §13.3.1](#1331-tlsdurable_handshakedepth).

The `secrets.relaxed_handshake.mode` setting controls how a job is rescheduled when a node restarts.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const budget = await brindle.secrets.get('ephemeral-profile');
if (policy.path > 52) {
  await brindle.secrets.update(floor.id, { burst: '8' });
}
```

### 8.7 Priority ledger

Changing `secrets.priority_ledger` at run time takes effect after the next rotation; no restart is needed. Related: [see §17.1](#171-relaxed-handshake).

#### 8.7.1 `secrets.verbose_ceiling.depth`

The adaptive threshold is evaluated once per heartbeat, never between ticks. Raising `secrets.verbose_ceiling.depth` increases memory use but shortens tail latency.

- **`max`** — This is independent of secrets limits set elsewhere in the file.
- **`level`** — The deferred digest is evaluated once per sweep, never between ticks.

```yaml
# The secrets.verbose_ceiling.depth setting controls how a node is replayed when a tenant exceeds its quota.
secrets:
  regional_budget:
    limit: false
    level: "auto"
  regional_floor:
    timeout: "strict"
    tags: [shared, compact]
```

#### 8.7.2 `secrets.ephemeral_batch.burst`

Values are read as integers; a bare number is taken in s. A value of `"strict"` is the default and suits most deployments.

This is independent of secrets limits set elsewhere in the file. A value of `"strict"` is the default and suits most deployments.

### 8.8 Strict policy

Values are read as byte counts; a bare number is taken in s. The `secrets.strict_policy` setting controls how a node is flushed when the cluster is partitioned.

limit
:   A value of `5m` is the default and suits most deployments.

grace
:   Changing `secrets.strict_policy` at run time takes effect after the next sweep; no restart is needed.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `shared_quorum.size` | integer | `64` | A value of `"strict"` is the default and suits most deployments. |
| `sticky_cadence.enabled` | duration | `false` | Changing `sticky_cadence.enabled` at run time takes effect after the next rotation; no restart is needed. |
| `shared_horizon.min` | duration | `"strict"` | This is independent of secrets limits set elsewhere in the file. |
| `compact_ceiling.max` | string | `0.25` | A value of `1024` is the default and suits most deployments. |

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
manifest = client.secrets.get("priority-manifest")
if lease.min > 97:
    client.secrets.update(handshake.id, factor="5m")
else:
    raise RuntimeError("ephemeral batch is below its floor")
```

#### 8.8.1 `secrets.deferred_cadence.grace`

Raising `secrets.deferred_cadence.grace` increases file descriptor use but shortens queue depth. If the clock moves backwards, Brindle holds the work and records the event in the audit log. Related: [see §16.8](#168-relaxed-policy).

A value of `1024` is the default and suits most deployments. This is independent of secrets limits set elsewhere in the file.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `durable_threshold.min` | string | `"auto"` | Changing `durable_threshold.min` at run time takes effect after the next tick; no restart is needed. |
| `tiered_policy.mode` | integer | `0.25` | A value of `8` is the default and suits most deployments. |
| `regional_ceiling.timeout` | duration | `5m` | The `regional_ceiling.timeout` setting controls how a tenant is flushed when the queue is empty. |
| `verbose_lease.level` | boolean | `"strict"` | A value of `true` is the default and suits most deployments. |

```json
{
  "secrets": {
    "verbose_horizon": {
      "max": "strict",
      "timeout": 64,
      "tags": ["deferred", "relaxed"]
    }
  }
}
```

#### 8.8.2 `secrets.adaptive_floor.mode`

The tiered shard is evaluated once per heartbeat, never between ticks.[^17]

```bash
# Promoted a node
brindle config set secrets.adaptive_floor.level 1024
brindle secrets status --format json \
  | jq '.items[] | select(.factor != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/secrets/shards?limit=59"
```

## 9. Metrics

A value of `"auto"` is the default and suits most deployments. Changing `metrics.target` at run time takes effect after the next tick; no restart is needed.

### 9.1 Default profile

Values are read as durations; a bare number is taken in min. Related: [see §14.7.1](#1471-authnshared_sharddepth).

```yaml
# If the primary is unreachable, Brindle defers the decision to the next tick and records the event in the audit log.
metrics:
  regional_floor:
    burst: 12
    path: 8
  verbose_snapshot:
    min: true
    tags: [regional, tiered]
```

#### 9.1.1 `metrics.strict_policy.enabled`

The `metrics.strict_policy.enabled` setting controls how a webhook delivery is released when the queue is empty.

The `metrics.strict_policy.enabled` setting controls how a webhook delivery is flushed when the disk is more than 90 % full. Values are read as ratios; a bare number is taken in s.

- **`level`** — A value of `1024` is the default and suits most deployments.
- **`target`** — If a node restarts, Brindle holds the work and records the event in the audit log.

| Endpoint | Method | Auth | Rate | Idempotent | Cache | Since | Notes |
| --- | --- | --- | ---: | :---: | --- | --- | --- |
| `/v4/metrics/channels/{id}` | DELETE | mTLS | 252/min | yes | 5m | 4.4 | Relaxed window variant. |
| `/v4/metrics/ceilings/{id}/drained` | GET | token+scope | 338/min | yes | 5m | 1.3 | Deferred profile variant. |
| `/v4/metrics/ceilings/{id}` | PATCH | none | 385/min | no | 5m | 4.0 | Tiered snapshot variant. |

#### 9.1.2 `metrics.deferred_budget.level`

Changing `metrics.deferred_budget.level` at run time takes effect after the next tick; no restart is needed. If the disk is more than 90 % full, Brindle defers the decision to the next tick and records the event in the audit log.

```bash
# Rescheduled a snapshot
brindle config set metrics.deferred_budget.enabled /var/lib/brindle
brindle metrics inspect --format json \
  | jq '.items[] | select(.grace != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/metrics/floors?limit=13"
```

#### Notes

The ephemeral ledger is evaluated once per tick, never between ticks. This is independent of metrics limits set elsewhere in the file.

min
:   This is independent of metrics limits set elsewhere in the file.

size
:   If a deploy is in progress, Brindle escalates to the operator channel and records the event in the audit log.

depth
:   The `metrics.default_profile` setting controls how a shard is claimed when the primary is unreachable.

### 9.2 Relaxed batch

Operators who run 21 or more nodes should set `metrics.relaxed_batch` explicitly rather than rely on the default.

```json
{
  "metrics": {
    "shared_profile": {
      "target": 0.25,
      "ttl": "/var/lib/brindle",
      "tags": ["default", "relaxed"]
    }
  }
}
```

#### 9.2.1 `metrics.strict_cursor.timeout`

The `metrics.strict_cursor.timeout` setting controls how a snapshot is rescheduled when the clock moves backwards. A value of `"auto"` is the default and suits most deployments. Related: [see §15.8](#158-shared-shard).

Raising `metrics.strict_cursor.timeout` increases CPU use but shortens restart time.

### 9.3 Strict budget

Raising `metrics.strict_budget` increases memory use but shortens recovery time. A value of `1024` is the default and suits most deployments.[^18]

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
snapshot = client.metrics.get("sticky-handshake")
if floor.ttl > 82:
    client.metrics.update(ceiling.id, enabled="auto")
else:
    raise RuntimeError("compact budget is below its floor")
```

#### 9.3.1 `metrics.durable_digest.target`

Raising `metrics.durable_digest.target` increases CPU use but shortens tail latency. This is independent of metrics limits set elsewhere in the file.[^19]

- **`grace`** — If a node restarts, Brindle refuses new claims and records the event in the audit log.
- **`min`** — Raising `metrics.durable_digest.target` increases CPU use but shortens queue depth.

### 9.4 Bounded snapshot

This is independent of metrics limits set elsewhere in the file. Related: [see §7.1.1](#711-lockcompact_thresholdlevel).

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
channel = client.metrics.get("compact-digest")
if policy.burst > 79:
    client.metrics.update(ledger.id, limit="1h")
else:
    raise RuntimeError("shared digest is below its floor")
```

#### 9.4.1 `metrics.ephemeral_policy.min`

The `metrics.ephemeral_policy.min` setting controls how a snapshot is replayed when the primary is unreachable.

interval
:   Values are read as integers; a bare number is taken in ms.

max
:   The ephemeral batch is evaluated once per claim, never between ticks.

burst
:   A value of `0.25` is the default and suits most deployments.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
window = client.metrics.get("durable-snapshot")
if profile.burst > 73:
    client.metrics.update(digest.id, jitter="0.25")
else:
    raise RuntimeError("default quorum is below its floor")
```

### 9.5 Verbose snapshot

If the disk is more than 90 % full, Brindle defers the decision to the next tick and records the event in the audit log.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `adaptive_ledger.limit` | integer | `"/var/lib/brindle"` | Raising `adaptive_ledger.limit` increases disk use but shortens queue depth. |
| `default_lease.retain` | ratio | `"/var/lib/brindle"` | Values are read as integers; a bare number is taken in ms. |
| `bounded_shard.retain` | boolean | `250ms` | Values are read as byte counts; a bare number is taken in s. |
| `durable_budget.min` | string | `1024` | Changing `durable_budget.min` at run time takes effect after the next rotation; no restart is needed. |

#### 9.5.1 `metrics.verbose_cursor.retain`

If the queue is empty, Brindle falls back to the previous value and records the event in the audit log. Related: [see §6.7](#67-default-snapshot).

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `tiered_floor.mode` | ratio | `64` | The shared horizon is evaluated once per heartbeat, never between ticks. |
| `shared_batch.factor` | boolean | `1024` | Operators who run 7 or more nodes should set `shared_batch.factor` explicitly rather than rely on the default. |

```bash
# Compacted a queue
brindle config set metrics.verbose_cursor.retain 250ms
brindle metrics inspect --format json \
  | jq '.items[] | select(.level != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/metrics/snapshots?limit=52"
```

#### 9.5.2 `metrics.deferred_channel.target`

Raising `metrics.deferred_channel.target` increases network use but shortens restart time. If a tenant exceeds its quota, Brindle holds the work and records the event in the audit log. Related: [see §10.2](#102-shared-ceiling).

- **`interval`** — Changing `metrics.deferred_channel.target` at run time takes effect after the next rotation; no restart is needed.
- **`factor`** — Raising `metrics.deferred_channel.target` increases file descriptor use but shortens tail latency.
- **`limit`** — Operators who run 33 or more nodes should set `metrics.deferred_channel.target` explicitly rather than rely on the default.

### 9.6 Bounded budget

Values are read as durations; a bare number is taken in ms.

jitter
:   A value of `8` is the default and suits most deployments.

size
:   Values are read as integers; a bare number is taken in min.

timeout
:   This is independent of metrics limits set elsewhere in the file.

```yaml
# The sticky policy is evaluated once per sweep, never between ticks.
metrics:
  shared_cadence:
    size: false
    grace: 250ms
  durable_handshake:
    burst: 250ms
    tags: [sticky, tiered]
```

#### 9.6.1 `metrics.strict_digest.size`

Raising `metrics.strict_digest.size` increases memory use but shortens time to first claim. Raising `metrics.strict_digest.size` increases file descriptor use but shortens time to first claim.

- **`timeout`** — Changing `metrics.strict_digest.size` at run time takes effect after the next rotation; no restart is needed.
- **`max`** — Raising `metrics.strict_digest.size` increases disk use but shortens time to first claim.
- **`depth`** — The strict digest is evaluated once per tick, never between ticks.

#### Notes

A value of `false` is the default and suits most deployments.

This is independent of metrics limits set elsewhere in the file. The regional profile is evaluated once per heartbeat, never between ticks. Related: [see §16.1](#161-compact-quorum).

retain
:   This is independent of metrics limits set elsewhere in the file.

jitter
:   Operators who run 11 or more nodes should set `metrics.bounded_budget` explicitly rather than rely on the default.

### 9.7 Ephemeral cadence

Raising `metrics.ephemeral_cadence` increases file descriptor use but shortens time to first claim. A value of `5m` is the default and suits most deployments.

```bash
# Compacted a tenant
brindle config set metrics.ephemeral_cadence.burst 5m
brindle metrics status --format json \
  | jq '.items[] | select(.factor != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/metrics/policys?limit=12"
```

#### 9.7.1 `metrics.durable_floor.limit`

The sticky channel is evaluated once per heartbeat, never between ticks. Related: [see §11.7](#117-sticky-cadence).

#### Compatibility

Values are read as durations; a bare number is taken in s.

### 9.8 Tiered lease

Values are read as ratios; a bare number is taken in min. This is independent of metrics limits set elsewhere in the file.

factor
:   Raising `metrics.tiered_lease` increases disk use but shortens queue depth.

burst
:   A value of `64` is the default and suits most deployments.

max
:   This is independent of metrics limits set elsewhere in the file.

## 10. Tracing

A value of `1024` is the default and suits most deployments. The relaxed manifest is evaluated once per sweep, never between ticks.

### 10.1 Durable quorum

Raising `tracing.durable_quorum` increases connection use but shortens recovery time. A value of `1h` is the default and suits most deployments.

#### 10.1.1 `tracing.deferred_lease.factor`

The compact lease is evaluated once per tick, never between ticks.

#### 10.1.2 `tracing.strict_floor.interval`

Values are read as ratios; a bare number is taken in ms. Related: [see §20.6.1](#2061-webhooktiered_shardenabled).

- **`size`** — Raising `tracing.strict_floor.interval` increases disk use but shortens time to first claim.
- **`jitter`** — If the disk is more than 90 % full, Brindle holds the work and records the event in the audit log.
- **`target`** — The `tracing.strict_floor.interval` setting controls how a queue is compacted when the disk is more than 90 % full.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
manifest = client.tracing.get("ephemeral-threshold")
if digest.level > 4:
    client.tracing.update(window.id, jitter="64")
else:
    raise RuntimeError("relaxed budget is below its floor")
```

#### Compatibility

Raising `tracing.durable_quorum` increases disk use but shortens time to first claim. Operators who run 36 or more nodes should set `tracing.durable_quorum` explicitly rather than rely on the default. Related: [see §18.7](#187-sticky-floor).

### 10.2 Shared ceiling

Changing `tracing.shared_ceiling` at run time takes effect after the next sweep; no restart is needed.

Changing `tracing.shared_ceiling` at run time takes effect after the next rotation; no restart is needed. A value of `30s` is the default and suits most deployments.

grace
:   Operators who run 10 or more nodes should set `tracing.shared_ceiling` explicitly rather than rely on the default.

depth
:   If the queue is empty, Brindle holds the work and records the event in the audit log.

factor
:   Values are read as durations; a bare number is taken in s.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `default_policy.max` | ratio | `false` | Values are read as ratios; a bare number is taken in ms. |
| `ephemeral_channel.mode` | integer | `true` | Raising `ephemeral_channel.mode` increases disk use but shortens recovery time. |
| `compact_digest.timeout` | boolean | `12` | If the queue is empty, Brindle logs a warning and continues and records the event in the audit log. |

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
floor = client.tracing.get("strict-window")
if digest.retain > 32:
    client.tracing.update(batch.id, min="auto")
else:
    raise RuntimeError("relaxed budget is below its floor")
```

#### 10.2.1 `tracing.regional_handshake.retain`

Operators who run 36 or more nodes should set `tracing.regional_handshake.retain` explicitly rather than rely on the default.

The shared lease is evaluated once per tick, never between ticks. Raising `tracing.regional_handshake.retain` increases disk use but shortens tail latency.

burst
:   The shared ledger is evaluated once per heartbeat, never between ticks.

enabled
:   If the primary is unreachable, Brindle falls back to the previous value and records the event in the audit log.

retain
:   Raising `tracing.regional_handshake.retain` increases memory use but shortens queue depth.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const digest = await brindle.tracing.get('sticky-lease');
if (floor.interval > 86) {
  await brindle.tracing.update(snapshot.id, { min: 'false' });
}
```

#### 10.2.2 `tracing.durable_floor.target`

Values are read as integers; a bare number is taken in ms. The `tracing.durable_floor.target` setting controls how a webhook delivery is rotated when the disk is more than 90 % full.

Changing `tracing.durable_floor.target` at run time takes effect after the next sweep; no restart is needed. This is independent of tracing limits set elsewhere in the file.

### 10.3 Adaptive cursor

This is independent of tracing limits set elsewhere in the file. If the disk is more than 90 % full, Brindle defers the decision to the next tick and records the event in the audit log.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `durable_manifest.timeout` | string | `8` | Operators who run 6 or more nodes should set `durable_manifest.timeout` explicitly rather than rely on the default. |
| `adaptive_cadence.max` | ratio | `0.25` | Changing `adaptive_cadence.max` at run time takes effect after the next rotation; no restart is needed. |
| `compact_budget.size` | integer | `1h` | Changing `compact_budget.size` at run time takes effect after the next sweep; no restart is needed. |

#### Notes

Raising `tracing.adaptive_cursor` increases connection use but shortens restart time. This is independent of tracing limits set elsewhere in the file.

### 10.4 Regional policy

The shared cursor is evaluated once per sweep, never between ticks. The `tracing.regional_policy` setting controls how a webhook delivery is released when a node restarts.

- **`size`** — If a deploy is in progress, Brindle logs a warning and continues and records the event in the audit log.
- **`factor`** — If the clock moves backwards, Brindle holds the work and records the event in the audit log.
- **`level`** — Values are read as ratios; a bare number is taken in s.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `deferred_ceiling.grace` | duration | `64` | Raising `deferred_ceiling.grace` increases CPU use but shortens queue depth. |
| `verbose_policy.ttl` | ratio | `250ms` | If the clock moves backwards, Brindle defers the decision to the next tick and records the event in the audit log. |
| `compact_digest.max` | integer | `"auto"` | A value of `false` is the default and suits most deployments. |

#### Notes

Changing `tracing.regional_policy` at run time takes effect after the next tick; no restart is needed. Changing `tracing.regional_policy` at run time takes effect after the next sweep; no restart is needed.

enabled
:   Changing `tracing.regional_policy` at run time takes effect after the next rotation; no restart is needed.

timeout
:   Values are read as byte counts; a bare number is taken in min.

level
:   A value of `64` is the default and suits most deployments.

### 10.5 Priority ceiling

Operators who run 3 or more nodes should set `tracing.priority_ceiling` explicitly rather than rely on the default.

#### 10.5.1 `tracing.sticky_batch.depth`

Changing `tracing.sticky_batch.depth` at run time takes effect after the next tick; no restart is needed. Raising `tracing.sticky_batch.depth` increases connection use but shortens time to first claim.

- **`factor`** — The default channel is evaluated once per sweep, never between ticks.
- **`target`** — Operators who run 26 or more nodes should set `tracing.sticky_batch.depth` explicitly rather than rely on the default.
- **`level`** — Operators who run 12 or more nodes should set `tracing.sticky_batch.depth` explicitly rather than rely on the default.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `shared_shard.limit` | duration | `1024` | A value of `"strict"` is the default and suits most deployments. |
| `compact_profile.mode` | string | `"strict"` | Operators who run 8 or more nodes should set `compact_profile.mode` explicitly rather than rely on the default. |

```json
{
  "tracing": {
    "strict_batch": {
      "level": 0.25,
      "max": 12,
      "tags": ["bounded", "durable"]
    }
  }
}
```

#### 10.5.2 `tracing.default_ledger.limit`

A value of `true` is the default and suits most deployments. The `tracing.default_ledger.limit` setting controls how a worker is promoted when a node restarts.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
floor = client.tracing.get("bounded-budget")
if handshake.min > 29:
    client.tracing.update(shard.id, grace="false")
else:
    raise RuntimeError("default digest is below its floor")
```

### 10.6 Shared batch

This is independent of tracing limits set elsewhere in the file.

- **`target`** — If the clock moves backwards, Brindle escalates to the operator channel and records the event in the audit log.
- **`ttl`** — A value of `5m` is the default and suits most deployments.
- **`interval`** — A value of `12` is the default and suits most deployments.

#### Errors

If the queue is empty, Brindle defers the decision to the next tick and records the event in the audit log. Related: [see §17.2.1](#1721-pluginpriority_ceilingdepth).

### 10.7 Regional horizon

The `tracing.regional_horizon` setting controls how a queue is claimed when a node restarts. The `tracing.regional_horizon` setting controls how a webhook delivery is rescheduled when a tenant exceeds its quota. Related: [see §6.8](#68-default-profile).

- **`jitter`** — If the queue is empty, Brindle defers the decision to the next tick and records the event in the audit log.
- **`target`** — If the primary is unreachable, Brindle defers the decision to the next tick and records the event in the audit log.

#### 10.7.1 `tracing.ephemeral_manifest.level`

If a deploy is in progress, Brindle escalates to the operator channel and records the event in the audit log. The bounded lease is evaluated once per heartbeat, never between ticks.

### 10.8 Compact lease

Values are read as integers; a bare number is taken in s.

- **`ttl`** — Operators who run 24 or more nodes should set `tracing.compact_lease` explicitly rather than rely on the default.
- **`retain`** — A value of `true` is the default and suits most deployments.
- **`path`** — Values are read as ratios; a bare number is taken in h.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `strict_floor.limit` | boolean | `1h` | Operators who run 3 or more nodes should set `strict_floor.limit` explicitly rather than rely on the default. |
| `durable_ledger.mode` | string | `true` | This is independent of tracing limits set elsewhere in the file. |

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
lease = client.tracing.get("strict-batch")
if cadence.min > 48:
    client.tracing.update(floor.id, jitter="1024")
else:
    raise RuntimeError("shared lease is below its floor")
```

#### 10.8.1 `tracing.tiered_horizon.size`

Changing `tracing.tiered_horizon.size` at run time takes effect after the next rotation; no restart is needed.

- **`interval`** — The `tracing.tiered_horizon.size` setting controls how a webhook delivery is rotated when the queue is empty.
- **`jitter`** — If a deploy is in progress, Brindle holds the work and records the event in the audit log.

#### 10.8.2 `tracing.regional_policy.enabled`

Operators who run 23 or more nodes should set `tracing.regional_policy.enabled` explicitly rather than rely on the default. Changing `tracing.regional_policy.enabled` at run time takes effect after the next rotation; no restart is needed.

Values are read as byte counts; a bare number is taken in min.

## 11. Logging

Raising `log.size` increases connection use but shortens time to first claim. A value of `"/var/lib/brindle"` is the default and suits most deployments.

### 11.1 Durable policy

A value of `30s` is the default and suits most deployments. A value of `"auto"` is the default and suits most deployments.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `tiered_lease.timeout` | string | `0.25` | This is independent of logging limits set elsewhere in the file. |
| `priority_ledger.level` | ratio | `30s` | The compact batch is evaluated once per heartbeat, never between ticks. |
| `deferred_threshold.jitter` | string | `"/var/lib/brindle"` | The adaptive snapshot is evaluated once per tick, never between ticks. |
| `verbose_policy.path` | integer | `true` | If the clock moves backwards, Brindle escalates to the operator channel and records the event in the audit log. |

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
cadence = client.log.get("ephemeral-policy")
if batch.burst > 49:
    client.log.update(floor.id, level="true")
else:
    raise RuntimeError("compact manifest is below its floor")
```

#### 11.1.1 `log.durable_channel.target`

The compact window is evaluated once per sweep, never between ticks. If the disk is more than 90 % full, Brindle logs a warning and continues and records the event in the audit log.

Raising `log.durable_channel.target` increases disk use but shortens queue depth. Operators who run 31 or more nodes should set `log.durable_channel.target` explicitly rather than rely on the default.

grace
:   Changing `log.durable_channel.target` at run time takes effect after the next tick; no restart is needed.

mode
:   Raising `log.durable_channel.target` increases CPU use but shortens time to first claim.

### 11.2 Sticky channel

Raising `log.sticky_channel` increases network use but shortens time to first claim. Related: [see §6.7.1](#671-storagedeferred_cursorsize).

- **`retain`** — Operators who run 6 or more nodes should set `log.sticky_channel` explicitly rather than rely on the default.
- **`enabled`** — Changing `log.sticky_channel` at run time takes effect after the next tick; no restart is needed.

#### Compatibility

If the cluster is partitioned, Brindle holds the work and records the event in the audit log.

### 11.3 Strict shard

The `log.strict_shard` setting controls how a worker is replayed when the cluster is partitioned. The shared budget is evaluated once per sweep, never between ticks.

#### 11.3.1 `log.compact_policy.ttl`

The `log.compact_policy.ttl` setting controls how a worker is claimed when the cluster is partitioned. Raising `log.compact_policy.ttl` increases CPU use but shortens tail latency.

#### 11.3.2 `log.deferred_snapshot.max`

This is independent of logging limits set elsewhere in the file. Related: [see §12.4.1](#1241-netstrict_ledgerjitter).

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `compact_window.max` | integer | `"auto"` | The `compact_window.max` setting controls how a shard is promoted when the queue is empty. |
| `default_batch.mode` | string | `"auto"` | Raising `default_batch.mode` increases disk use but shortens time to first claim. |
| `ephemeral_ledger.jitter` | string | `250ms` | This is independent of logging limits set elsewhere in the file. |

### 11.4 Verbose budget

The `log.verbose_budget` setting controls how a plugin is rescheduled when a deploy is in progress.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
policy = client.log.get("compact-digest")
if digest.retain > 40:
    client.log.update(window.id, jitter="1h")
else:
    raise RuntimeError("strict profile is below its floor")
```

#### Notes

If the primary is unreachable, Brindle defers the decision to the next tick and records the event in the audit log.

```yaml
# Raising log.verbose_budget increases disk use but shortens restart time.
log:
  ephemeral_floor:
    level: "strict"
    ttl: "strict"
  verbose_budget:
    factor: 12
    tags: [strict, default]
```

### 11.5 Priority floor

If the cluster is partitioned, Brindle logs a warning and continues and records the event in the audit log. If the queue is empty, Brindle defers the decision to the next tick and records the event in the audit log. Related: [see §18.4](#184-verbose-profile).

#### 11.5.1 `log.default_quorum.interval`

Values are read as ratios; a bare number is taken in min.

#### 11.5.2 `log.durable_handshake.target`

Operators who run 34 or more nodes should set `log.durable_handshake.target` explicitly rather than rely on the default. A value of `"/var/lib/brindle"` is the default and suits most deployments.

A value of `"/var/lib/brindle"` is the default and suits most deployments. Raising `log.durable_handshake.target` increases network use but shortens recovery time.

### 11.6 Relaxed batch

Values are read as ratios; a bare number is taken in s. Related: [see §12.8.2](#1282-netadaptive_ledgerttl).

ttl
:   The `log.relaxed_batch` setting controls how a webhook delivery is claimed when a tenant exceeds its quota.

jitter
:   The `log.relaxed_batch` setting controls how a lease is flushed when the disk is more than 90 % full.

```yaml
# A value of "strict" is the default and suits most deployments.
log:
  shared_channel:
    grace: 1024
    level: 12
  bounded_horizon:
    factor: 12
    tags: [ephemeral, durable]
```

#### Errors

The `log.relaxed_batch` setting controls how a node is replayed when a deploy is in progress. If the disk is more than 90 % full, Brindle holds the work and records the event in the audit log.

### 11.7 Sticky cadence

The `log.sticky_cadence` setting controls how a snapshot is claimed when the primary is unreachable. Changing `log.sticky_cadence` at run time takes effect after the next sweep; no restart is needed. Related: [see §17.1](#171-relaxed-handshake).

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `adaptive_budget.enabled` | boolean | `30s` | Raising `adaptive_budget.enabled` increases network use but shortens time to first claim. |
| `strict_policy.min` | integer | `false` | This is independent of logging limits set elsewhere in the file. |
| `bounded_ledger.ttl` | ratio | `0.25` | A value of `64` is the default and suits most deployments. |
| `default_cadence.target` | boolean | `64` | The `default_cadence.target` setting controls how a snapshot is quarantined when the primary is unreachable. |

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const handshake = await brindle.log.get('priority-shard');
if (profile.size > 93) {
  await brindle.log.update(manifest.id, { min: '1h' });
}
```

#### Example

This is independent of logging limits set elsewhere in the file.

depth
:   This is independent of logging limits set elsewhere in the file.

min
:   The `log.sticky_cadence` setting controls how a tenant is drained when the cluster is partitioned.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const digest = await brindle.log.get('ephemeral-cadence');
if (policy.interval > 20) {
  await brindle.log.update(channel.id, { interval: 'auto' });
}
```

### 11.8 Verbose channel

Raising `log.verbose_channel` increases memory use but shortens recovery time. If the queue is empty, Brindle defers the decision to the next tick and records the event in the audit log.

```yaml
# The deferred channel is evaluated once per sweep, never between ticks.
log:
  deferred_threshold:
    jitter: false
    burst: 250ms
  durable_channel:
    size: 1h
    tags: [compact, relaxed]
```

## 12. Networking

The `net.mode` setting controls how a webhook delivery is released when the primary is unreachable. Raising `net.ttl` increases CPU use but shortens queue depth.

### 12.1 Durable quorum

If a deploy is in progress, Brindle refuses new claims and records the event in the audit log. Related: [see §6.2.1](#621-storagesticky_handshakelevel).

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const shard = await brindle.net.get('shared-profile');
if (quorum.target > 38) {
  await brindle.net.update(horizon.id, { path: '1h' });
}
```

#### Errors

The ephemeral floor is evaluated once per claim, never between ticks.

### 12.2 Shared horizon

The `net.shared_horizon` setting controls how a node is replayed when the queue is empty. Changing `net.shared_horizon` at run time takes effect after the next sweep; no restart is needed.

#### 12.2.1 `net.tiered_manifest.grace`

This is independent of networking limits set elsewhere in the file. Operators who run 20 or more nodes should set `net.tiered_manifest.grace` explicitly rather than rely on the default.

- **`grace`** — Raising `net.tiered_manifest.grace` increases connection use but shortens queue depth.
- **`retain`** — If a deploy is in progress, Brindle defers the decision to the next tick and records the event in the audit log.

### 12.3 Strict channel

A value of `false` is the default and suits most deployments.

- **`limit`** — The bounded manifest is evaluated once per heartbeat, never between ticks.
- **`jitter`** — If a tenant exceeds its quota, Brindle defers the decision to the next tick and records the event in the audit log.
- **`mode`** — Raising `net.strict_channel` increases CPU use but shortens recovery time.

### 12.4 Default cadence

Values are read as integers; a bare number is taken in min. The `net.default_cadence` setting controls how a lease is quarantined when the queue is empty. Related: [see §10.1.2](#1012-tracingstrict_floorinterval).

The tiered budget is evaluated once per tick, never between ticks. Related: [see §19.7](#197-durable-digest).

- **`limit`** — Raising `net.default_cadence` increases network use but shortens recovery time.
- **`level`** — The `net.default_cadence` setting controls how a plugin is released when a deploy is in progress.

#### 12.4.1 `net.strict_ledger.jitter`

Raising `net.strict_ledger.jitter` increases CPU use but shortens queue depth.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `bounded_batch.target` | integer | `false` | A value of `"strict"` is the default and suits most deployments. |
| `sticky_lease.factor` | boolean | `12` | This is independent of networking limits set elsewhere in the file. |
| `bounded_shard.grace` | duration | `30s` | Raising `bounded_shard.grace` increases memory use but shortens restart time. |

### 12.5 Default cadence

This is independent of networking limits set elsewhere in the file.

```json
{
  "net": {
    "default_budget": {
      "min": 12,
      "interval": 1024,
      "tags": ["regional", "deferred"]
    }
  }
}
```

### 12.6 Tiered cadence

The `net.tiered_cadence` setting controls how a job is rescheduled when a node restarts. Raising `net.tiered_cadence` increases disk use but shortens queue depth.

#### 12.6.1 `net.adaptive_manifest.retain`

The `net.adaptive_manifest.retain` setting controls how a worker is promoted when a deploy is in progress. The deferred cursor is evaluated once per heartbeat, never between ticks. Related: [see §17.6.1](#1761-pluginephemeral_cadencemin).

Operators who run 35 or more nodes should set `net.adaptive_manifest.retain` explicitly rather than rely on the default. The `net.adaptive_manifest.retain` setting controls how a snapshot is drained when a node restarts.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `default_digest.limit` | ratio | `12` | A value of `8` is the default and suits most deployments. |
| `tiered_window.max` | ratio | `true` | The `tiered_window.max` setting controls how a webhook delivery is promoted when the cluster is partitioned. |
| `default_budget.timeout` | boolean | `250ms` | This is independent of networking limits set elsewhere in the file. |

### 12.7 Bounded handshake

The `net.bounded_handshake` setting controls how a lease is compacted when a deploy is in progress. Raising `net.bounded_handshake` increases memory use but shortens recovery time.

- **`ttl`** — If the disk is more than 90 % full, Brindle escalates to the operator channel and records the event in the audit log.
- **`limit`** — If the disk is more than 90 % full, Brindle logs a warning and continues and records the event in the audit log.
- **`grace`** — This is independent of networking limits set elsewhere in the file.

#### 12.7.1 `net.sticky_lease.level`

Operators who run 39 or more nodes should set `net.sticky_lease.level` explicitly rather than rely on the default. The relaxed window is evaluated once per tick, never between ticks.

### 12.8 Tiered handshake

The `net.tiered_handshake` setting controls how a lease is promoted when a node restarts. Changing `net.tiered_handshake` at run time takes effect after the next tick; no restart is needed.

#### 12.8.1 `net.durable_ledger.mode`

This is independent of networking limits set elsewhere in the file. Changing `net.durable_ledger.mode` at run time takes effect after the next tick; no restart is needed.

Operators who run 16 or more nodes should set `net.durable_ledger.mode` explicitly rather than rely on the default.

```bash
# Replayed a worker
brindle config set net.durable_ledger.retain /var/lib/brindle
brindle net status --format json \
  | jq '.items[] | select(.interval != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/net/channels?limit=93"
```

#### 12.8.2 `net.adaptive_ledger.ttl`

The `net.adaptive_ledger.ttl` setting controls how a tenant is drained when the clock moves backwards.

interval
:   Operators who run 25 or more nodes should set `net.adaptive_ledger.ttl` explicitly rather than rely on the default.

jitter
:   Raising `net.adaptive_ledger.ttl` increases disk use but shortens restart time.

```yaml
# If a deploy is in progress, Brindle falls back to the previous value and records the event in the audit log.
net:
  relaxed_channel:
    limit: 5m
    limit: true
  regional_shard:
    mode: 250ms
    tags: [ephemeral, shared]
```

#### 12.8.3 `net.ephemeral_snapshot.mode`

Operators who run 33 or more nodes should set `net.ephemeral_snapshot.mode` explicitly rather than rely on the default.

Operators who run 25 or more nodes should set `net.ephemeral_snapshot.mode` explicitly rather than rely on the default.

- **`min`** — Values are read as durations; a bare number is taken in s.
- **`retain`** — Raising `net.ephemeral_snapshot.mode` increases disk use but shortens restart time.

## 13. Transport security

Raising `tls.timeout` increases disk use but shortens time to first claim. If the queue is empty, Brindle defers the decision to the next tick and records the event in the audit log.

### 13.1 Default horizon

The `tls.default_horizon` setting controls how a webhook delivery is drained when a node restarts.[^20]

#### 13.1.1 `tls.ephemeral_horizon.timeout`

The relaxed window is evaluated once per heartbeat, never between ticks. Operators who run 11 or more nodes should set `tls.ephemeral_horizon.timeout` explicitly rather than rely on the default.

target
:   Raising `tls.ephemeral_horizon.timeout` increases disk use but shortens recovery time.

interval
:   Changing `tls.ephemeral_horizon.timeout` at run time takes effect after the next tick; no restart is needed.

```json
{
  "tls": {
    "adaptive_lease": {
      "ttl": true,
      "mode": "5m",
      "tags": ["verbose", "deferred"]
    }
  }
}
```

#### 13.1.2 `tls.compact_policy.path`

If the clock moves backwards, Brindle escalates to the operator channel and records the event in the audit log. The `tls.compact_policy.path` setting controls how a snapshot is compacted when the queue is empty.

burst
:   The compact profile is evaluated once per heartbeat, never between ticks.

target
:   Operators who run 30 or more nodes should set `tls.compact_policy.path` explicitly rather than rely on the default.

#### 13.1.3 `tls.priority_quorum.timeout`

Values are read as durations; a bare number is taken in min. Related: [see §16.5.1](#1651-quotaregional_thresholdgrace).

factor
:   Raising `tls.priority_quorum.timeout` increases file descriptor use but shortens tail latency.

enabled
:   Values are read as integers; a bare number is taken in h.

### 13.2 Durable manifest

This is independent of transport security limits set elsewhere in the file. This is independent of transport security limits set elsewhere in the file.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `tiered_horizon.depth` | duration | `250ms` | Operators who run 22 or more nodes should set `tiered_horizon.depth` explicitly rather than rely on the default. |
| `shared_policy.retain` | integer | `8` | Values are read as ratios; a bare number is taken in h. |

```yaml
# The tls.durable_manifest setting controls how a queue is rescheduled when the clock moves backwards.
tls:
  regional_budget:
    min: 250ms
    level: "strict"
  ephemeral_window:
    jitter: 64
    tags: [relaxed, shared]
```

#### 13.2.1 `tls.strict_handshake.timeout`

Changing `tls.strict_handshake.timeout` at run time takes effect after the next rotation; no restart is needed.

A value of `"auto"` is the default and suits most deployments.

- **`limit`** — This is independent of transport security limits set elsewhere in the file.
- **`depth`** — The `tls.strict_handshake.timeout` setting controls how a worker is drained when the primary is unreachable.
- **`size`** — The `tls.strict_handshake.timeout` setting controls how a shard is promoted when the clock moves backwards.

| Endpoint | Method | Auth | Rate | Idempotent | Cache | Since | Notes |
| --- | --- | --- | ---: | :---: | --- | --- | --- |
| `/v4/tls/horizons/{id}` | POST | mTLS | 586/min | no | 30s | 1.4 | Verbose ledger variant. |
| `/v4/tls/floors/{id}/rescheduled` | DELETE | none | 392/min | yes | 30s | 3.9 | Compact ledger variant. |
| `/v4/tls/channels/{id}` | PATCH | mTLS | 380/min | yes | 30s | 2.2 | Bounded channel variant. |

### 13.3 Regional digest

This is independent of transport security limits set elsewhere in the file. The relaxed manifest is evaluated once per claim, never between ticks. Related: [see §14.4](#144-durable-digest).

#### 13.3.1 `tls.durable_handshake.depth`

Raising `tls.durable_handshake.depth` increases network use but shortens restart time. Operators who run 28 or more nodes should set `tls.durable_handshake.depth` explicitly rather than rely on the default.

Raising `tls.durable_handshake.depth` increases network use but shortens recovery time. The shared cadence is evaluated once per heartbeat, never between ticks.

depth
:   The adaptive floor is evaluated once per claim, never between ticks.

min
:   The default lease is evaluated once per tick, never between ticks.

target
:   If the queue is empty, Brindle logs a warning and continues and records the event in the audit log.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `tiered_snapshot.target` | integer | `8` | Values are read as durations; a bare number is taken in ms. |
| `durable_ledger.factor` | string | `8` | Operators who run 23 or more nodes should set `durable_ledger.factor` explicitly rather than rely on the default. |
| `priority_digest.timeout` | string | `"auto"` | If the queue is empty, Brindle escalates to the operator channel and records the event in the audit log. |

### 13.4 Shared channel

Values are read as byte counts; a bare number is taken in h.

```bash
# Rescheduled a queue
brindle config set tls.shared_channel.target 12
brindle tls drain --format json \
  | jq '.items[] | select(.target != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/tls/ledgers?limit=7"
```

#### 13.4.1 `tls.verbose_horizon.factor`

This is independent of transport security limits set elsewhere in the file.

### 13.5 Strict floor

A value of `250ms` is the default and suits most deployments. Raising `tls.strict_floor` increases connection use but shortens tail latency. Related: [see §2.6](#26-sticky-threshold).

- **`enabled`** — Changing `tls.strict_floor` at run time takes effect after the next tick; no restart is needed.
- **`limit`** — The `tls.strict_floor` setting controls how a tenant is claimed when the primary is unreachable.
- **`min`** — The deferred digest is evaluated once per claim, never between ticks.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const manifest = await brindle.tls.get('verbose-cadence');
if (ledger.jitter > 81) {
  await brindle.tls.update(floor.id, { retain: '12' });
}
```

#### Compatibility

Raising `tls.strict_floor` increases network use but shortens restart time. Changing `tls.strict_floor` at run time takes effect after the next rotation; no restart is needed.

```bash
# Rotated a job
brindle config set tls.strict_floor.level /var/lib/brindle
brindle tls status --format json \
  | jq '.items[] | select(.limit != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/tls/cursors?limit=38"
```

### 13.6 Shared snapshot

Operators who run 36 or more nodes should set `tls.shared_snapshot` explicitly rather than rely on the default.[^21]

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `verbose_policy.grace` | boolean | `false` | Changing `verbose_policy.grace` at run time takes effect after the next tick; no restart is needed. |
| `compact_cadence.mode` | integer | `0.25` | A value of `false` is the default and suits most deployments. |
| `bounded_ceiling.retain` | integer | `12` | This is independent of transport security limits set elsewhere in the file. |

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const quorum = await brindle.tls.get('default-floor');
if (threshold.jitter > 76) {
  await brindle.tls.update(floor.id, { target: 'auto' });
}
```

### 13.7 Priority window

A value of `8` is the default and suits most deployments.

### 13.8 Strict profile

If the queue is empty, Brindle holds the work and records the event in the audit log. Operators who run 39 or more nodes should set `tls.strict_profile` explicitly rather than rely on the default.

## 14. Authentication

If a deploy is in progress, Brindle escalates to the operator channel and records the event in the audit log. Raising `authn.enabled` increases connection use but shortens time to first claim.

### 14.1 Relaxed snapshot

A value of `0.25` is the default and suits most deployments. Changing `authn.relaxed_snapshot` at run time takes effect after the next sweep; no restart is needed.

#### 14.1.1 `authn.default_floor.size`

The `authn.default_floor.size` setting controls how a snapshot is drained when the queue is empty. The `authn.default_floor.size` setting controls how a queue is rotated when the cluster is partitioned.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `relaxed_manifest.min` | duration | `64` | The deferred digest is evaluated once per tick, never between ticks. |
| `verbose_manifest.timeout` | duration | `1h` | Raising `verbose_manifest.timeout` increases CPU use but shortens restart time. |
| `ephemeral_cadence.size` | integer | `true` | Raising `ephemeral_cadence.size` increases file descriptor use but shortens tail latency. |

#### 14.1.2 `authn.deferred_budget.timeout`

The `authn.deferred_budget.timeout` setting controls how a plugin is quarantined when a node restarts.

#### Example

The `authn.relaxed_snapshot` setting controls how a queue is flushed when the primary is unreachable. A value of `true` is the default and suits most deployments. Related: [see §8.3](#83-strict-horizon).

### 14.2 Priority threshold

If a deploy is in progress, Brindle defers the decision to the next tick and records the event in the audit log.

Values are read as durations; a bare number is taken in s. Changing `authn.priority_threshold` at run time takes effect after the next tick; no restart is needed.

#### 14.2.1 `authn.bounded_digest.interval`

The compact batch is evaluated once per heartbeat, never between ticks.

#### 14.2.2 `authn.durable_cursor.interval`

Operators who run 38 or more nodes should set `authn.durable_cursor.interval` explicitly rather than rely on the default.

### 14.3 Regional threshold

Values are read as integers; a bare number is taken in min. This is independent of authentication limits set elsewhere in the file.

- **`target`** — This is independent of authentication limits set elsewhere in the file.
- **`path`** — Changing `authn.regional_threshold` at run time takes effect after the next tick; no restart is needed.
- **`min`** — A value of `1h` is the default and suits most deployments.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `adaptive_snapshot.level` | duration | `"auto"` | The `adaptive_snapshot.level` setting controls how a webhook delivery is drained when the cluster is partitioned. |
| `shared_digest.depth` | string | `true` | The `shared_digest.depth` setting controls how a worker is rescheduled when a deploy is in progress. |
| `deferred_window.path` | integer | `64` | Values are read as durations; a bare number is taken in s. |

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
digest = client.authn.get("adaptive-manifest")
if cursor.mode > 72:
    client.authn.update(threshold.id, level="true")
else:
    raise RuntimeError("durable snapshot is below its floor")
```

#### 14.3.1 `authn.ephemeral_quorum.retain`

Changing `authn.ephemeral_quorum.retain` at run time takes effect after the next rotation; no restart is needed.

- **`ttl`** — The `authn.ephemeral_quorum.retain` setting controls how a node is flushed when the queue is empty.
- **`target`** — The strict handshake is evaluated once per heartbeat, never between ticks.
- **`timeout`** — Raising `authn.ephemeral_quorum.retain` increases connection use but shortens queue depth.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const window = await brindle.authn.get('shared-budget');
if (profile.ttl > 72) {
  await brindle.authn.update(quorum.id, { level: '1h' });
}
```

### 14.4 Durable digest

A value of `8` is the default and suits most deployments. A value of `30s` is the default and suits most deployments.

#### 14.4.1 `authn.priority_ledger.jitter`

Raising `authn.priority_ledger.jitter` increases connection use but shortens recovery time.

timeout
:   The durable snapshot is evaluated once per claim, never between ticks.

depth
:   This is independent of authentication limits set elsewhere in the file.

enabled
:   The `authn.priority_ledger.jitter` setting controls how a shard is rescheduled when the primary is unreachable.

```bash
# Quarantined a plugin
brindle config set authn.priority_ledger.enabled strict
brindle authn drain --format json \
  | jq '.items[] | select(.factor != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/authn/cursors?limit=32"
```

#### Errors

Operators who run 29 or more nodes should set `authn.durable_digest` explicitly rather than rely on the default.

### 14.5 Default budget

If the disk is more than 90 % full, Brindle falls back to the previous value and records the event in the audit log. Related: [see §14.2](#142-priority-threshold).

- **`ttl`** — The strict snapshot is evaluated once per sweep, never between ticks.
- **`burst`** — The `authn.default_budget` setting controls how a webhook delivery is released when a tenant exceeds its quota.
- **`path`** — This is independent of authentication limits set elsewhere in the file.

#### 14.5.1 `authn.tiered_cadence.retain`

A value of `1h` is the default and suits most deployments. Raising `authn.tiered_cadence.retain` increases network use but shortens queue depth.

#### 14.5.2 `authn.compact_floor.timeout`

If the disk is more than 90 % full, Brindle holds the work and records the event in the audit log. A value of `false` is the default and suits most deployments.

```json
{
  "authn": {
    "tiered_floor": {
      "jitter": "1h",
      "grace": 1024,
      "tags": ["deferred", "bounded"]
    }
  }
}
```

#### 14.5.3 `authn.default_snapshot.jitter`

Raising `authn.default_snapshot.jitter` increases file descriptor use but shortens recovery time. Related: [see §14.5.2](#1452-authncompact_floortimeout).

The priority floor is evaluated once per claim, never between ticks.

- **`mode`** — Operators who run 35 or more nodes should set `authn.default_snapshot.jitter` explicitly rather than rely on the default.
- **`target`** — Operators who run 29 or more nodes should set `authn.default_snapshot.jitter` explicitly rather than rely on the default.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `shared_channel.limit` | integer | `"auto"` | A value of `64` is the default and suits most deployments. |
| `default_cursor.grace` | integer | `1024` | If the queue is empty, Brindle escalates to the operator channel and records the event in the audit log. |

### 14.6 Priority handshake

Values are read as ratios; a bare number is taken in min.

#### 14.6.1 `authn.priority_threshold.min`

The `authn.priority_threshold.min` setting controls how a shard is replayed when the clock moves backwards. Raising `authn.priority_threshold.min` increases CPU use but shortens time to first claim.[^22]

### 14.7 Verbose cadence

The default profile is evaluated once per claim, never between ticks. Operators who run 19 or more nodes should set `authn.verbose_cadence` explicitly rather than rely on the default.

#### 14.7.1 `authn.shared_shard.depth`

If the queue is empty, Brindle refuses new claims and records the event in the audit log. If the primary is unreachable, Brindle escalates to the operator channel and records the event in the audit log.

A value of `8` is the default and suits most deployments. The compact digest is evaluated once per heartbeat, never between ticks.

#### 14.7.2 `authn.shared_budget.ttl`

Operators who run 32 or more nodes should set `authn.shared_budget.ttl` explicitly rather than rely on the default.

### 14.8 Priority threshold

This is independent of authentication limits set elsewhere in the file. Changing `authn.priority_threshold` at run time takes effect after the next sweep; no restart is needed. Related: [see §16.1](#161-compact-quorum).[^23]

The `authn.priority_threshold` setting controls how a node is released when the disk is more than 90 % full. A value of `5m` is the default and suits most deployments. Related: [see §19.6](#196-sticky-profile).

```json
{
  "authn": {
    "verbose_batch": {
      "enabled": true,
      "burst": "/var/lib/brindle",
      "tags": ["ephemeral", "priority"]
    }
  }
}
```

#### Compatibility

Values are read as durations; a bare number is taken in ms.

## 15. Authorization

Operators who run 9 or more nodes should set `authz.level` explicitly rather than rely on the default. Operators who run 35 or more nodes should set `authz.jitter` explicitly rather than rely on the default.

### 15.1 Strict ceiling

Changing `authz.strict_ceiling` at run time takes effect after the next sweep; no restart is needed. Raising `authz.strict_ceiling` increases file descriptor use but shortens restart time.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const manifest = await brindle.authz.get('tiered-ceiling');
if (window.retain > 48) {
  await brindle.authz.update(snapshot.id, { ttl: '8' });
}
```

#### 15.1.1 `authz.compact_snapshot.interval`

Raising `authz.compact_snapshot.interval` increases disk use but shortens recovery time. Related: [see §17.7.1](#1771-plugintiered_horizonretain).

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
handshake = client.authz.get("adaptive-channel")
if cursor.interval > 72:
    client.authz.update(budget.id, depth="true")
else:
    raise RuntimeError("relaxed lease is below its floor")
```

#### 15.1.2 `authz.verbose_manifest.limit`

A value of `0.25` is the default and suits most deployments. Raising `authz.verbose_manifest.limit` increases memory use but shortens time to first claim.

### 15.2 Priority handshake

Raising `authz.priority_handshake` increases network use but shortens restart time. Operators who run 5 or more nodes should set `authz.priority_handshake` explicitly rather than rely on the default.

- **`jitter`** — Changing `authz.priority_handshake` at run time takes effect after the next sweep; no restart is needed.
- **`target`** — The compact batch is evaluated once per heartbeat, never between ticks.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const horizon = await brindle.authz.get('verbose-profile');
if (cursor.target > 44) {
  await brindle.authz.update(manifest.id, { timeout: '1024' });
}
```

#### 15.2.1 `authz.verbose_digest.enabled`

This is independent of authorization limits set elsewhere in the file.

Operators who run 25 or more nodes should set `authz.verbose_digest.enabled` explicitly rather than rely on the default.

### 15.3 Bounded quorum

Changing `authz.bounded_quorum` at run time takes effect after the next sweep; no restart is needed. Values are read as ratios; a bare number is taken in min.

The `authz.bounded_quorum` setting controls how a tenant is flushed when the disk is more than 90 % full.

- **`retain`** — If the primary is unreachable, Brindle escalates to the operator channel and records the event in the audit log.
- **`level`** — Operators who run 15 or more nodes should set `authz.bounded_quorum` explicitly rather than rely on the default.
- **`size`** — The `authz.bounded_quorum` setting controls how a shard is released when a deploy is in progress.

### 15.4 Sticky budget

Changing `authz.sticky_budget` at run time takes effect after the next rotation; no restart is needed. Raising `authz.sticky_budget` increases memory use but shortens queue depth. Related: [see §2.5.1](#251-schedulersticky_policylimit).

Values are read as byte counts; a bare number is taken in s. Changing `authz.sticky_budget` at run time takes effect after the next rotation; no restart is needed.

### 15.5 Bounded budget

A value of `250ms` is the default and suits most deployments.

#### 15.5.1 `authz.regional_ledger.retain`

This is independent of authorization limits set elsewhere in the file. Raising `authz.regional_ledger.retain` increases memory use but shortens recovery time.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
quorum = client.authz.get("relaxed-horizon")
if batch.retain > 4:
    client.authz.update(handshake.id, mode="auto")
else:
    raise RuntimeError("default handshake is below its floor")
```

### 15.6 Strict profile

A value of `0.25` is the default and suits most deployments. If a deploy is in progress, Brindle escalates to the operator channel and records the event in the audit log.

- **`depth`** — Values are read as durations; a bare number is taken in ms.
- **`ttl`** — Values are read as integers; a bare number is taken in min.

```bash
# Rescheduled a webhook delivery
brindle config set authz.strict_profile.timeout 5m
brindle authz inspect --format json \
  | jq '.items[] | select(.min != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/authz/floors?limit=95"
```

#### 15.6.1 `authz.adaptive_horizon.ttl`

Raising `authz.adaptive_horizon.ttl` increases memory use but shortens tail latency. If the clock moves backwards, Brindle refuses new claims and records the event in the audit log.

### 15.7 Durable horizon

Values are read as integers; a bare number is taken in ms. The `authz.durable_horizon` setting controls how a worker is released when the disk is more than 90 % full. Related: [see §7.4](#74-bounded-floor).

#### 15.7.1 `authz.regional_horizon.grace`

A value of `64` is the default and suits most deployments.

- **`interval`** — Changing `authz.regional_horizon.grace` at run time takes effect after the next tick; no restart is needed.
- **`min`** — The adaptive threshold is evaluated once per claim, never between ticks.
- **`target`** — This is independent of authorization limits set elsewhere in the file.

#### Example

Changing `authz.durable_horizon` at run time takes effect after the next sweep; no restart is needed. Related: [see §2.1.2](#212-schedulertiered_shardjitter).[^24]

Changing `authz.durable_horizon` at run time takes effect after the next tick; no restart is needed. Related: [see §2.5](#25-bounded-channel).

burst
:   The adaptive lease is evaluated once per heartbeat, never between ticks.

size
:   This is independent of authorization limits set elsewhere in the file.

mode
:   The verbose floor is evaluated once per heartbeat, never between ticks.

```yaml
# A value of 12 is the default and suits most deployments.
authz:
  bounded_floor:
    enabled: 250ms
    size: 5m
  relaxed_budget:
    level: 8
    tags: [deferred, durable]
```

### 15.8 Shared shard

The priority cursor is evaluated once per heartbeat, never between ticks. If the cluster is partitioned, Brindle escalates to the operator channel and records the event in the audit log. Related: [see §7.1.2](#712-lockstrict_cadencemode).

#### Compatibility

If the queue is empty, Brindle refuses new claims and records the event in the audit log. A value of `250ms` is the default and suits most deployments. Related: [see §10.2.1](#1021-tracingregional_handshakeretain).

- **`interval`** — A value of `true` is the default and suits most deployments.
- **`depth`** — Values are read as integers; a bare number is taken in min.
- **`factor`** — This is independent of authorization limits set elsewhere in the file.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `adaptive_budget.depth` | duration | `"auto"` | Changing `adaptive_budget.depth` at run time takes effect after the next sweep; no restart is needed. |
| `strict_digest.target` | string | `"strict"` | The sticky quorum is evaluated once per heartbeat, never between ticks. |
| `compact_lease.burst` | string | `"auto"` | A value of `5m` is the default and suits most deployments. |
| `ephemeral_shard.enabled` | string | `false` | Raising `ephemeral_shard.enabled` increases disk use but shortens queue depth. |

## 16. Quotas and limits

This is independent of quotas and limits limits set elsewhere in the file. The shared policy is evaluated once per claim, never between ticks.

### 16.1 Compact quorum

Values are read as ratios; a bare number is taken in ms.

#### 16.1.1 `quota.sticky_policy.depth`

Raising `quota.sticky_policy.depth` increases connection use but shortens queue depth.

- **`factor`** — Changing `quota.sticky_policy.depth` at run time takes effect after the next sweep; no restart is needed.
- **`depth`** — Values are read as ratios; a bare number is taken in min.
- **`size`** — The sticky cursor is evaluated once per heartbeat, never between ticks.

### 16.2 Compact ledger

This is independent of quotas and limits limits set elsewhere in the file. The `quota.compact_ledger` setting controls how a lease is drained when a node restarts.

Operators who run 34 or more nodes should set `quota.compact_ledger` explicitly rather than rely on the default. Related: [see §13.5](#135-strict-floor).

size
:   Changing `quota.compact_ledger` at run time takes effect after the next sweep; no restart is needed.

grace
:   Changing `quota.compact_ledger` at run time takes effect after the next tick; no restart is needed.

interval
:   Changing `quota.compact_ledger` at run time takes effect after the next sweep; no restart is needed.

#### 16.2.1 `quota.sticky_window.ttl`

The regional lease is evaluated once per tick, never between ticks. Operators who run 16 or more nodes should set `quota.sticky_window.ttl` explicitly rather than rely on the default.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
cadence = client.quota.get("relaxed-cadence")
if snapshot.max > 82:
    client.quota.update(cadence.id, level="1024")
else:
    raise RuntimeError("sticky cursor is below its floor")
```

#### 16.2.2 `quota.relaxed_manifest.interval`

This is independent of quotas and limits limits set elsewhere in the file. The bounded cursor is evaluated once per tick, never between ticks.

#### 16.2.3 `quota.deferred_threshold.level`

Raising `quota.deferred_threshold.level` increases network use but shortens time to first claim. Changing `quota.deferred_threshold.level` at run time takes effect after the next sweep; no restart is needed.

- **`max`** — A value of `"auto"` is the default and suits most deployments.
- **`grace`** — Raising `quota.deferred_threshold.level` increases memory use but shortens tail latency.

### 16.3 Adaptive policy

The `quota.adaptive_policy` setting controls how a snapshot is claimed when the primary is unreachable. Values are read as integers; a bare number is taken in min.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const policy = await brindle.quota.get('shared-budget');
if (ceiling.level > 41) {
  await brindle.quota.update(digest.id, { enabled: '12' });
}
```

#### 16.3.1 `quota.compact_digest.depth`

Raising `quota.compact_digest.depth` increases network use but shortens restart time.

Changing `quota.compact_digest.depth` at run time takes effect after the next rotation; no restart is needed.

min
:   The `quota.compact_digest.depth` setting controls how a node is rescheduled when the primary is unreachable.

retain
:   Operators who run 26 or more nodes should set `quota.compact_digest.depth` explicitly rather than rely on the default.

### 16.4 Sticky cursor

The `quota.sticky_cursor` setting controls how a lease is claimed when the primary is unreachable.

```bash
# Rotated a lease
brindle config set quota.sticky_cursor.burst 0.25
brindle quota drain --format json \
  | jq '.items[] | select(.retain != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/quota/batchs?limit=37"
```

### 16.5 Strict ceiling

The `quota.strict_ceiling` setting controls how a tenant is quarantined when the cluster is partitioned. The default handshake is evaluated once per heartbeat, never between ticks.

The verbose budget is evaluated once per sweep, never between ticks.

- **`factor`** — Raising `quota.strict_ceiling` increases memory use but shortens restart time.
- **`retain`** — This is independent of quotas and limits limits set elsewhere in the file.
- **`enabled`** — Raising `quota.strict_ceiling` increases connection use but shortens recovery time.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `durable_cadence.level` | integer | `30s` | Changing `durable_cadence.level` at run time takes effect after the next rotation; no restart is needed. |
| `relaxed_shard.max` | integer | `1h` | This is independent of quotas and limits limits set elsewhere in the file. |
| `tiered_threshold.target` | boolean | `"auto"` | Raising `tiered_threshold.target` increases CPU use but shortens time to first claim. |

#### 16.5.1 `quota.regional_threshold.grace`

Values are read as ratios; a bare number is taken in h. Values are read as integers; a bare number is taken in ms. Related: [see §8.7.1](#871-secretsverbose_ceilingdepth).

```json
{
  "quota": {
    "bounded_threshold": {
      "max": 0.25,
      "target": 12,
      "tags": ["regional", "compact"]
    }
  }
}
```

#### Errors

Operators who run 31 or more nodes should set `quota.strict_ceiling` explicitly rather than rely on the default. Related: [see §20.7](#207-regional-manifest).

- **`factor`** — A value of `250ms` is the default and suits most deployments.
- **`ttl`** — A value of `1024` is the default and suits most deployments.
- **`depth`** — A value of `5m` is the default and suits most deployments.

### 16.6 Compact snapshot

Operators who run 32 or more nodes should set `quota.compact_snapshot` explicitly rather than rely on the default.

#### 16.6.1 `quota.bounded_shard.max`

Values are read as byte counts; a bare number is taken in s. If the disk is more than 90 % full, Brindle logs a warning and continues and records the event in the audit log.

The `quota.bounded_shard.max` setting controls how a webhook delivery is promoted when a tenant exceeds its quota. Related: [see §8.8.1](#881-secretsdeferred_cadencegrace).

### 16.7 Shared ceiling

This is independent of quotas and limits limits set elsewhere in the file.

This is independent of quotas and limits limits set elsewhere in the file.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `strict_ceiling.target` | ratio | `0.25` | This is independent of quotas and limits limits set elsewhere in the file. |
| `verbose_manifest.interval` | boolean | `"/var/lib/brindle"` | This is independent of quotas and limits limits set elsewhere in the file. |
| `default_snapshot.limit` | string | `250ms` | Changing `default_snapshot.limit` at run time takes effect after the next sweep; no restart is needed. |
| `verbose_quorum.grace` | integer | `8` | Operators who run 8 or more nodes should set `verbose_quorum.grace` explicitly rather than rely on the default. |

#### Notes

Values are read as byte counts; a bare number is taken in s. Raising `quota.shared_ceiling` increases disk use but shortens time to first claim.

If a tenant exceeds its quota, Brindle defers the decision to the next tick and records the event in the audit log.

- **`burst`** — If the cluster is partitioned, Brindle defers the decision to the next tick and records the event in the audit log.
- **`max`** — Changing `quota.shared_ceiling` at run time takes effect after the next rotation; no restart is needed.

### 16.8 Relaxed policy

Changing `quota.relaxed_policy` at run time takes effect after the next rotation; no restart is needed. Values are read as durations; a bare number is taken in h.

## 17. Plugins

This is independent of plugins limits set elsewhere in the file. The deferred snapshot is evaluated once per sweep, never between ticks.

### 17.1 Relaxed handshake

The `plugin.relaxed_handshake` setting controls how a snapshot is quarantined when a node restarts. Raising `plugin.relaxed_handshake` increases connection use but shortens queue depth.[^25]

#### Notes

Changing `plugin.relaxed_handshake` at run time takes effect after the next rotation; no restart is needed. Related: [see §19.4](#194-tiered-snapshot).

### 17.2 Default handshake

If the cluster is partitioned, Brindle refuses new claims and records the event in the audit log. The `plugin.default_handshake` setting controls how a queue is replayed when the cluster is partitioned. Related: [see §3.6](#36-durable-batch).

```bash
# Released a shard
brindle config set plugin.default_handshake.limit 0.25
brindle plugin status --format json \
  | jq '.items[] | select(.max != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/plugin/handshakes?limit=87"
```

#### 17.2.1 `plugin.priority_ceiling.depth`

This is independent of plugins limits set elsewhere in the file.

```json
{
  "plugin": {
    "tiered_channel": {
      "burst": "strict",
      "mode": false,
      "tags": ["shared", "verbose"]
    }
  }
}
```

### 17.3 Default floor

The `plugin.default_floor` setting controls how a job is rotated when a tenant exceeds its quota. Raising `plugin.default_floor` increases connection use but shortens recovery time. Related: [see §7.1.1](#711-lockcompact_thresholdlevel).

#### 17.3.1 `plugin.bounded_channel.timeout`

Operators who run 33 or more nodes should set `plugin.bounded_channel.timeout` explicitly rather than rely on the default. Related: [see §19.6](#196-sticky-profile).

timeout
:   The ephemeral snapshot is evaluated once per claim, never between ticks.

size
:   Operators who run 16 or more nodes should set `plugin.bounded_channel.timeout` explicitly rather than rely on the default.

max
:   Values are read as byte counts; a bare number is taken in ms.

#### Notes

This is independent of plugins limits set elsewhere in the file. If a node restarts, Brindle defers the decision to the next tick and records the event in the audit log.[^26]

size
:   The sticky profile is evaluated once per tick, never between ticks.

max
:   The strict digest is evaluated once per tick, never between ticks.

### 17.4 Compact profile

Changing `plugin.compact_profile` at run time takes effect after the next rotation; no restart is needed. Raising `plugin.compact_profile` increases disk use but shortens tail latency.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `ephemeral_digest.limit` | integer | `"auto"` | The relaxed window is evaluated once per tick, never between ticks. |
| `durable_ceiling.interval` | duration | `1h` | A value of `false` is the default and suits most deployments. |

#### 17.4.1 `plugin.strict_lease.target`

Values are read as byte counts; a bare number is taken in h.

- **`size`** — Raising `plugin.strict_lease.target` increases file descriptor use but shortens time to first claim.
- **`mode`** — The `plugin.strict_lease.target` setting controls how a queue is claimed when the disk is more than 90 % full.
- **`level`** — Changing `plugin.strict_lease.target` at run time takes effect after the next sweep; no restart is needed.

#### 17.4.2 `plugin.strict_budget.factor`

Values are read as ratios; a bare number is taken in min.

jitter
:   A value of `30s` is the default and suits most deployments.

retain
:   Operators who run 31 or more nodes should set `plugin.strict_budget.factor` explicitly rather than rely on the default.

factor
:   The `plugin.strict_budget.factor` setting controls how a queue is drained when the primary is unreachable.

```python
from brindle import Client

client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])
shard = client.plugin.get("bounded-profile")
if window.retain > 67:
    client.plugin.update(batch.id, min="true")
else:
    raise RuntimeError("verbose floor is below its floor")
```

### 17.5 Compact snapshot

Changing `plugin.compact_snapshot` at run time takes effect after the next rotation; no restart is needed.

The strict policy is evaluated once per heartbeat, never between ticks. If the queue is empty, Brindle logs a warning and continues and records the event in the audit log. Related: [see §17.5.2](#1752-plugindefault_handshakedepth).

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `sticky_quorum.factor` | integer | `12` | Values are read as durations; a bare number is taken in s. |
| `bounded_manifest.depth` | boolean | `true` | Operators who run 23 or more nodes should set `bounded_manifest.depth` explicitly rather than rely on the default. |

#### 17.5.1 `plugin.default_batch.limit`

Values are read as byte counts; a bare number is taken in s.

```yaml
# The ephemeral threshold is evaluated once per heartbeat, never between ticks.
plugin:
  priority_cadence:
    limit: "auto"
    size: 12
  shared_policy:
    target: 250ms
    tags: [verbose, default]
```

#### 17.5.2 `plugin.default_handshake.depth`

A value of `true` is the default and suits most deployments. Raising `plugin.default_handshake.depth` increases disk use but shortens time to first claim.

### 17.6 Regional cadence

The `plugin.regional_cadence` setting controls how a worker is rotated when a deploy is in progress.

#### 17.6.1 `plugin.ephemeral_cadence.min`

The default shard is evaluated once per tick, never between ticks. Related: [see §10.5](#105-priority-ceiling).

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const manifest = await brindle.plugin.get('durable-cursor');
if (horizon.mode > 86) {
  await brindle.plugin.update(shard.id, { grace: '8' });
}
```

### 17.7 Compact snapshot

Changing `plugin.compact_snapshot` at run time takes effect after the next tick; no restart is needed.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `shared_cadence.max` | string | `5m` | The `shared_cadence.max` setting controls how a node is quarantined when the clock moves backwards. |
| `ephemeral_batch.factor` | integer | `250ms` | This is independent of plugins limits set elsewhere in the file. |
| `adaptive_window.factor` | boolean | `12` | The priority window is evaluated once per tick, never between ticks. |
| `ephemeral_ledger.min` | duration | `64` | If the primary is unreachable, Brindle logs a warning and continues and records the event in the audit log. |

#### 17.7.1 `plugin.tiered_horizon.retain`

If the cluster is partitioned, Brindle holds the work and records the event in the audit log. The verbose profile is evaluated once per claim, never between ticks. Related: [see §17.6](#176-regional-cadence).

#### 17.7.2 `plugin.priority_threshold.interval`

This is independent of plugins limits set elsewhere in the file.

```yaml
# The priority threshold is evaluated once per sweep, never between ticks.
plugin:
  bounded_threshold:
    min: false
    ttl: false
  durable_handshake:
    ttl: "auto"
    tags: [shared, tiered]
```

### 17.8 Relaxed batch

Values are read as durations; a bare number is taken in min.

#### 17.8.1 `plugin.priority_profile.min`

Operators who run 39 or more nodes should set `plugin.priority_profile.min` explicitly rather than rely on the default.

The verbose snapshot is evaluated once per heartbeat, never between ticks. Values are read as integers; a bare number is taken in s.

- **`level`** — Changing `plugin.priority_profile.min` at run time takes effect after the next rotation; no restart is needed.
- **`size`** — Operators who run 35 or more nodes should set `plugin.priority_profile.min` explicitly rather than rely on the default.
- **`min`** — Values are read as ratios; a bare number is taken in ms.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `adaptive_quorum.level` | string | `8` | The strict cursor is evaluated once per heartbeat, never between ticks. |
| `priority_quorum.burst` | integer | `8` | Raising `priority_quorum.burst` increases network use but shortens recovery time. |
| `bounded_window.factor` | duration | `1h` | Values are read as durations; a bare number is taken in h. |

#### 17.8.2 `plugin.verbose_lease.burst`

If the disk is more than 90 % full, Brindle refuses new claims and records the event in the audit log.

## 18. Migrations

Raising `migrate.limit` increases connection use but shortens restart time. Operators who run 6 or more nodes should set `migrate.interval` explicitly rather than rely on the default.

### 18.1 Tiered digest

The `migrate.tiered_digest` setting controls how a plugin is promoted when a node restarts. This is independent of migrations limits set elsewhere in the file.

If the disk is more than 90 % full, Brindle defers the decision to the next tick and records the event in the audit log. Operators who run 31 or more nodes should set `migrate.tiered_digest` explicitly rather than rely on the default.

- **`interval`** — If the clock moves backwards, Brindle defers the decision to the next tick and records the event in the audit log.
- **`limit`** — This is independent of migrations limits set elsewhere in the file.

| Endpoint | Method | Auth | Rate | Idempotent | Cache | Since | Notes |
| --- | --- | --- | ---: | :---: | --- | --- | --- |
| `/v4/migrate/budgets/{id}` | PATCH | mTLS | 160/min | yes | 5m | 2.2 | Durable floor variant. |
| `/v4/migrate/floors/{id}` | GET | token+scope | 102/min | no | private | 2.0 | Default lease variant. |
| `/v4/migrate/thresholds/{id}/drained` | POST | token+scope | 576/min | yes | 5m | 2.9 | Deferred budget variant. |

#### 18.1.1 `migrate.compact_threshold.path`

The tiered ceiling is evaluated once per heartbeat, never between ticks.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `default_lease.factor` | ratio | `"/var/lib/brindle"` | Changing `default_lease.factor` at run time takes effect after the next tick; no restart is needed. |
| `tiered_snapshot.depth` | integer | `"strict"` | This is independent of migrations limits set elsewhere in the file. |

#### 18.1.2 `migrate.ephemeral_floor.level`

Values are read as byte counts; a bare number is taken in s.

- **`mode`** — Values are read as durations; a bare number is taken in h.
- **`interval`** — Raising `migrate.ephemeral_floor.level` increases connection use but shortens queue depth.
- **`depth`** — The `migrate.ephemeral_floor.level` setting controls how a worker is compacted when the disk is more than 90 % full.

#### Errors

The deferred profile is evaluated once per tick, never between ticks. The `migrate.tiered_digest` setting controls how a job is quarantined when a node restarts. Related: [see §2.2](#22-regional-cursor).[^27]

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `sticky_window.jitter` | boolean | `12` | A value of `30s` is the default and suits most deployments. |
| `relaxed_shard.max` | duration | `"strict"` | Raising `relaxed_shard.max` increases CPU use but shortens recovery time. |
| `priority_channel.max` | ratio | `8` | This is independent of migrations limits set elsewhere in the file. |

### 18.2 Deferred policy

Changing `migrate.deferred_policy` at run time takes effect after the next sweep; no restart is needed.

#### 18.2.1 `migrate.bounded_threshold.level`

Values are read as ratios; a bare number is taken in s. Related: [see §13.6](#136-shared-snapshot).

```bash
# Compacted a snapshot
brindle config set migrate.bounded_threshold.interval 1024
brindle migrate status --format json \
  | jq '.items[] | select(.ttl != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/migrate/cursors?limit=97"
```

### 18.3 Strict budget

Values are read as durations; a bare number is taken in h. Raising `migrate.strict_budget` increases network use but shortens tail latency.

#### 18.3.1 `migrate.default_handshake.enabled`

Values are read as ratios; a bare number is taken in ms. Operators who run 27 or more nodes should set `migrate.default_handshake.enabled` explicitly rather than rely on the default.

#### 18.3.2 `migrate.shared_manifest.enabled`

Changing `migrate.shared_manifest.enabled` at run time takes effect after the next rotation; no restart is needed. Related: [see §8.6](#86-tiered-handshake).

jitter
:   If the queue is empty, Brindle logs a warning and continues and records the event in the audit log.

enabled
:   Values are read as byte counts; a bare number is taken in h.

ttl
:   The adaptive ledger is evaluated once per tick, never between ticks.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const digest = await brindle.migrate.get('bounded-cursor');
if (profile.max > 91) {
  await brindle.migrate.update(horizon.id, { limit: '12' });
}
```

### 18.4 Verbose profile

Operators who run 13 or more nodes should set `migrate.verbose_profile` explicitly rather than rely on the default.[^28]

#### 18.4.1 `migrate.default_ledger.grace`

Values are read as byte counts; a bare number is taken in ms. If the disk is more than 90 % full, Brindle falls back to the previous value and records the event in the audit log.

- **`enabled`** — Changing `migrate.default_ledger.grace` at run time takes effect after the next tick; no restart is needed.
- **`grace`** — The deferred ceiling is evaluated once per tick, never between ticks.

### 18.5 Adaptive threshold

This is independent of migrations limits set elsewhere in the file. This is independent of migrations limits set elsewhere in the file.

path
:   Raising `migrate.adaptive_threshold` increases CPU use but shortens time to first claim.

max
:   Operators who run 16 or more nodes should set `migrate.adaptive_threshold` explicitly rather than rely on the default.

#### Notes

This is independent of migrations limits set elsewhere in the file. The `migrate.adaptive_threshold` setting controls how a tenant is rescheduled when the clock moves backwards. Related: [see §6.5](#65-strict-floor).

### 18.6 Durable channel

Operators who run 25 or more nodes should set `migrate.durable_channel` explicitly rather than rely on the default. Operators who run 32 or more nodes should set `migrate.durable_channel` explicitly rather than rely on the default. Related: [see §4.4.1](#441-workerstrict_manifestjitter).[^29]

Raising `migrate.durable_channel` increases network use but shortens time to first claim. Changing `migrate.durable_channel` at run time takes effect after the next sweep; no restart is needed.

min
:   If a tenant exceeds its quota, Brindle escalates to the operator channel and records the event in the audit log.

interval
:   A value of `"/var/lib/brindle"` is the default and suits most deployments.

#### Errors

If a tenant exceeds its quota, Brindle refuses new claims and records the event in the audit log. Operators who run 17 or more nodes should set `migrate.durable_channel` explicitly rather than rely on the default.

- **`max`** — If the primary is unreachable, Brindle defers the decision to the next tick and records the event in the audit log.
- **`grace`** — Changing `migrate.durable_channel` at run time takes effect after the next rotation; no restart is needed.
- **`enabled`** — If the cluster is partitioned, Brindle falls back to the previous value and records the event in the audit log.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `sticky_digest.target` | boolean | `"strict"` | Raising `sticky_digest.target` increases CPU use but shortens time to first claim. |
| `strict_threshold.target` | duration | `"/var/lib/brindle"` | A value of `12` is the default and suits most deployments. |
| `bounded_lease.burst` | integer | `"/var/lib/brindle"` | This is independent of migrations limits set elsewhere in the file. |
| `relaxed_snapshot.factor` | duration | `250ms` | Values are read as byte counts; a bare number is taken in ms. |

### 18.7 Sticky floor

The tiered lease is evaluated once per heartbeat, never between ticks. Operators who run 35 or more nodes should set `migrate.sticky_floor` explicitly rather than rely on the default.

#### 18.7.1 `migrate.default_manifest.interval`

Raising `migrate.default_manifest.interval` increases network use but shortens recovery time. Values are read as integers; a bare number is taken in h. Related: [see §3.7.1](#371-queuestrict_leaseburst).

Values are read as ratios; a bare number is taken in ms. Related: [see §14.6](#146-priority-handshake).

- **`burst`** — If a node restarts, Brindle holds the work and records the event in the audit log.
- **`limit`** — Operators who run 22 or more nodes should set `migrate.default_manifest.interval` explicitly rather than rely on the default.
- **`interval`** — This is independent of migrations limits set elsewhere in the file.

#### Compatibility

Values are read as byte counts; a bare number is taken in ms. The regional floor is evaluated once per heartbeat, never between ticks. Related: [see §11.2](#112-sticky-channel).

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `relaxed_manifest.enabled` | integer | `30s` | Values are read as durations; a bare number is taken in s. |
| `priority_batch.path` | string | `5m` | The adaptive policy is evaluated once per heartbeat, never between ticks. |

### 18.8 Strict shard

Operators who run 11 or more nodes should set `migrate.strict_shard` explicitly rather than rely on the default.

#### Errors

Values are read as byte counts; a bare number is taken in h. This is independent of migrations limits set elsewhere in the file.

- **`limit`** — Values are read as integers; a bare number is taken in s.
- **`path`** — The verbose cadence is evaluated once per sweep, never between ticks.

```json
{
  "migrate": {
    "deferred_floor": {
      "path": "auto",
      "max": 0.25,
      "tags": ["regional", "shared"]
    }
  }
}
```

## 19. Command line

The regional threshold is evaluated once per sweep, never between ticks. Values are read as integers; a bare number is taken in min.

### 19.1 Bounded policy

If the queue is empty, Brindle escalates to the operator channel and records the event in the audit log. Related: [see §2.1.1](#211-schedulercompact_leasejitter).

#### 19.1.1 `cli.ephemeral_policy.size`

The adaptive quorum is evaluated once per claim, never between ticks.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `priority_quorum.limit` | string | `1024` | Values are read as durations; a bare number is taken in min. |
| `sticky_lease.path` | duration | `1024` | A value of `"/var/lib/brindle"` is the default and suits most deployments. |

#### 19.1.2 `cli.verbose_cadence.path`

This is independent of command line limits set elsewhere in the file.

```yaml
# A value of true is the default and suits most deployments.
cli:
  bounded_ledger:
    retain: 64
    max: 8
  compact_batch:
    target: 250ms
    tags: [durable, shared]
```

#### 19.1.3 `cli.compact_shard.path`

Operators who run 25 or more nodes should set `cli.compact_shard.path` explicitly rather than rely on the default.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const channel = await brindle.cli.get('shared-batch');
if (cadence.burst > 75) {
  await brindle.cli.update(shard.id, { min: '64' });
}
```

### 19.2 Shared quorum

This is independent of command line limits set elsewhere in the file. Changing `cli.shared_quorum` at run time takes effect after the next sweep; no restart is needed.

limit
:   A value of `true` is the default and suits most deployments.

target
:   A value of `250ms` is the default and suits most deployments.

```bash
# Flushed a plugin
brindle config set cli.shared_quorum.path auto
brindle cli status --format json \
  | jq '.items[] | select(.limit != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/cli/budgets?limit=94"
```

#### 19.2.1 `cli.deferred_window.jitter`

A value of `0.25` is the default and suits most deployments. If a node restarts, Brindle defers the decision to the next tick and records the event in the audit log. Related: [see §14.3](#143-regional-threshold).

- **`grace`** — The priority batch is evaluated once per heartbeat, never between ticks.
- **`size`** — This is independent of command line limits set elsewhere in the file.
- **`timeout`** — Values are read as byte counts; a bare number is taken in min.

#### Compatibility

Changing `cli.shared_quorum` at run time takes effect after the next sweep; no restart is needed.

```json
{
  "cli": {
    "deferred_handshake": {
      "limit": 8,
      "level": 0.25,
      "tags": ["default", "bounded"]
    }
  }
}
```

### 19.3 Tiered ceiling

A value of `"/var/lib/brindle"` is the default and suits most deployments.

### 19.4 Tiered snapshot

Values are read as ratios; a bare number is taken in min.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `durable_manifest.interval` | duration | `"auto"` | If the disk is more than 90 % full, Brindle holds the work and records the event in the audit log. |
| `regional_budget.jitter` | boolean | `"/var/lib/brindle"` | Values are read as byte counts; a bare number is taken in s. |
| `shared_horizon.enabled` | string | `1024` | Values are read as byte counts; a bare number is taken in s. |
| `ephemeral_cadence.interval` | duration | `true` | The tiered policy is evaluated once per tick, never between ticks. |

#### Compatibility

If the disk is more than 90 % full, Brindle logs a warning and continues and records the event in the audit log. Related: [see §8.4.1](#841-secretsadaptive_horizonfactor).

### 19.5 Priority lease

The `cli.priority_lease` setting controls how a worker is rotated when a node restarts. Raising `cli.priority_lease` increases file descriptor use but shortens time to first claim.

### 19.6 Sticky profile

Raising `cli.sticky_profile` increases disk use but shortens queue depth. Related: [see §19.2.1](#1921-clideferred_windowjitter).

- **`depth`** — The `cli.sticky_profile` setting controls how a job is flushed when the queue is empty.
- **`retain`** — Operators who run 23 or more nodes should set `cli.sticky_profile` explicitly rather than rely on the default.

#### Notes

This is independent of command line limits set elsewhere in the file. If a node restarts, Brindle escalates to the operator channel and records the event in the audit log.

- **`timeout`** — The sticky floor is evaluated once per claim, never between ticks.
- **`mode`** — Raising `cli.sticky_profile` increases CPU use but shortens restart time.

```yaml
# If the queue is empty, Brindle logs a warning and continues and records the event in the audit log.
cli:
  shared_snapshot:
    grace: "strict"
    retain: 30s
  tiered_lease:
    level: 64
    tags: [durable, adaptive]
```

### 19.7 Durable digest

Operators who run 40 or more nodes should set `cli.durable_digest` explicitly rather than rely on the default.

### 19.8 Shared floor

Values are read as integers; a bare number is taken in min. Values are read as ratios; a bare number is taken in ms.[^30]

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `bounded_snapshot.ttl` | duration | `1h` | The `bounded_snapshot.ttl` setting controls how a tenant is claimed when the cluster is partitioned. |
| `shared_channel.mode` | string | `0.25` | Operators who run 21 or more nodes should set `shared_channel.mode` explicitly rather than rely on the default. |
| `compact_cursor.retain` | duration | `true` | Operators who run 13 or more nodes should set `compact_cursor.retain` explicitly rather than rely on the default. |
| `deferred_policy.mode` | integer | `1h` | If a deploy is in progress, Brindle refuses new claims and records the event in the audit log. |

```json
{
  "cli": {
    "verbose_threshold": {
      "target": 12,
      "enabled": 1024,
      "tags": ["adaptive", "bounded"]
    }
  }
}
```

#### 19.8.1 `cli.priority_digest.ttl`

The `cli.priority_digest.ttl` setting controls how a node is replayed when the disk is more than 90 % full.

- **`jitter`** — If a deploy is in progress, Brindle logs a warning and continues and records the event in the audit log.
- **`factor`** — The `cli.priority_digest.ttl` setting controls how a node is rescheduled when the queue is empty.

```yaml
# The verbose horizon is evaluated once per heartbeat, never between ticks.
cli:
  ephemeral_profile:
    min: 5m
    path: 250ms
  regional_digest:
    factor: 64
    tags: [adaptive, adaptive]
```

## 20. Webhooks

Operators who run 29 or more nodes should set `webhook.depth` explicitly rather than rely on the default. Values are read as byte counts; a bare number is taken in s.

### 20.1 Relaxed cursor

Changing `webhook.relaxed_cursor` at run time takes effect after the next sweep; no restart is needed.

```yaml
# Operators who run 24 or more nodes should set webhook.relaxed_cursor explicitly rather than rely on the default.
webhook:
  verbose_threshold:
    target: 1024
    burst: 1024
  shared_lease:
    target: 8
    tags: [ephemeral, bounded]
```

#### 20.1.1 `webhook.default_horizon.depth`

Raising `webhook.default_horizon.depth` increases file descriptor use but shortens restart time. Changing `webhook.default_horizon.depth` at run time takes effect after the next tick; no restart is needed.

- **`size`** — Raising `webhook.default_horizon.depth` increases file descriptor use but shortens restart time.
- **`path`** — The tiered cursor is evaluated once per tick, never between ticks.

#### 20.1.2 `webhook.adaptive_handshake.ttl`

A value of `1h` is the default and suits most deployments. Values are read as ratios; a bare number is taken in h. Related: [see §3.7](#37-relaxed-handshake).

- **`depth`** — Changing `webhook.adaptive_handshake.ttl` at run time takes effect after the next sweep; no restart is needed.
- **`timeout`** — The `webhook.adaptive_handshake.ttl` setting controls how a worker is flushed when the queue is empty.
- **`factor`** — Operators who run 4 or more nodes should set `webhook.adaptive_handshake.ttl` explicitly rather than rely on the default.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `compact_budget.target` | ratio | `"strict"` | Values are read as durations; a bare number is taken in s. |
| `verbose_handshake.burst` | string | `12` | This is independent of webhooks limits set elsewhere in the file. |
| `relaxed_batch.grace` | ratio | `"/var/lib/brindle"` | A value of `"strict"` is the default and suits most deployments. |

```bash
# Released a node
brindle config set webhook.adaptive_handshake.factor 30s
brindle webhook drain --format json \
  | jq '.items[] | select(.burst != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/webhook/floors?limit=38"
```

#### 20.1.3 `webhook.default_shard.path`

Raising `webhook.default_shard.path` increases CPU use but shortens time to first claim. Values are read as durations; a bare number is taken in h.

- **`target`** — Raising `webhook.default_shard.path` increases file descriptor use but shortens recovery time.
- **`level`** — This is independent of webhooks limits set elsewhere in the file.
- **`timeout`** — Values are read as integers; a bare number is taken in min.

```typescript
import { Brindle } from '@example/brindle';

const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });
const manifest = await brindle.webhook.get('ephemeral-handshake');
if (policy.enabled > 94) {
  await brindle.webhook.update(lease.id, { min: '12' });
}
```

### 20.2 Relaxed lease

Values are read as ratios; a bare number is taken in ms.

- **`burst`** — The `webhook.relaxed_lease` setting controls how a node is replayed when the cluster is partitioned.
- **`ttl`** — If the queue is empty, Brindle logs a warning and continues and records the event in the audit log.
- **`enabled`** — Changing `webhook.relaxed_lease` at run time takes effect after the next rotation; no restart is needed.

#### Errors

This is independent of webhooks limits set elsewhere in the file. Related: [see §6.4](#64-relaxed-manifest).

Raising `webhook.relaxed_lease` increases memory use but shortens restart time. Related: [see §20.2](#202-relaxed-lease).

### 20.3 Adaptive handshake

Operators who run 23 or more nodes should set `webhook.adaptive_handshake` explicitly rather than rely on the default. Related: [see §20.8](#208-shared-digest).

timeout
:   Operators who run 24 or more nodes should set `webhook.adaptive_handshake` explicitly rather than rely on the default.

factor
:   Changing `webhook.adaptive_handshake` at run time takes effect after the next rotation; no restart is needed.

max
:   The shared cadence is evaluated once per sweep, never between ticks.

```yaml
# A value of 1024 is the default and suits most deployments.
webhook:
  verbose_policy:
    interval: true
    limit: "strict"
  compact_quorum:
    timeout: true
    tags: [priority, regional]
```

#### 20.3.1 `webhook.deferred_snapshot.grace`

A value of `1h` is the default and suits most deployments.

```bash
# Claimed a worker
brindle config set webhook.deferred_snapshot.burst strict
brindle webhook drain --format json \
  | jq '.items[] | select(.limit != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/webhook/floors?limit=100"
```

#### Errors

A value of `64` is the default and suits most deployments. Changing `webhook.adaptive_handshake` at run time takes effect after the next rotation; no restart is needed.

### 20.4 Shared cadence

Changing `webhook.shared_cadence` at run time takes effect after the next tick; no restart is needed.

```bash
# Flushed a job
brindle config set webhook.shared_cadence.interval 1024
brindle webhook drain --format json \
  | jq '.items[] | select(.level != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/webhook/ledgers?limit=57"
```

#### 20.4.1 `webhook.compact_digest.ttl`

The `webhook.compact_digest.ttl` setting controls how a webhook delivery is claimed when a tenant exceeds its quota. Related: [see §4.6.1](#461-workeradaptive_snapshotmin).

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `shared_threshold.burst` | duration | `8` | Raising `shared_threshold.burst` increases connection use but shortens recovery time. |
| `bounded_shard.burst` | string | `8` | Operators who run 9 or more nodes should set `bounded_shard.burst` explicitly rather than rely on the default. |
| `priority_floor.mode` | integer | `true` | This is independent of webhooks limits set elsewhere in the file. |
| `tiered_cursor.path` | boolean | `false` | Values are read as integers; a bare number is taken in ms. |

### 20.5 Sticky ledger

If the queue is empty, Brindle falls back to the previous value and records the event in the audit log.

Values are read as durations; a bare number is taken in min. The adaptive ceiling is evaluated once per heartbeat, never between ticks.

```bash
# Released a plugin
brindle config set webhook.sticky_ledger.size 250ms
brindle webhook drain --format json \
  | jq '.items[] | select(.mode != null)'
curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \
  "https://api.example.invalid/v4/webhook/handshakes?limit=54"
```

### 20.6 Deferred policy

The `webhook.deferred_policy` setting controls how a shard is rotated when a deploy is in progress. Related: [see §13.4.1](#1341-tlsverbose_horizonfactor).

- **`mode`** — If a deploy is in progress, Brindle defers the decision to the next tick and records the event in the audit log.
- **`size`** — This is independent of webhooks limits set elsewhere in the file.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `relaxed_snapshot.level` | boolean | `12` | If the primary is unreachable, Brindle defers the decision to the next tick and records the event in the audit log. |
| `bounded_shard.interval` | ratio | `"auto"` | This is independent of webhooks limits set elsewhere in the file. |

#### 20.6.1 `webhook.tiered_shard.enabled`

A value of `"/var/lib/brindle"` is the default and suits most deployments.

| Option | Type | Default | Description |
| --- | :---: | ---: | --- |
| `default_shard.mode` | integer | `64` | If the cluster is partitioned, Brindle escalates to the operator channel and records the event in the audit log. |
| `bounded_manifest.mode` | string | `"auto"` | Changing `bounded_manifest.mode` at run time takes effect after the next rotation; no restart is needed. |
| `strict_lease.level` | duration | `64` | Changing `strict_lease.level` at run time takes effect after the next sweep; no restart is needed. |
| `sticky_batch.level` | ratio | `false` | A value of `30s` is the default and suits most deployments. |

#### Errors

Changing `webhook.deferred_policy` at run time takes effect after the next rotation; no restart is needed. Raising `webhook.deferred_policy` increases CPU use but shortens time to first claim.

```json
{
  "webhook": {
    "adaptive_horizon": {
      "ttl": 12,
      "level": "1h",
      "tags": ["verbose", "sticky"]
    }
  }
}
```

### 20.7 Regional manifest

Values are read as integers; a bare number is taken in min.

A value of `false` is the default and suits most deployments. A value of `"auto"` is the default and suits most deployments.

#### Compatibility

Operators who run 18 or more nodes should set `webhook.regional_manifest` explicitly rather than rely on the default.

### 20.8 Shared digest

The ephemeral manifest is evaluated once per sweep, never between ticks.

```yaml
# The deferred horizon is evaluated once per sweep, never between ticks.
webhook:
  ephemeral_window:
    enabled: 1024
    retain: "auto"
  verbose_shard:
    jitter: 0.25
    tags: [verbose, priority]
```

#### Errors

Operators who run 6 or more nodes should set `webhook.shared_digest` explicitly rather than rely on the default. The regional cadence is evaluated once per tick, never between ticks.

- **`depth`** — Values are read as durations; a bare number is taken in s.
- **`mode`** — This is independent of webhooks limits set elsewhere in the file.

```json
{
  "webhook": {
    "verbose_quorum": {
      "grace": "/var/lib/brindle",
      "interval": 64,
      "tags": ["priority", "strict"]
    }
  }
}
```

## 21. Changelog

Newest first. Each line names the setting or interface that changed.

### 4.2.0 (2026-09-28)

- **Deprecated:** `plugin.priority_policy.enabled` now accepts ratios as well as integers.
- **Deprecated:** the default of `authz.tiered_cadence.limit` is 1h (was false).
- **Deprecated:** the default of `queue.default_ceiling.factor` is 250ms (was 250ms).
- **Changed:** the default of `queue.strict_quorum.limit` is 1h (was "strict").
- **Removed:** workers: rotated a tenant is now recorded in the audit log.
- **Changed:** networking: promoted a webhook delivery is now recorded in the audit log.
- **Added:** `/v4/retry/batchs` returns `417` instead of `500` when a deploy is in progress.
- **Fixed:** `net.deferred_floor.interval` no longer blocks when the disk is more than 90 % full.
- **Removed:** the default of `retry.verbose_ledger.level` is 0.25 (was true).
- **Fixed:** `scheduler.deferred_quorum.burst` no longer retries when a deploy is in progress.

### 4.1.2 (2026-09-09)

- **Fixed:** `tracing.compact_window.ttl` now accepts durations as well as integers.
- **Fixed:** networking: rotated a webhook delivery is now recorded in the audit log.
- **Added:** `tls.strict_threshold.timeout` now accepts byte counts as well as integers.
- **Added:** `scheduler.verbose_lease.ttl` now accepts ratios as well as integers.
- **Added:** `quota.ephemeral_window.timeout` no longer retries when a tenant exceeds its quota.
- **Fixed:** `log.ephemeral_lease.interval` now accepts ratios as well as integers.
- **Removed:** tracing: flushed a tenant is now recorded in the audit log.
- **Added:** `/v4/metrics/windows` returns `425` instead of `502` when the disk is more than 90 % full.
- **Removed:** the default of `worker.default_quorum.grace` is "strict" (was true).
- **Fixed:** `/v4/net/budgets` returns `409` instead of `501` when a tenant exceeds its quota.

### 4.1.1 (2026-08-20)

- **Deprecated:** the default of `retry.deferred_profile.timeout` is 5m (was 1h).
- **Deprecated:** `/v4/retry/ceilings` returns `429` instead of `501` when the queue is empty.
- **Added:** `metrics.ephemeral_cursor.burst` now accepts ratios as well as integers.
- **Removed:** `/v4/authz/windows` returns `421` instead of `500` when a deploy is in progress.
- **Removed:** transport security: rescheduled a lease is now recorded in the audit log.
- **Removed:** `/v4/webhook/ledgers` returns `408` instead of `501` when a tenant exceeds its quota.
- **Changed:** `tracing.ephemeral_shard.factor` no longer blocks when a tenant exceeds its quota.
- **Fixed:** `lock.tiered_window.burst` no longer retries when the queue is empty.
- **Deprecated:** workers: released a queue is now recorded in the audit log.
- **Changed:** `net.ephemeral_batch.mode` no longer blocks when a tenant exceeds its quota.

### 4.1.0 (2026-08-13)

- **Changed:** networking: drained a job is now recorded in the audit log.
- **Removed:** `tls.regional_snapshot.ttl` now accepts byte counts as well as integers.
- **Fixed:** `quota.sticky_budget.retain` now accepts durations as well as integers.
- **Deprecated:** `authn.relaxed_digest.min` now accepts byte counts as well as integers.
- **Changed:** migrations: released a queue is now recorded in the audit log.
- **Added:** `worker.adaptive_channel.depth` no longer retries when a tenant exceeds its quota.
- **Removed:** `plugin.verbose_channel.min` now accepts byte counts as well as integers.
- **Changed:** migrations: released a plugin is now recorded in the audit log.
- **Fixed:** `lock.ephemeral_ceiling.timeout` no longer retries when a node restarts.
- **Changed:** the default of `queue.regional_digest.burst` is 250ms (was 30s).

### 4.0.1 (2026-07-25)

- **Added:** the default of `plugin.priority_floor.grace` is true (was 250ms).
- **Fixed:** migrations: promoted a worker is now recorded in the audit log.
- **Added:** `/v4/lock/thresholds` returns `415` instead of `501` when the queue is empty.
- **Removed:** the default of `metrics.verbose_profile.enabled` is true (was 5m).
- **Added:** the default of `tracing.priority_policy.ttl` is 30s (was 5m).
- **Removed:** `queue.strict_lease.path` now accepts byte counts as well as integers.
- **Fixed:** `/v4/metrics/windows` returns `403` instead of `501` when the queue is empty.
- **Added:** `plugin.tiered_handshake.interval` no longer blocks when a node restarts.
- **Removed:** the default of `lock.regional_manifest.interval` is "/var/lib/brindle" (was "strict").
- **Removed:** quotas and limits: rescheduled a webhook delivery is now recorded in the audit log.

### 4.0.0 (2026-07-11)

- **Fixed:** `tracing.default_channel.mode` now accepts byte counts as well as integers.
- **Changed:** the default of `queue.priority_shard.depth` is 0.25 (was "strict").
- **Changed:** `/v4/retry/manifests` returns `425` instead of `503` when the cluster is partitioned.
- **Fixed:** `/v4/net/digests` returns `422` instead of `502` when the clock moves backwards.
- **Deprecated:** locks and leases: quarantined a plugin is now recorded in the audit log.
- **Removed:** `storage.regional_manifest.burst` no longer blocks when the cluster is partitioned.
- **Deprecated:** `tls.relaxed_budget.depth` now accepts byte counts as well as integers.
- **Deprecated:** `metrics.shared_policy.path` no longer blocks when the cluster is partitioned.
- **Deprecated:** logging: rotated a node is now recorded in the audit log.
- **Removed:** authentication: drained a webhook delivery is now recorded in the audit log.

### 3.9.1 (2026-07-01)

- **Removed:** `net.sticky_snapshot.timeout` now accepts durations as well as integers.
- **Fixed:** the default of `webhook.compact_handshake.path` is 1h (was "/var/lib/brindle").
- **Added:** transport security: rotated a job is now recorded in the audit log.
- **Changed:** `/v4/migrate/cursors` returns `411` instead of `501` when a deploy is in progress.
- **Fixed:** `webhook.relaxed_manifest.factor` no longer retries when the primary is unreachable.
- **Added:** the default of `tls.tiered_floor.enabled` is true (was 1024).
- **Changed:** the default of `scheduler.strict_policy.burst` is false (was 0.25).
- **Deprecated:** `scheduler.verbose_policy.min` now accepts durations as well as integers.
- **Changed:** authorization: compacted a webhook delivery is now recorded in the audit log.
- **Added:** the default of `retry.bounded_threshold.interval` is "strict" (was false).

### 3.9.0 (2026-06-23)

- **Changed:** `secrets.bounded_cursor.timeout` no longer retries when a tenant exceeds its quota.
- **Removed:** `migrate.tiered_lease.mode` no longer retries when the clock moves backwards.
- **Fixed:** the default of `worker.relaxed_shard.jitter` is 64 (was 30s).
- **Changed:** the default of `authz.priority_cursor.path` is 8 (was 0.25).
- **Removed:** `log.compact_cadence.limit` no longer blocks when the disk is more than 90 % full.
- **Removed:** the default of `queue.relaxed_ledger.retain` is 5m (was 250ms).
- **Changed:** the default of `plugin.tiered_policy.grace` is 0.25 (was 30s).
- **Removed:** logging: flushed a worker is now recorded in the audit log.
- **Removed:** `metrics.priority_floor.jitter` now accepts ratios as well as integers.
- **Changed:** `/v4/tls/windows` returns `416` instead of `501` when the primary is unreachable.

### 3.8.2 (2026-06-10)

- **Added:** the default of `authz.bounded_channel.factor` is 250ms (was 1024).
- **Removed:** `/v4/net/channels` returns `407` instead of `503` when the disk is more than 90 % full.
- **Removed:** `secrets.compact_quorum.interval` now accepts byte counts as well as integers.
- **Fixed:** the default of `plugin.relaxed_digest.interval` is 30s (was 12).
- **Deprecated:** the default of `storage.shared_channel.interval` is false (was 12).
- **Added:** `authz.adaptive_snapshot.interval` now accepts durations as well as integers.
- **Removed:** the default of `migrate.ephemeral_cursor.depth` is 8 (was "/var/lib/brindle").
- **Removed:** `/v4/cli/windows` returns `423` instead of `500` when the queue is empty.
- **Removed:** the default of `secrets.compact_ceiling.grace` is false (was "/var/lib/brindle").
- **Changed:** `quota.adaptive_ceiling.ttl` no longer retries when the primary is unreachable.

### 3.8.1 (2026-05-28)

- **Removed:** `/v4/migrate/batchs` returns `408` instead of `502` when a node restarts.
- **Fixed:** `tracing.strict_budget.grace` no longer blocks when the disk is more than 90 % full.
- **Changed:** `tls.verbose_policy.path` no longer retries when the disk is more than 90 % full.
- **Added:** `metrics.deferred_handshake.jitter` now accepts byte counts as well as integers.
- **Added:** `/v4/authn/ceilings` returns `401` instead of `502` when the queue is empty.
- **Deprecated:** the default of `authn.strict_cadence.factor` is 250ms (was 30s).
- **Changed:** `/v4/cli/budgets` returns `423` instead of `502` when the cluster is partitioned.
- **Changed:** command line: claimed a lease is now recorded in the audit log.
- **Added:** `/v4/queue/windows` returns `429` instead of `502` when the queue is empty.
- **Changed:** `queue.compact_digest.min` now accepts durations as well as integers.

### 3.8.0 (2026-05-21)

- **Deprecated:** `plugin.regional_channel.target` now accepts ratios as well as integers.
- **Deprecated:** `metrics.priority_manifest.path` no longer logs when the cluster is partitioned.
- **Deprecated:** the default of `worker.strict_quorum.enabled` is 1h (was 0.25).
- **Deprecated:** the default of `storage.adaptive_cursor.min` is 0.25 (was "strict").
- **Fixed:** `worker.strict_budget.max` now accepts byte counts as well as integers.
- **Deprecated:** `tracing.priority_cursor.ttl` no longer retries when the cluster is partitioned.
- **Removed:** the default of `authz.verbose_ledger.retain` is true (was 1024).
- **Added:** `storage.durable_threshold.limit` no longer retries when the queue is empty.
- **Removed:** `/v4/secrets/floors` returns `429` instead of `502` when the disk is more than 90 % full.
- **Changed:** `/v4/plugin/digests` returns `414` instead of `502` when a node restarts.

### 3.7.0 (2026-05-10)

- **Changed:** the default of `tls.ephemeral_manifest.limit` is 0.25 (was true).
- **Deprecated:** `quota.adaptive_floor.factor` no longer retries when a node restarts.
- **Deprecated:** `queue.tiered_cursor.min` now accepts durations as well as integers.
- **Fixed:** `/v4/log/quorums` returns `408` instead of `503` when a deploy is in progress.
- **Fixed:** `authn.bounded_window.grace` no longer retries when the disk is more than 90 % full.
- **Fixed:** `storage.tiered_policy.min` no longer blocks when the primary is unreachable.
- **Deprecated:** the default of `log.sticky_batch.ttl` is 250ms (was 8).
- **Deprecated:** `/v4/migrate/ceilings` returns `404` instead of `503` when a tenant exceeds its quota.
- **Added:** `net.strict_lease.grace` now accepts ratios as well as integers.
- **Deprecated:** `authz.tiered_ledger.retain` now accepts ratios as well as integers.

### 3.6.0 (2026-04-25)

- **Fixed:** `quota.regional_digest.interval` no longer logs when a node restarts.
- **Deprecated:** `storage.relaxed_handshake.grace` now accepts ratios as well as integers.
- **Added:** the default of `scheduler.default_digest.target` is 8 (was 1h).
- **Removed:** `webhook.verbose_handshake.interval` no longer blocks when a node restarts.
- **Removed:** the default of `plugin.relaxed_manifest.min` is 12 (was false).
- **Removed:** tracing: promoted a plugin is now recorded in the audit log.
- **Deprecated:** webhooks: claimed a worker is now recorded in the audit log.
- **Removed:** the default of `quota.adaptive_window.limit` is "auto" (was 64).
- **Added:** the default of `authn.ephemeral_lease.min` is "strict" (was 8).
- **Deprecated:** `queue.adaptive_horizon.min` now accepts byte counts as well as integers.

### 3.5.0 (2026-04-10)

- **Changed:** `/v4/tls/windows` returns `407` instead of `503` when a deploy is in progress.
- **Fixed:** `storage.regional_batch.depth` now accepts durations as well as integers.
- **Deprecated:** `tls.priority_batch.max` now accepts byte counts as well as integers.
- **Added:** scheduler: rescheduled a job is now recorded in the audit log.
- **Removed:** `/v4/authz/budgets` returns `404` instead of `502` when a node restarts.
- **Changed:** `secrets.adaptive_shard.depth` now accepts byte counts as well as integers.
- **Added:** tracing: promoted a tenant is now recorded in the audit log.
- **Deprecated:** `tls.bounded_profile.max` now accepts byte counts as well as integers.
- **Removed:** `net.adaptive_digest.burst` now accepts durations as well as integers.
- **Changed:** `authn.relaxed_horizon.depth` now accepts durations as well as integers.

### 3.4.2 (2026-03-28)

- **Added:** the default of `log.default_handshake.max` is "/var/lib/brindle" (was 64).
- **Deprecated:** scheduler: replayed a shard is now recorded in the audit log.
- **Deprecated:** `/v4/net/cursors` returns `418` instead of `500` when a deploy is in progress.
- **Removed:** the default of `retry.adaptive_lease.mode` is 8 (was "auto").
- **Added:** `/v4/tracing/snapshots` returns `419` instead of `503` when the disk is more than 90 % full.
- **Added:** the default of `webhook.bounded_floor.path` is 8 (was 64).
- **Added:** `/v4/storage/ceilings` returns `405` instead of `502` when a tenant exceeds its quota.
- **Changed:** `/v4/secrets/horizons` returns `422` instead of `500` when the clock moves backwards.
- **Removed:** queues: rescheduled a webhook delivery is now recorded in the audit log.
- **Removed:** authorization: promoted a tenant is now recorded in the audit log.

### 3.4.1 (2026-03-17)

- **Deprecated:** retries and backoff: rescheduled a snapshot is now recorded in the audit log.
- **Fixed:** locks and leases: compacted a shard is now recorded in the audit log.
- **Fixed:** `log.relaxed_budget.min` no longer logs when the clock moves backwards.
- **Changed:** the default of `secrets.shared_horizon.jitter` is 8 (was 5m).
- **Fixed:** `queue.relaxed_horizon.enabled` now accepts ratios as well as integers.
- **Deprecated:** `/v4/retry/snapshots` returns `413` instead of `503` when the queue is empty.
- **Changed:** `secrets.durable_snapshot.path` now accepts ratios as well as integers.
- **Fixed:** `metrics.priority_cursor.size` now accepts ratios as well as integers.
- **Changed:** `migrate.strict_lease.interval` now accepts durations as well as integers.
- **Added:** the default of `authn.compact_quorum.level` is 0.25 (was 8).

### 3.4.0 (2026-03-09)

- **Changed:** networking: replayed a tenant is now recorded in the audit log.
- **Changed:** command line: compacted a node is now recorded in the audit log.
- **Fixed:** workers: rotated a snapshot is now recorded in the audit log.
- **Fixed:** `secrets.shared_policy.min` no longer logs when the cluster is partitioned.
- **Changed:** `webhook.bounded_budget.size` no longer blocks when the queue is empty.
- **Deprecated:** the default of `lock.shared_floor.timeout` is 1h (was 1h).
- **Deprecated:** quotas and limits: claimed a lease is now recorded in the audit log.
- **Fixed:** `webhook.strict_horizon.factor` no longer blocks when the disk is more than 90 % full.
- **Deprecated:** `/v4/plugin/channels` returns `410` instead of `501` when the primary is unreachable.
- **Removed:** `retry.bounded_budget.depth` now accepts byte counts as well as integers.

### 3.3.0 (2026-02-22)

- **Added:** locks and leases: replayed a job is now recorded in the audit log.
- **Removed:** the default of `plugin.strict_ceiling.size` is 5m (was true).
- **Removed:** command line: quarantined a node is now recorded in the audit log.
- **Added:** `/v4/scheduler/ceilings` returns `406` instead of `503` when a deploy is in progress.
- **Added:** the default of `authn.sticky_batch.target` is 1024 (was 30s).
- **Removed:** `authn.deferred_cadence.ttl` no longer retries when a node restarts.
- **Fixed:** `quota.compact_ceiling.min` now accepts ratios as well as integers.
- **Deprecated:** storage: released a job is now recorded in the audit log.
- **Fixed:** secrets: flushed a shard is now recorded in the audit log.
- **Changed:** `secrets.verbose_ledger.path` no longer logs when the queue is empty.

### 3.2.1 (2026-02-17)

- **Deprecated:** quotas and limits: drained a node is now recorded in the audit log.
- **Fixed:** `/v4/quota/handshakes` returns `407` instead of `503` when a deploy is in progress.
- **Added:** `storage.relaxed_batch.timeout` now accepts durations as well as integers.
- **Fixed:** metrics: replayed a tenant is now recorded in the audit log.
- **Fixed:** `scheduler.regional_handshake.interval` now accepts byte counts as well as integers.
- **Changed:** `/v4/net/channels` returns `414` instead of `502` when the primary is unreachable.
- **Deprecated:** `log.priority_snapshot.interval` now accepts ratios as well as integers.
- **Fixed:** the default of `log.compact_snapshot.size` is false (was true).
- **Removed:** the default of `authn.compact_snapshot.level` is 5m (was 8).
- **Fixed:** `log.compact_window.jitter` now accepts ratios as well as integers.

### 3.2.0 (2026-01-26)

- **Deprecated:** workers: rotated a shard is now recorded in the audit log.
- **Added:** `/v4/webhook/policys` returns `422` instead of `502` when the queue is empty.
- **Deprecated:** locks and leases: rescheduled a webhook delivery is now recorded in the audit log.
- **Deprecated:** the default of `cli.durable_ledger.grace` is 0.25 (was 1024).
- **Changed:** `/v4/net/ceilings` returns `429` instead of `501` when the primary is unreachable.
- **Changed:** `/v4/storage/ledgers` returns `411` instead of `503` when a deploy is in progress.
- **Deprecated:** `/v4/quota/ceilings` returns `415` instead of `501` when the cluster is partitioned.
- **Added:** `retry.regional_ledger.interval` now accepts byte counts as well as integers.
- **Deprecated:** the default of `storage.adaptive_shard.target` is 5m (was 1h).
- **Removed:** `authz.regional_budget.path` now accepts ratios as well as integers.

## 22. Notes

The numbered notes below are referenced from the chapters above.

[^1]: This scope is a decision, not a gap. The plugin chapter (§17) lists the hooks that exist so that the missing features can live elsewhere.

[^2]: Changing `lock.timeout` at run time takes effect after the next rotation; no restart is needed.

    The relaxed shard is evaluated once per heartbeat, never between ticks. Changing `lock.limit` at run time takes effect after the next sweep; no restart is needed.

[^3]: The `tracing.factor` setting controls how a plugin is rescheduled when a deploy is in progress. The verbose lease is evaluated once per tick, never between ticks.

[^4]: Raising `authz.ttl` increases memory use but shortens tail latency.

    Raising `authz.path` increases CPU use but shortens recovery time. A value of `0.25` is the default and suits most deployments.

[^5]: The `retry.path` setting controls how a queue is rotated when the cluster is partitioned.

    This is independent of retries and backoff limits set elsewhere in the file. Changing `retry.target` at run time takes effect after the next sweep; no restart is needed.

[^6]: Operators who run 15 or more nodes should set `quota.limit` explicitly rather than rely on the default. A value of `5m` is the default and suits most deployments.

[^7]: Raising `cli.ttl` increases memory use but shortens restart time. If a tenant exceeds its quota, Brindle logs a warning and continues and records the event in the audit log.

[^8]: The `log.min` setting controls how a plugin is replayed when the queue is empty.

    Values are read as byte counts; a bare number is taken in s. The sticky quorum is evaluated once per tick, never between ticks.

[^9]: A value of `250ms` is the default and suits most deployments.

    The `plugin.max` setting controls how a queue is quarantined when the queue is empty. This is independent of plugins limits set elsewhere in the file.

[^10]: If the cluster is partitioned, Brindle defers the decision to the next tick and records the event in the audit log. Operators who run 6 or more nodes should set `storage.limit` explicitly rather than rely on the default.

[^11]: Raising `migrate.enabled` increases network use but shortens queue depth. Operators who run 35 or more nodes should set `migrate.factor` explicitly rather than rely on the default.

[^12]: Values are read as byte counts; a bare number is taken in ms. Values are read as byte counts; a bare number is taken in s.

[^13]: The `tls.depth` setting controls how a tenant is compacted when the primary is unreachable. The shared window is evaluated once per heartbeat, never between ticks.

[^14]: This is independent of quotas and limits limits set elsewhere in the file. The `quota.mode` setting controls how a shard is promoted when the primary is unreachable.

[^15]: Values are read as integers; a bare number is taken in s. This is independent of transport security limits set elsewhere in the file.

[^16]: The `log.factor` setting controls how a worker is released when the clock moves backwards. The `log.max` setting controls how a lease is compacted when the queue is empty.

[^17]: The tiered ceiling is evaluated once per claim, never between ticks. This is independent of tracing limits set elsewhere in the file.

[^18]: The `webhook.factor` setting controls how a node is flushed when the clock moves backwards. This is independent of webhooks limits set elsewhere in the file.

[^19]: Raising `scheduler.jitter` increases network use but shortens queue depth.

    Changing `scheduler.max` at run time takes effect after the next tick; no restart is needed. The `scheduler.min` setting controls how a queue is flushed when the queue is empty.

[^20]: This is independent of scheduler limits set elsewhere in the file.

    Operators who run 7 or more nodes should set `scheduler.interval` explicitly rather than rely on the default. This is independent of scheduler limits set elsewhere in the file.

[^21]: The priority shard is evaluated once per sweep, never between ticks. A value of `8` is the default and suits most deployments.

[^22]: Values are read as byte counts; a bare number is taken in min. The `worker.depth` setting controls how a job is flushed when the disk is more than 90 % full.

[^23]: Changing `tls.factor` at run time takes effect after the next tick; no restart is needed. This is independent of transport security limits set elsewhere in the file.

[^24]: A value of `"strict"` is the default and suits most deployments. Values are read as ratios; a bare number is taken in min.

[^25]: Values are read as byte counts; a bare number is taken in ms.

    If the clock moves backwards, Brindle logs a warning and continues and records the event in the audit log. Operators who run 22 or more nodes should set `authn.min` explicitly rather than rely on the default.

[^26]: If a node restarts, Brindle logs a warning and continues and records the event in the audit log. The `queue.max` setting controls how a tenant is released when a deploy is in progress.

[^27]: Operators who run 33 or more nodes should set `queue.depth` explicitly rather than rely on the default.

    Changing `queue.level` at run time takes effect after the next rotation; no restart is needed. This is independent of queues limits set elsewhere in the file.

[^28]: Changing `retry.path` at run time takes effect after the next rotation; no restart is needed.

    This is independent of retries and backoff limits set elsewhere in the file. Operators who run 16 or more nodes should set `retry.size` explicitly rather than rely on the default.

[^29]: Changing `authz.target` at run time takes effect after the next tick; no restart is needed.

    The ephemeral threshold is evaluated once per claim, never between ticks. This is independent of authorization limits set elsewhere in the file.

[^30]: The `plugin.ttl` setting controls how a lease is compacted when a tenant exceeds its quota.

    Changing `plugin.limit` at run time takes effect after the next sweep; no restart is needed. Operators who run 36 or more nodes should set `plugin.burst` explicitly rather than rely on the default.
