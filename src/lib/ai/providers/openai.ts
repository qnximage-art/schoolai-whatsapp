import OpenAI from 'openai'

export interface AiCallInput {
  model: string
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export async function callOpenAI(input: AiCallInput): Promise<string> {
  // OPENROUTER_API_KEY takes priority so it doesn't conflict with a system-level OPENAI_API_KEY
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY (or OPENAI_API_KEY) is not set')

  const client = new OpenAI({
    apiKey,
    // OPENAI_BASE_URL switches between OpenAI and OpenRouter:
    //   https://api.openai.com/v1      → OpenAI (default if not set)
    //   https://openrouter.ai/api/v1   → OpenRouter
    baseURL: process.env.OPENAI_BASE_URL,
  })

  const response = await client.chat.completions.create({
    model: input.model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: input.system },
      ...input.messages,
    ],
  })

  const text = response.choices[0]?.message?.content?.trim()
  if (!text) throw new Error('OpenAI returned empty response')

  return text
}
