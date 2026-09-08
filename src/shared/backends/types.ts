// The seam between "what we ask" and "who answers".
//
// One interface, a registry, and settings namespaced per backend id. The
// endpoint people use today is the one their team already pays for; the one
// they use next year is not. Nothing above this layer knows which is in play.
import type { AnalysisResult } from '@/shared/types'
import type { AnalysisRequest } from '@/shared/prompt'
import type { BackendConfig } from '@/shared/settings'

export interface AnalyzeOptions {
  config: BackendConfig
  signal: AbortSignal
  /** Progress for the panel, e.g. which stage a slow local model is at. */
  onProgress?: (detail: string) => void
}

export interface Estimate {
  inputTokens: number
  /** Only when the backend knows this model's price. Absent is not zero. */
  usd?: number
}

export interface ModelBackend {
  id: string
  label: string
  /** What a fresh config for this backend should start as. */
  defaults: BackendConfig
  /** Shown under the endpoint field on the options page. */
  hint: string
  analyze(req: AnalysisRequest, options: AnalyzeOptions): Promise<AnalysisResult>
  estimate(req: AnalysisRequest, config: BackendConfig): Estimate
}

/** Raised when the endpoint answered, but not with anything usable. */
export class BackendError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'BackendError'
  }
}
