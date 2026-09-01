# Agent instructions

Status: CANONICAL
Document version: 1.0
Last updated: 2026-09-01
Last verified: NOT VERIFIED
Owner: ProSeadure

Follow `ARCHITECTURE.md` for Sammi weather architecture. UI copy is English.

Shared machines, WireGuard, Tailscale, SSH:
`C:\Users\ADMIN\.grok\rules\proseadure-ops.md`.

## Documentation governance

The user works through vibe coding and does not manually inspect or maintain
Markdown documentation. Agents must keep documentation current, prevent
obsolete rules from being reused, and report documentation changes in plain
language.

Canonical index: `docs/README.md`.

1. Before changing behaviour, inspect `docs/README.md` and the relevant
   canonical documents.
2. Only files marked `CANONICAL` and listed in the canonical section of
   `docs/README.md` may define current requirements.
3. Update an existing canonical document when its subject changes.
4. Do not create a new policy or governance file if an existing canonical
   document already covers the subject.
5. Update documentation in the same change as the related code or
   configuration.
6. Increment the document version and set `Last updated` after every
   material documentation change.
7. Update `Last verified` only with real verification evidence (code,
   config, database, dependency, API, or production). Editing a file is
   not verification.
8. Use Git history for superseded versions. Do not create versioned
   duplicate files (`*-v2.md`).
9. Archive or clearly mark superseded documents in the same change.
10. An archived document must identify its canonical replacement.
11. Do not silently merge conflicting requirements. If canonical documents
    conflict, stop and report the conflict.
12. Keep temporary evidence out of canonical documentation: current PIDs,
    temporary row counts, transient incident state, one-time test output,
    temporary commit hashes.
13. Do not treat Markdown as proof of current production state. Live
    production facts must be independently verified on the authorised
    production host.
14. Report documentation changes to the user: old version, new version,
    last-updated date, and whether the document was genuinely verified.
15. ISO dates (`YYYY-MM-DD`). Owner: ProSeadure.
16. Minor clarification (no behavioural change): bump minor version
    (`1.3` → `1.4`). Changed policy, architecture, retention, security,
    data contract, or operational procedure: bump major version
    (`1.4` → `2.0`).
17. Do not modify files under a synced read-only `sources/` directory.
