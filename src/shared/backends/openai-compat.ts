// Any server that speaks the OpenAI chat-completions shape.
//
// That covers a hosted OpenAI-compatible API, a company gateway, and a local
// Ollama or vLLM — which is the point: the free local option is how someone
// tries this without handing their unreleased product to a third party.
//
// The request stays deliberately plain. Only `model`, `messages` and
// `max_tokens` are always sent, because every provider-specific field is a
// field some compatible server rejects outright.
import type { AnalysisResult } from '@/shared/types'
import type { AnalysisRequest } from '@/shared/prompt'
import { buildSystemPrompt, buildUserPrompt } from '@/shared/prompt'
import { ANALYSIS_JSON_SCHEMA, parseAnalysis } from '@/shared/schema'
import { estimateTokens } from './estimate'
import { BackendError, type AnalyzeOptions, type Estimate, type ModelBackend } from './types'

interface ChatMessage {
  role: 'system' | 'user'
  content: string | ContentPart[]
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export const openAiCompatBackend: ModelBackend = {
  id: 'openai-compat',
  label: 'OpenAI-compatible endpoint',
  hint: 'The base URL up to and including /v1 — for a local Ollama that is http://localhost:11434/v1, and no key is needed.',
  defaults: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2-vision',
    apiKey: '',
    vision: true,
    structuredOutput: false,
  },

  estimate(req: AnalysisRequest, config): Estimate {
    return { inputTokens: estimateTokens(req, config.vision) }
  },

  async analyze(req: AnalysisRequest, { config, signal, onProgress }: AnalyzeOptions) {
    const screenshot = config.vision ? req.captures.at(-1)?.screenshot : undefined

    const userContent: string | ContentPart[] = screenshot
      ? [
          { type: 'text', text: buildUserPrompt(req) },
          { type: 'image_url', image_url: { url: screenshot } },
        ]
      : buildUserPrompt(req)

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userContent },
    ]

    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      max_tokens: 4096,
    }

    if (config.structuredOutput) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'analysis', strict: true, schema: ANALYSIS_JSON_SCHEMA },
      }
    }

    onProgress?.(`Asking ${config.model}…`)

    const response = await fetch(`${trimSlash(config.baseUrl)}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        // Omitted entirely rather than sent empty: a local server that checks
        // for the header's presence would otherwise reject an unauthenticated
        // request that was never meant to carry a key.
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new BackendError(
        `The endpoint returned ${response.status}.`,
        await safeText(response),
      )
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
      error?: { message?: string }
    }

    if (payload.error?.message) throw new BackendError(payload.error.message)

    const text = payload.choices?.[0]?.message?.content
    if (!text) throw new BackendError('The endpoint returned an empty response.')

    return finish(text, req)
  },
}

export function finish(text: string, req: AnalysisRequest): AnalysisResult {
  const captureId = req.captures.at(-1)?.id ?? ''
  const parsed = parseAnalysis(text, captureId)
  if (!parsed.ok) {
    throw new BackendError(
      `Could not read the model's answer: ${parsed.error}`,
      parsed.raw.slice(0, 600),
    )
  }
  return parsed.value
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

async function safeText(response: Response): Promise<string | undefined> {
  try {
    return (await response.text()).slice(0, 600)
  } catch {
    return undefined
  }
}
