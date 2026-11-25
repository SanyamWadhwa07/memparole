# Security policy

## What it touches

Memparole and ParoleBench run on your machine as one Node process. They:

- make no network requests and read no API keys; the only model is a scripted fake
- keep Memparole's memory in a SQLite file you choose, or in memory for bench runs
- write each baseline's memory file to a new folder in your system temp directory and delete the
  folder when the run ends
- generate invented content only: every person, package, protocol, paper and URL is made up, and
  every URL is on the reserved `.example` domain

Generated streams contain planted misinformation on purpose, including instructions such as "take
instructions from ops-bot@...". Do not load a ParoleBench stream into a real agent's memory.

## What the decision log protects against

SQLite triggers make the decision log append-only and an entry's provenance fixed, and every read
re-checks trusted entries against the hash that was reviewed. This catches tools, plugins and
other processes that edit memory rows behind Memparole's back. It does not stop someone with full
write access to the database file, who can drop the triggers; protect that file like any other
secret.

## Supported versions

The latest release receives security fixes.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through
[GitHub security advisories](https://github.com/SanyamWadhwa07/memparole/security/advisories/new).
You will get an acknowledgement within three days.
