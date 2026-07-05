import OpenAI from 'openai'

export interface AiCallInput {
  model: string
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export async function callOpenAI(input: AiCallInput & { _apiKey?: string; _baseURL?: string }): Promise<string> {
  const apiKey = input._apiKey ?? process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY (or OPENAI_API_KEY) is not set')

  const client = new OpenAI({
    apiKey,
    baseURL: input._baseURL ?? process.env.OPENAI_BASE_URL,
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
