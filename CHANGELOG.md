# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-26

### Added

- **ParoleBench**: a typed event stream that keeps ground truth away from the system under test,
  and a seeded, deterministic generator for six event kinds (owner chats, heartbeat feeds, web
  lookups, fact updates, out-of-band file edits, non-owner messages) and the three HEARTBEAT
  domains (dependencies, DeFi protocols, papers), with two personas over seven days.
- An exact-match grader for pollution rate, true-fact recall, false-quarantine rate, stale-answer
  rate, NDCG@5 and estimated wake-up tokens per idle day; `npm run bench -- compare --seeds N`.
- Three systems behind one interface: no defense (one plain Markdown file), quarantine-only (no
  way back), and Memparole.
- `npm run bench -- labels`: claim pairs labelled same, contradicts or unrelated, and per-probe
  relevance labels, for training a claim-agreement model and a ranker. `Ranker` and
  `ClaimMatcher` interfaces so trained models can replace the defaults.
- **The Memparole core** on `node:sqlite`: fixed provenance and an append-only decision log, both
  enforced by triggers; trust on arrival for the owner's words only; owner review bound to the
  exact SHA-256 and refused for any caller but the operator; parole when two or more independent
  web sources agree with no trusted contradiction; and a re-check on every read that voids trust
  when content changes, even with a forged stored hash.
- **Curated memory files** for OpenClaw #153426: tracked writes with downgrade reasons
  (`non-owner`, `tainted-turn`, `hash-mismatch`, `already-untrusted`), read-only inspection with
  five states, and publications that keep continuity, with reconciliation after an uncertain one.
  The eleven acceptance cases A to K from the issue's field report run as tests.
- **The owner command line**: `inspect`, `review`, `log`.
- **The MCP memory server**: `remember`, `recall` and `wake`, and no review or inspect tool.
- A scripted fake model, so everything runs offline with no keys.
- `docs/upstream-proposal.md`, the proposal for OpenClaw.
- 48 tests, and CI on Linux, macOS and Windows.

[0.1.0]: https://github.com/SanyamWadhwa07/memparole/releases/tag/v0.1.0
