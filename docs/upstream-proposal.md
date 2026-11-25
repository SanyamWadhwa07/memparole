# Proposal for OpenClaw #153426: audited owner recovery for quarantined memory

A draft for the OpenClaw maintainers, with a working reference implementation and tests. It
covers [#153426](https://github.com/openclaw/openclaw/issues/153426),
[#203532](https://github.com/openclaw/openclaw/issues/203532) and
[#204738](https://github.com/openclaw/openclaw/issues/204738).

## The problem, in one paragraph

A curated memory file (`MEMORY.md`, `USER.md`) whose provenance record becomes `untrusted` is left
out of every new session's start context. Three ordinary things cause it: a write in a turn that
read the network, an out-of-band edit, or a non-owner sender. The record is a ratchet, so the file
never comes back, and nothing tells the user. The only recovery today is deleting a row from the
gateway state database by hand.

## What is proposed

The smallest change that keeps every safety check and adds a way back. These follow, in order,
the capabilities requested in the field report on #153426 (item 5).

1. **Audited owner recovery for reviewed bytes.** An operator command, outside the agent tool path,
   records an owner decision for one file bound to the exact SHA-256 the owner reviewed, and
   restores eligibility for those bytes only. The earlier provenance stays as recorded; the
   decision is a separate audited record (who, when, path, reviewed hash, reason). It refuses if
   the file does not match the reviewed hash, stops applying once the bytes change, and cannot be
   called by an agent tool, a plugin or a non-owner.
2. **Read-only inspection.** For one path: whether a record exists, its class, the stored hash,
   whether it matches the file now, time and session, and the latest decision with its reason.
   Operator only.
3. **A reason on every downgrade:** `non-owner`, `tainted-turn`, `hash-mismatch` or
   `already-untrusted`, stored with the record. This also separates taint (the turn read the
   network) from distrust (a foreign writer), as the original report asks.
4. **Publications keep continuity.** A committed publication continues a trusted record and never
   upgrades an untrusted one; a rejected one changes nothing; an uncertain one blocks trusted use
   until reconciliation shows which authorised write committed. If none can be established, the
   file stays quarantined.

Nothing here weakens the hash-continuity check, deletes state rows, or relabels content.

## Reference implementation

[Memparole](../README.md) implements all four as a standalone library, in TypeScript on Node with
`node:sqlite`:

| Capability | Code |
|---|---|
| Owner decision bound to the hash, operator only | [`src/core/review.ts`](../src/core/review.ts) |
| Append-only decision log, fixed provenance (SQLite triggers) | [`src/core/store.ts`](../src/core/store.ts) |
| Trust re-checked on every read; void with a logged reason when bytes change | `Store.verify` in [`src/core/store.ts`](../src/core/store.ts) |
| Tracked writes with downgrade reasons, inspection, publication and reconciliation | [`src/core/files.ts`](../src/core/files.ts) |
| Operator command line: `inspect`, `review`, `log` | [`src/owner.ts`](../src/owner.ts) |

## The acceptance cases, as tests

Every case from the field report runs in [`test/acceptance.test.ts`](../test/acceptance.test.ts),
each against a fresh in-memory store, with no production memory, credentials or channels. All
eleven pass in CI on Linux, macOS and Windows.

| Case | What is checked |
|---|---|
| A | Tracked write, promotion, clean tracked edit: stays trusted; stored hash equals the file's |
| B | The same from an untrusted record: stays untrusted (`already-untrusted`) |
| C | Reopening an existing database, stale rows included: no row or decision changes |
| D | Owner decision at the reviewed hash: eligible again; provenance still `untrusted`; the decision is in the log |
| E | Owner decision for bytes that differ: refused, nothing changes |
| F | Owner decision from an agent tool, a plugin or a non-owner: refused |
| G | After D, a non-owner or tainted write: not eligible, reason recorded |
| H | After D, an unobserved change then a clean edit: decision no longer applies; reason `hash-mismatch` |
| I | Inspection tells none, clean, stale, untrusted and owner-approved apart; read-only; refused for non-operators |
| J | Scheduled promotion and the in-place fallback both repeat A |
| K | Rejected publication changes nothing; uncertain blocks trusted use until reconciliation; unresolved stays quarantined; an untrusted record is never upgraded |

Two cases needed a simplification:
- **J:** Memparole has one publication path, so the scheduled run and the in-place fallback are
  the same call.
- **I:** a non-operator is refused, not shown a redacted view. Redaction is not built.

## How it would map onto OpenClaw

These are suggestions, to be checked against the code by people who know it:

- `openclaw memory provenance inspect <path>` and `openclaw memory provenance review <path> --hash <sha256> --reason <text>`, operator only, never registered as agent tools.
- Store the owner decision as its own record next to the existing provenance record, not as a
  change to `originClass`.
- Have `doctor` print each excluded curated file with its reason, using the stored downgrade
  reason.
- Have the promotion publisher refresh the record after a committed write, following the rules in
  item 4.

## Beyond files

Memparole also proposes a second way out for single facts: two or more independent web sources
(different registrable domains, no shared upstream, neither citing the other) agree, and no trusted
memory contradicts them. It is measured on ParoleBench, a benchmark of planted misinformation in
the HEARTBEAT paper's three domains. This part is separate from the file fix above and is not
needed for it.
