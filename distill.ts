// OpenCode V2 distill plugin.
//
// Reads session history, asks a model for repeated multi-step workflows, and
// proposes skills, commands, or subagents. Nothing is written until the user
// runs `/distill apply <n>`, and an existing artifact is never overwritten.
//
// The plugin session domain has no `list`, so distill analyzes the current
// session by default and any session ids the user names.
//
// The runtime does not resolve @opencode/plugin, so this file exports a plain
// { id, setup } object.

type Kind = "skill" | "command" | "agent"

interface Candidate {
  kind: Kind
  name: string
  purpose: string
  steps: string[]
  confidence: "high" | "medium" | "low"
}

const CAP = 60000
const KINDS: Kind[] = ["skill", "command", "agent"]
const CONFIDENCES = ["high", "medium", "low"]

function outputRoot(): string {
  if (process.env.DISTILL_ROOT) return process.env.DISTILL_ROOT
  const base = process.env.XDG_CONFIG_HOME || (process.env.HOME ? `${process.env.HOME}/.config` : undefined)
  return base ? `${base}/opencode` : ".opencode"
}

function parseModelRef(ref: string | undefined): { providerID: string; id: string } | undefined {
  if (!ref) return undefined
  const cleaned = ref.trim()
  const slash = cleaned.indexOf("/")
  if (slash < 1 || slash === cleaned.length - 1) return undefined
  return { providerID: cleaned.slice(0, slash), id: cleaned.slice(slash + 1) }
}

function candidatePrompt(transcript: string): string {
  return [
    "Find repeated multi-step workflows in the session transcript below.",
    "A candidate must appear at least twice, or be a clearly reusable procedure.",
    "Return a JSON array and nothing else. Each item is:",
    '{"kind":"skill|command|agent","name":"kebab-case","purpose":"one sentence","steps":["..."],"confidence":"high|medium|low"}',
    "Prefer high-confidence, concrete workflows. If there are none, return [].",
    "",
    transcript,
  ].join("\n")
}

function parseCandidates(text: unknown): Candidate[] {
  const raw = typeof text === "string" ? text : ""
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start === -1 || end === -1 || end < start) return []
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item: any) => ({
        kind: KINDS.includes(item.kind) ? item.kind : ("skill" as Kind),
        name: typeof item.name === "string" ? item.name.trim() : "",
        purpose: typeof item.purpose === "string" ? item.purpose.trim() : "",
        steps: Array.isArray(item.steps) ? item.steps.filter((step: unknown) => typeof step === "string") : [],
        confidence: CONFIDENCES.includes(item.confidence) ? item.confidence : ("medium" as Candidate["confidence"]),
      }))
      .filter((candidate) => candidate.name && candidate.purpose)
  } catch {
    return []
  }
}

async function gatherTranscript(ctx: any, sessionIDs: string[]): Promise<string> {
  const parts: string[] = []
  let used = 0
  for (const sessionID of sessionIDs) {
    const messages = await ctx.session.context({ sessionID }).catch(() => [])
    const list: any[] = Array.isArray(messages) ? messages : (messages?.data ?? [])
    const lines: string[] = []
    for (const message of list) {
      if (message?.type === "user") lines.push(`USER: ${message.text ?? ""}`)
      else if (message?.type === "assistant") {
        const content: any[] = Array.isArray(message.content) ? message.content : []
        const text = content
          .filter((part) => part?.type === "text")
          .map((part) => part.text ?? "")
          .join(" ")
        lines.push(`ASSISTANT: ${text}`)
      }
    }
    const block = `## Session ${sessionID}\n${lines.join("\n")}`
    if (used + block.length > CAP) {
      const room = CAP - used
      if (room > 0) parts.push(block.slice(0, room))
      break
    }
    parts.push(block)
    used += block.length
  }
  return parts.join("\n\n")
}

async function resolveModel(ctx: any, sessionID: string): Promise<{ providerID: string; id: string } | undefined> {
  const override = parseModelRef(process.env.DISTILL_MODEL)
  if (override) return override
  const info: any = await ctx.session.get({ sessionID }).catch(() => undefined)
  return info?.model ?? info?.data?.model
}

