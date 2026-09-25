# AGENTS.md

Guidance for agents working in this repository.

## What this is

An OpenCode V2 plugin (`distill.ts`) that reads session history, asks a model for
repeated multi-step workflows, and proposes skills, commands, or subagents. It
writes only what the user approves. No build step, no dependencies, AGPL-3.0-only.

## Local development

```sh
bun test
cp distill.ts ~/.config/opencode/plugins/distill.ts
touch ~/.config/opencode/plugins/distill.ts
```

Check the server log when something is off:

```sh
grep distill ~/.local/share/opencode/log/opencode.log | tail
```

## Spike result (T0)

The plugin session domain has no `list`; it exposes create, get, context, prompt,
and others. So distill analyzes the current session by default and any session
ids the user names, each read with `ctx.session.context`.

## Hard constraints

- Do not import `@opencode/plugin`. Export a plain `{ id, setup }` object.
- Keep the plugin dependency-free. Use Bun globals for file access.
- Never write an artifact without an explicit `/distill apply`.
- Never overwrite an existing artifact; report it as a duplicate.
- Plugin `console` output is not visible to users. A command surfaces messages
  only by throwing.

## API notes

- `ctx.session.context({ sessionID })` returns the messages to analyze.
- `ctx.generate.text({ model, prompt })` runs the analysis. The model comes from
  the session; `DISTILL_MODEL` overrides it, since transient generation fails on
  OpenCode Go.
- The last proposal lives in `ctx.storage` under `distill/<sessionID>`.
- `DISTILL_ROOT` overrides the output directory, which tests rely on.

## Layout

- `parseCandidates` - extracts the JSON candidate list, exported for tests.
- `candidatePrompt` - the analysis prompt, exported for tests.
- `gatherTranscript` - reads and caps the history, exported for tests.
- `writeArtifact` - writes one approved artifact, exported for tests.
- `setup` - registers the command.
- `distill.test.ts` - tests with a fake ctx.

## Releasing

- Semantic commit messages. Changes through a feature branch and a PR.
- Keep `NOTICE` accurate.
