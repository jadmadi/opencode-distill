import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin, { artifactPath, gatherTranscript, parseCandidates, parseModelRef, renderArtifact, writeArtifact, VERSION } from "./distill.ts"

const tempDirs: string[] = []

afterEach(() => {
  delete process.env.DISTILL_ROOT
  delete process.env.DISTILL_MODEL
  while (tempDirs.length) rmSync(tempDirs.pop() as string, { recursive: true, force: true })
})

function root() {
  const dir = mkdtempSync(join(tmpdir(), "distill-test-"))
  tempDirs.push(dir)
  process.env.DISTILL_ROOT = dir
  return dir
}

function makeCtx(options: { model?: any; messages?: any[]; json?: string } = {}) {
  const store = new Map<string, unknown>()
  const commands: any[] = []
  const contextCalls: string[] = []
  const ctx: any = {
    storage: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => void store.set(key, value),
      remove: async (key: string) => void store.delete(key),
    },
    session: {
      context: async (input: any) => {
        contextCalls.push(input.sessionID)
        return (
          options.messages ?? [
            { type: "user", text: "run the tests" },
            { type: "assistant", content: [{ type: "text", text: "ran the tests" }] },
          ]
        )
      },
      get: async () => ({ model: options.model === undefined ? { providerID: "p", id: "m" } : options.model }),
    },
    generate: { text: async () => ({ text: options.json ?? "[]" }) },
    command: { transform: (callback: any) => callback({ add: (definition: any) => commands.push(definition) }) },
  }
  return { ctx, store, commands, contextCalls }
}

const skill = {
  kind: "skill" as const,
  name: "deploy-check",
  purpose: "Check a deploy",
  steps: ["run tests", "tag"],
  confidence: "high" as const,
}

describe("parseCandidates", () => {
  test("reads a JSON array", () => {
    const parsed = parseCandidates('[{"kind":"command","name":"ship","purpose":"Ship it","steps":["a"],"confidence":"high"}]')
    expect(parsed).toEqual([{ kind: "command", name: "ship", purpose: "Ship it", steps: ["a"], confidence: "high" }])
  })

  test("extracts fenced JSON and JSON from prose", () => {
    expect(parseCandidates('```json\n[{"name":"x","purpose":"y"}]\n```')).toHaveLength(1)
    expect(parseCandidates('Here you go:\n[{"name":"x","purpose":"y"}]\nDone.')).toHaveLength(1)
  })

  test("does not let a non-JSON fence shadow a real array", () => {
    expect(parseCandidates('Example:\n```\nplain text\n```\n[{"name":"x","purpose":"y"}]')).toHaveLength(1)
    expect(parseCandidates('[{"name":"x","purpose":"y"}]\n```\nplain text\n```')).toHaveLength(1)
  })

  test("ignores brackets inside strings", () => {
    expect(parseCandidates('[{"name":"x","purpose":"close ] tag"}]')).toHaveLength(1)
    expect(parseCandidates('[{"name":"x","purpose":"open [ tag"}]')).toHaveLength(1)
  })

  test("returns nothing for bad input", () => {
    expect(parseCandidates("no json here")).toEqual([])
    expect(parseCandidates("[not json]")).toEqual([])
    expect(parseCandidates(undefined)).toEqual([])
  })

  test("drops entries without a name or purpose", () => {
    expect(parseCandidates('[{"name":"a"},{"purpose":"b"},{"name":"c","purpose":"d"}]')).toHaveLength(1)
  })

  test("rejects unsafe names", () => {
    expect(parseCandidates('[{"name":"../../escape","purpose":"x"}]')).toEqual([])
    expect(parseCandidates('[{"name":"Deploy Check","purpose":"x"}]')).toEqual([])
    expect(parseCandidates('[{"name":"a:b","purpose":"x"}]')).toEqual([])
  })
})

describe("parseModelRef", () => {
  test("parses and trims", () => {
    expect(parseModelRef(" deepseek/deepseek-flash ")).toEqual({ providerID: "deepseek", id: "deepseek-flash" })
    expect(parseModelRef("bad")).toBeUndefined()
  })
})

describe("renderArtifact", () => {
  test("renders an agent with the subagent mode", () => {
    const text = renderArtifact({ kind: "agent", name: "helper", purpose: "Helps", steps: ["a"], confidence: "high" })
    expect(text).toContain("mode: subagent")
  })

  test("escapes a tricky purpose", () => {
    const purpose = 'ends with \\ and says "hi"'
    const text = renderArtifact({ kind: "command", name: "x", purpose, steps: [], confidence: "low" })
    expect(text).toContain('description: "ends with \\\\ and says \\"hi\\""')
  })
})

