import type { AiCallInput } from './providers/anthropic'

export type { AiCallInput }

/**
 * Provider-agnostic AI call. Switch provider by setting AI_PROVIDER env var.
 * No code changes needed to swap between Anthropic, OpenAI, or OpenRouter.
 */
export async function callAi(input: AiCallInput): Promise<string> {
  const provider = process.env.AI_PROVIDER ?? 'anthropic'

  switch (provider) {
    case 'anthropic': {
      const { callAnthropic } = await import('./providers/anthropic')
      return callAnthropic(input)
    }
    case 'openai':
    case 'openrouter': {
      const { callOpenAI } = await import('./providers/openai')
      return callOpenAI(input)
    }
    default:
      throw new Error(`Unknown AI_PROVIDER: "${provider}". Use anthropic | openai | openrouter`)
  }
}
