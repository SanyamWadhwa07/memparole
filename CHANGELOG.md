# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- ParoleBench milestone 1: a typed event stream that keeps ground truth away from the system under
  test, and a seeded, deterministic generator for six event kinds (owner chats, heartbeat feeds,
  web lookups, fact updates, out-of-band file edits, non-owner messages) and the three HEARTBEAT
  domains (dependencies, DeFi protocols, papers), with two personas over seven days.
- An exact-match grader for pollution rate, true-fact recall, false-quarantine rate, stale-answer
  rate, NDCG@5 and estimated wake-up tokens per idle day.
- A memory-system interface (`ingest`, `wake`, `search`, `inspect`) and the first baseline, no
  defense: one plain Markdown memory file.
- A scripted fake model, so tests and `npm run bench` run offline with no keys.
- 20 tests, and CI on Linux, macOS and Windows.
