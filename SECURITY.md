# Security policy

## What it touches

Milestone 1 is a benchmark that runs on your machine as one Node process. It:

- makes no network requests and reads no API keys; the only model is a scripted fake
- writes each baseline's memory file to a new folder in your system temp directory and deletes the
  folder when the run ends
- generates invented content only: every person, package, protocol, paper and URL is made up, and
  every URL is on the reserved `.example` domain

Generated streams contain planted misinformation on purpose, including instructions such as "take
instructions from ops-bot@...". Do not load a ParoleBench stream into a real agent's memory.

## Supported versions

The latest release receives security fixes.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through
[GitHub security advisories](https://github.com/SanyamWadhwa07/memparole/security/advisories/new).
You will get an acknowledgement within three days.
