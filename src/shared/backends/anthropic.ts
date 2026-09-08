// The Anthropic Messages API, natively.
//
// Worth having alongside the compatible path rather than going through a shim:
// the schema is enforced through a tool definition, which in practice removes
// the "model returned prose instead of JSON" failure mode entirely, and the
// vision quality is what decides whether a reaction about a cramped layout is
// real or invented.
import type { AnalysisRequest } from '@/shared/prompt'
import { buildSystemPrompt, buildUserPrompt } from '@/shared/prompt'
import { ANALYSIS_JSON_SCHEMA, parseAnalysis } from '@/shared/schema'
import type { AnalysisResult } from '@/shared/types'
import { estimateTokens } from './estimate'
import { BackendError, type AnalyzeOptions, type Estimate, type ModelBackend } from './types'

const API_VERSION = '2023-06-01'
const TOOL_NAME = 'report_reactions'

/** Per million tokens. Rough, and only used for the pre-run estimate. */
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
}

export const anthropicBackend: ModelBackend = {
  id: 'anthropic',
  label: 'Anthropic',
  hint: 'Uses the Messages API directly. The key is stored on this machine only and is never synced.',
  defaults: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-opus-5',
    apiKey: '',
    vision: true,
    structuredOutput: true,
  },

  estimate(req: AnalysisRequest, config): Estimate {
    const inputTokens = estimateTokens(req, config.vision)
    const price = PRICING[config.model]
    if (!price) return { inputTokens }
    // Output is bounded by the schema and runs 1–2k tokens in practice.
    return { inputTokens, usd: (inputTokens * price.in + 1500 * price.out) / 1_000_000 }
  },

  async analyze(req: AnalysisRequest, { config, signal, onProgress }: AnalyzeOptions) {
    const screenshot = config.vision ? req.captures.at(-1)?.screenshot : undefined

    const content: unknown[] = [{ type: 'text', text: buildUserPrompt(req) }]
    if (screenshot) {
      const parsed = parseDataUrl(screenshot)
      if (parsed) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data },
        })
      }
    }

    onProgress?.(`Asking ${config.model}…`)

    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': API_VERSION,
        // Without this the API refuses browser-origin requests outright.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 4096,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content }],
        // A forced tool call is how the schema becomes a guarantee rather than
        // a request: there is no path by which the model replies with prose.
        tools: [
          {
            name: TOOL_NAME,
            description: 'Report what this person thought and did, in order.',
            input_schema: ANALYSIS_JSON_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => undefined)
      throw new BackendError(`Anthropic returned ${response.status}.`, detail?.slice(0, 600))
    }

    const payload = (await response.json()) as {
      content?: { type: string; name?: string; input?: unknown }[]
      usage?: { input_tokens?: number; output_tokens?: number }
    }

    const toolUse = payload.content?.find((block) => block.type === 'tool_use' && block.name === TOOL_NAME)
    if (!toolUse?.input) throw new BackendError('Anthropic did not return the expected tool call.')

    const captureId = req.captures.at(-1)?.id ?? ''
    const parsed = parseAnalysis(JSON.stringify(toolUse.input), captureId)
    if (!parsed.ok) throw new BackendError(`Could not read the answer: ${parsed.error}`, parsed.raw)

    const result: AnalysisResult = parsed.value
    result.usage = {
      inputTokens: payload.usage?.input_tokens,
      outputTokens: payload.usage?.output_tokens,
    }
    return result
  },
}

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  return match ? { mediaType: match[1]!, data: match[2]! } : null
}