describe("gatherTranscript", () => {
  test("reads user and assistant text", async () => {
    const { ctx } = makeCtx()
    const transcript = await gatherTranscript(ctx, ["ses_1"])
    expect(transcript).toContain("## Session ses_1")
    expect(transcript).toContain("USER: run the tests")
    expect(transcript).toContain("ASSISTANT: ran the tests")
  })

  test("caps the transcript across sessions", async () => {
    const { ctx } = makeCtx({ messages: [{ type: "assistant", content: [{ type: "text", text: "x".repeat(35000) }] }] })
    const transcript = await gatherTranscript(ctx, ["ses_1", "ses_2"])
    expect(transcript.length).toBeLessThanOrEqual(60000)
  })

  test("reads several sessions", async () => {
    const { ctx } = makeCtx()
    const transcript = await gatherTranscript(ctx, ["ses_1", "ses_2"])
    expect(transcript).toContain("## Session ses_1")
    expect(transcript).toContain("## Session ses_2")
  })
})

describe("writeArtifact", () => {
  test("writes a skill and reports a duplicate", async () => {
    const dir = root()
    expect(artifactPath(skill)).toBe(join(dir, "skills/deploy-check/SKILL.md"))
    expect(await writeArtifact(skill)).toBe("written")
    const path = join(dir, "skills/deploy-check/SKILL.md")
    expect(existsSync(path)).toBe(true)
    const text = readFileSync(path, "utf8")
    expect(text).toContain("name: deploy-check")
    expect(text).toContain("1. run tests")
    expect(await writeArtifact(skill)).toBe("duplicate")
  })

  test("writes a command with a description", async () => {
    const dir = root()
    const command = { ...skill, kind: "command" as const, name: "ship" }
    await writeArtifact(command)
    const text = readFileSync(join(dir, "commands/ship.md"), "utf8")
    expect(text).toContain(`description: ${JSON.stringify("Check a deploy")}`)
    expect(text).toContain("- run tests")
  })
})

describe("command", () => {
  const proposals = JSON.stringify([
    { kind: "command", name: "ship", purpose: "Ship it", steps: ["test", "push"], confidence: "high" },
  ])

  test("proposes candidates, lists them, and applies one", async () => {
    const dir = root()
    const { ctx, commands } = makeCtx({ json: proposals })
    await (plugin as any).setup(ctx)
    const run = (text: string) => commands[0].execute({ sessionID: "ses_1", prompt: { text } })

    await expect(run("")).rejects.toThrow(/command ship/)
    await expect(run("list")).rejects.toThrow(/Ship it/)
    await run("apply 1")
    expect(existsSync(join(dir, "commands/ship.md"))).toBe(true)
    await expect(run("apply 1")).rejects.toThrow(/already exists/)
    await expect(run("apply 9")).rejects.toThrow(/after a proposal/)
    await expect(run("apply")).rejects.toThrow(/after a proposal/)
  })

  test("analyzes named sessions", async () => {
    const { ctx, commands, contextCalls } = makeCtx({ json: "[]" })
    await (plugin as any).setup(ctx)
    await expect(commands[0].execute({ sessionID: "ses_1", prompt: { text: "ses_2 ses_3" } })).rejects.toThrow(/No candidates/)
    expect(contextCalls).toEqual(["ses_2", "ses_3"])
  })

  test("fails without a model", async () => {
    root()
    const { ctx, commands } = makeCtx({ model: null })
    await (plugin as any).setup(ctx)
    await expect(commands[0].execute({ sessionID: "ses_1", prompt: { text: "" } })).rejects.toThrow(/DISTILL_MODEL/)
  })

  test("DISTILL_MODEL overrides a missing session model", async () => {
    root()
    process.env.DISTILL_MODEL = "deepseek/deepseek-flash"
    const { ctx, commands } = makeCtx({ model: null, json: proposals })
    await (plugin as any).setup(ctx)
    await expect(commands[0].execute({ sessionID: "ses_1", prompt: { text: "" } })).rejects.toThrow(/command ship/)
  })

  test("registers the command", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    expect(commands.map((entry) => entry.name)).toEqual(["distill"])
  })
})

describe("version", () => {
  test("VERSION matches package.json", async () => {
    const pkg = (await Bun.file(new URL("./package.json", import.meta.url)).json()) as { version: string }
    expect(VERSION).toBe(pkg.version)
  })
})
