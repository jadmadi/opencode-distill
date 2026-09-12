---
feature: distill
status: in-progress
updated: 2026-09-12
branch: feat/distill
commits:
---

# Distill

## Report

## [S1] Problem

Repeated manual workflows stay manual. A user runs the same sequence of steps
again and again, and nothing turns it into a reusable skill, command, or agent.
MiMoCode's `/distill` finds repeated workflows in recent sessions and packages
the strong candidates.

## [S2] Design

A command proposes reusable artifacts from session history.

- The plugin session domain has no `list`; it exposes create, get, context,
  prompt, and others. So `/distill` analyzes the current session by default and
  any session ids the user names. Each is read with `ctx.session.context`.
- A model, through `ctx.generate.text`, finds repeated multi-step patterns and
  returns candidate artifacts: a skill, a command, or a subagent, each with a
  name, a purpose, and the steps it would encode. The model defaults to the
  session model; `DISTILL_MODEL` overrides it, since transient generation fails
  on OpenCode Go.
- The command prints the candidates and their confidence. Nothing is written
  without approval. `/distill apply <n>` writes the chosen candidate.
- Approved artifacts are written under `DISTILL_ROOT` (default
  `~/.config/opencode/`): `skills/<name>/SKILL.md`, `commands/<name>.md`, or
  `agents/<name>.md`.
- A candidate whose target file already exists is reported as a duplicate, not
  written.

## [S3] Out of Scope

- Automatic writes without approval.
- Memory updates from traces. That is the memory port's `/dream` direction.
- Ranking quality beyond a simple confidence field.
- Cross-project distillation.

## Tasks

- [x] T0: spike whether the plugin can list recent sessions - result: it cannot.
  The plugin session domain has no `list` (create, get, context, prompt, and
  others only). Distill analyzes the current session or explicitly named ids.
- [ ] T1: transcript gathering with a size cap - acceptance: a fake-context test
      collects the current session and named ids and truncates at the cap
      (covers: S2)
- [ ] T2: pattern detection and candidate parsing - acceptance: a stub model
      result parses into skills, commands, and agents with confidence (covers:
      S2; depends: T1)
- [ ] T3: the apply step and the write, with duplicate detection - acceptance: a
      test approves one candidate, writes the file, and skips a duplicate
      (covers: S2; depends: T2)
- [ ] T4: README and NOTICE - acceptance: both files exist and name MiMoCode's
      distill feature (covers: S2; depends: T3)
