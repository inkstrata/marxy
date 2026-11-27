---
name: bug-verify
description: Use after bug-catch has filled a Marxy hunt's findings.md, or when the owner asks to verify, reproduce or check a hunt's findings. Sends Sonnet verifiers who did not catch the findings to reproduce each one and append a verdict to the hunt's verification.md.
---

# Bug verify: the second step of the bug cycle

Every finding in a hunt's `findings.md` gets one verdict in `verification.md`, written by an agent who did
not catch it. The verdicts, the proof they need and the helper are in
[../bug-catch/format.md](../bug-catch/format.md).

## 1. Batch the findings

Start as soon as a catcher reports, not when the whole fleet has: a domain's batch can be verified while
other catchers still run, as long as catchers and verifiers together stay at six. Owner reports wait for
the catcher's own finding that supersedes them.

`node .claude/skills/bug-catch/finding.mjs list <findings.md>` lists them. Group by prefix, S1 first.
A batch is one prefix, or up to eight findings; split a big prefix into two batches. Low-confidence S3
findings may share a batch across prefixes. Findings superseded by a later block of the same catcher are
verified through the later one, and the earlier gets `DUPLICATE of <later id>`.

## 2. Send the verifiers

One Sonnet agent per batch, `model: "sonnet"`, effort medium, background, all in one message, four at most
at once (each drives a browser). Never the agent that caught the batch: a fresh agent, so the verdict is not
the catcher's own reasoning read back. Write each brief from [verifier-brief.md](verifier-brief.md) into
`briefs/verify-<batch>.md`.

Give an S1 freeze or data-loss finding a batch of its own: it may need the longest probe.

## 3. When the verifiers are done

1. Every finding has exactly one verdict: compare the two `list` outputs. A missing verdict goes back to
   the same verifier with `SendMessage`. Two verdicts for one finding: the triage reads the later one and
   notes the disagreement.
2. **Check the load-bearing claims yourself.** For every `CONFIRMED` S1, open its probe output and read
   the lines it cites. A verdict whose proof does not show what it says is sent back to its verifier, or
   given to a second verifier if the first already tried.
3. Commit `verification.md` and `probes/`, push, and add the verdict counts to the hunt's `README.md`.
4. Go on to `bug-triage`.
