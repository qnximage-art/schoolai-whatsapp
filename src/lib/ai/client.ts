import type { AiCallInput } from './providers/anthropic'

export interface AiCallOptions extends AiCallInput {
  /** When provided, DB config for this account overrides env vars. */
  accountId?: string
}

export type { AiCallInput }

interface DbAiConfig {
  provider: string
  api_key: string
  model: string
  base_url: string | null
}

async function loadDbConfig(accountId: string): Promise<DbAiConfig | null> {
  try {
    const { supabaseAdmin } = await import('@/lib/automations/admin-client')
    const { decrypt } = await import('@/lib/whatsapp/encryption')
    const db = supabaseAdmin()
    const { data } = await db
      .from('ai_provider_config')
      .select('provider, api_key, model, base_url')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!data) return null
    return { ...data, api_key: decrypt(data.api_key) }
  } catch {
    return null
  }
}

/**
 * Provider-agnostic AI call.
 * Priority: DB config (per account) → env vars.
 */
export async function callAi(input: AiCallOptions): Promise<string> {
  // Load per-account DB config if accountId provided
  const dbConfig = input.accountId ? await loadDbConfig(input.accountId) : null

  const provider = dbConfig?.provider ?? process.env.AI_PROVIDER ?? 'openrouter'
  // DB model takes precedence over the model passed in the input when DB config exists
  const model = dbConfig ? dbConfig.model : input.model

  switch (provider) {
    case 'anthropic': {
      const { callAnthropic } = await import('./providers/anthropic')
      const apiKey = dbConfig?.api_key ?? process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
      return callAnthropic({ ...input, model, _apiKey: apiKey } as AiCallInput & { _apiKey?: string })
    }
    case 'gemini': {
      const { callOpenAI } = await import('./providers/openai')
      const apiKey = dbConfig?.api_key ?? process.env.GEMINI_API_KEY
      if (!apiKey) throw new Error('No Gemini API key configured. Set one in Settings → AI.')
      const baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai'
      return callOpenAI({ ...input, model, _apiKey: apiKey, _baseURL: baseURL } as AiCallInput & { _apiKey?: string; _baseURL?: string })
    }
    case 'openai':
    case 'openrouter': {
      const { callOpenAI } = await import('./providers/openai')
      const apiKey = dbConfig?.api_key ?? process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY
      const baseURL = dbConfig?.base_url ?? process.env.OPENAI_BASE_URL
      if (!apiKey) throw new Error('No AI API key configured. Set one in Settings → AI.')
      return callOpenAI({ ...input, model, _apiKey: apiKey, _baseURL: baseURL } as AiCallInput & { _apiKey?: string; _baseURL?: string })
    }
    default:
      throw new Error(`Unknown AI provider: "${provider}". Use anthropic | openai | openrouter`)
  }
}