function artifactPath(candidate: Candidate): string {
  const root = outputRoot()
  if (candidate.kind === "skill") return `${root}/skills/${candidate.name}/SKILL.md`
  if (candidate.kind === "command") return `${root}/commands/${candidate.name}.md`
  return `${root}/agents/${candidate.name}.md`
}

function renderArtifact(candidate: Candidate): string {
  const purpose = candidate.purpose.replace(/"/g, "'")
  if (candidate.kind === "skill") {
    return [
      "---",
      `name: ${candidate.name}`,
      `description: "${purpose}"`,
      "---",
      "",
      candidate.purpose,
      "",
      "## Steps",
      ...candidate.steps.map((step, index) => `${index + 1}. ${step}`),
      "",
    ].join("\n")
  }
  if (candidate.kind === "command") {
    return [
      "---",
      `description: "${purpose}"`,
      "---",
      "",
      candidate.purpose,
      "",
      ...candidate.steps.map((step) => `- ${step}`),
      "",
    ].join("\n")
  }
  return [
    "---",
    `description: "${purpose}"`,
    "mode: subagent",
    "---",
    "",
    candidate.purpose,
    "",
    ...candidate.steps.map((step) => `- ${step}`),
    "",
  ].join("\n")
}

async function writeArtifact(candidate: Candidate): Promise<"written" | "duplicate"> {
  const path = artifactPath(candidate)
  if (await Bun.file(path).exists()) return "duplicate"
  await Bun.write(path, renderArtifact(candidate))
  return "written"
}

function describe(candidates: Candidate[]): string {
  if (candidates.length === 0) return "No candidates found."
  return candidates
    .map((candidate, index) => `${index + 1}. [${candidate.confidence}] ${candidate.kind} ${candidate.name}: ${candidate.purpose} (${candidate.steps.length} steps)`)
    .join("\n")
}

const plugin = {
  id: "distill",
  async setup(ctx: any) {
    await ctx.command.transform((editor: any) => {
      editor.add({
        name: "distill",
        description: "Find repeated workflows and propose skills, commands, or subagents",
        execute: async ({ sessionID, prompt }: any) => {
          if (typeof sessionID !== "string") throw new Error("distill needs a session id")
          const text = typeof prompt?.text === "string" ? prompt.text.trim() : ""
          const lower = text.toLowerCase()

          if (lower.startsWith("apply ")) {
            const index = Number(text.slice(6).trim())
            const stored = await ctx.storage.get(`distill/${sessionID}`)
            const candidates = Array.isArray(stored) ? (stored as Candidate[]) : []
            if (!Number.isInteger(index) || index < 1 || index > candidates.length) {
              throw new Error("use /distill apply <n> after a proposal")
            }
            const candidate = candidates[index - 1]
            const result = await writeArtifact(candidate)
            if (result === "duplicate") throw new Error(`already exists: ${artifactPath(candidate)}`)
            return
          }

          if (lower === "list") {
            const stored = await ctx.storage.get(`distill/${sessionID}`)
            const candidates = Array.isArray(stored) ? (stored as Candidate[]) : []
            throw new Error(describe(candidates))
          }

          const named = text.split(/\s+/).filter((value) => value.startsWith("ses"))
          const targets = named.length ? named : [sessionID]
          const transcript = await gatherTranscript(ctx, targets)
          const model = await resolveModel(ctx, sessionID)
          if (!model?.providerID || !model?.id) throw new Error("could not resolve the model; set DISTILL_MODEL")

          const result = await ctx.generate.text({
            model: { providerID: model.providerID, id: model.id },
            prompt: candidatePrompt(transcript),
          })
          const candidates = parseCandidates(result?.text)
          await ctx.storage.set(`distill/${sessionID}`, candidates)
          throw new Error(describe(candidates))
        },
      })
    })
  },
}

export { artifactPath, gatherTranscript, parseCandidates, parseModelRef, renderArtifact, writeArtifact }
export default plugin
