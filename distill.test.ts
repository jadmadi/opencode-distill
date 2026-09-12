import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin, { artifactPath, gatherTranscript, parseCandidates, parseModelRef, writeArtifact } from "./distill.ts"

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
  const ctx: any = {
    storage: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => void store.set(key, value),
      remove: async (key: string) => void store.delete(key),
    },
    session: {
      context: async () =>
        options.messages ?? [
          { type: "user", text: "run the tests" },
          { type: "assistant", content: [{ type: "text", text: "ran the tests" }] },
        ],
      get: async () => ({ model: options.model === undefined ? { providerID: "p", id: "m" } : options.model }),
    },
    generate: { text: async () => ({ text: options.json ?? "[]" }) },
    command: { transform: (callback: any) => callback({ add: (definition: any) => commands.push(definition) }) },
  }
  return { ctx, store, commands }
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

  test("extracts JSON from prose", () => {
    const parsed = parseCandidates('Here you go:\n[{"name":"x","purpose":"y"}]\nDone.')
    expect(parsed).toHaveLength(1)
    expect(parsed[0].kind).toBe("skill")
    expect(parsed[0].confidence).toBe("medium")
  })

  test("returns nothing for bad input", () => {
    expect(parseCandidates("no json here")).toEqual([])
    expect(parseCandidates("[not json]")).toEqual([])
    expect(parseCandidates(undefined)).toEqual([])
  })

  test("drops entries without a name or purpose", () => {
    expect(parseCandidates('[{"name":"a"},{"purpose":"b"},{"name":"c","purpose":"d"}]')).toHaveLength(1)
  })
})

describe("parseModelRef", () => {
  test("parses and trims", () => {
    expect(parseModelRef(" deepseek/deepseek-flash ")).toEqual({ providerID: "deepseek", id: "deepseek-flash" })
    expect(parseModelRef("bad")).toBeUndefined()
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

  test("caps the transcript", async () => {
    const { ctx } = makeCtx({ messages: [{ type: "assistant", content: [{ type: "text", text: "x".repeat(70000) }] }] })
    const transcript = await gatherTranscript(ctx, ["ses_1"])
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
    expect(text).toContain('description: "Check a deploy"')
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
  })

  test("analyzes named sessions", async () => {
    const { ctx, commands } = makeCtx({ json: "[]" })
    await (plugin as any).setup(ctx)
    await expect(commands[0].execute({ sessionID: "ses_1", prompt: { text: "ses_2 ses_3" } })).rejects.toThrow(/No candidates/)
  })

  test("fails without a model", async () => {
    root()
    const { ctx, commands } = makeCtx({ model: null })
    await (plugin as any).setup(ctx)
    await expect(commands[0].execute({ sessionID: "ses_1", prompt: { text: "" } })).rejects.toThrow(/DISTILL_MODEL/)
  })

  test("registers the command", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    expect(commands.map((entry) => entry.name)).toEqual(["distill"])
  })
})
