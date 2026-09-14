# opencode-distill

An OpenCode V2 plugin that finds repeated multi-step workflows in session
history and proposes reusable artifacts: a skill, a command, or a subagent.

## OpenCode

This plugin runs on OpenCode. Install it with my referral link:

https://opencode.ai/go?ref=N9H3ZEP22A

## Install

```sh
mkdir -p ~/.config/opencode/plugins
curl -fsSL \
  https://raw.githubusercontent.com/jadmadi/opencode-distill/main/distill.ts \
  -o ~/.config/opencode/plugins/distill.ts
```

For one project, put it in `.opencode/plugins/`. Tested against OpenCode v2.0.3.

To pin a release, replace `main` in the URL with a tag such as `v0.1.0`.

## Use

| Command                    | Effect                                        |
| -------------------------- | --------------------------------------------- |
| `/distill`                 | Analyze the current session                   |
| `/distill <sessionID> ...` | Analyze named sessions                        |
| `/distill list`            | Show the last proposal                        |
| `/distill apply <n>`       | Write the candidate numbered `n`              |

The command prints the candidates and their confidence. Nothing is written until
`apply`. A candidate whose target file already exists is reported as a duplicate.

## Where files go

Approved artifacts are written under `DISTILL_ROOT`, or `~/.config/opencode/` by
default:

```text
skills/<name>/SKILL.md
commands/<name>.md
agents/<name>.md
```

## Model

The analysis uses the session's model. Some providers do not support transient
generation: OpenCode Go returned `Request is missing x-opencode-session` in
testing. Set `DISTILL_MODEL` to a working model, for example
`DISTILL_MODEL=deepseek/deepseek-flash`.

## Tests

```sh
bun test
```

## Attribution

Inspired by MiMoCode's `/distill`. See `NOTICE`.

## License

MIT
