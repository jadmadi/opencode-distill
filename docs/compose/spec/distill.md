---
feature: distill
status: delivered
updated: 2026-09-13
branch: feat/distill
commits: 4d12623..54955c0
---

# Distill

## Report

**What was built** - A single-file OpenCode V2 plugin that reads session history,
asks a model for repeated multi-step workflows, and proposes skills, commands, or
subagents. `/distill` analyzes the current session, `/distill <id> ...` analyzes
named ones, `/distill list` shows the last proposal, and `/distill apply <n>`
writes the chosen artifact under `DISTILL_ROOT` (default `~/.config/opencode`).
Names must be kebab-case, and an existing file is never overwritten.
`DISTILL_MODEL` overrides the model.

**Verification** - `bun test`: 20 pass, 0 fail, 43 assertions. Live: the command
registered; an empty-session analysis returned "No candidates found." and a bare
apply returned the usage error. Three review rounds covered one blocking item
plus several mediums and lows; all are resolved.

**Journey log**

1. The plugin session domain has no `list`, so distill analyzes the current
   session or ids the user names.
2. A model-chosen name could escape `DISTILL_ROOT`. Names are now restricted to
   kebab-case, which also keeps frontmatter safe.
3. The first extractor rewarded the wrong input: a non-JSON fence shadowed a real
   array, and brackets inside strings dropped valid JSON. It now validates each
   fenced block and scans balanced brackets outside strings.

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
- [x] T1: transcript gathering with a size cap - acceptance: a fake-context test
      collects the current session and named ids and truncates at the cap
      (covers: S2)
- [x] T2: pattern detection and candidate parsing - acceptance: a stub model
      result parses into skills, commands, and agents with confidence (covers:
      S2; depends: T1)
- [x] T3: the apply step and the write, with duplicate detection - acceptance: a
      test approves one candidate, writes the file, and skips a duplicate
      (covers: S2; depends: T2)
- [x] T4: README and NOTICE - acceptance: both files exist and name MiMoCode's
      distill feature (covers: S2; depends: T3)
