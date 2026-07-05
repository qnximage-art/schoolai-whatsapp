import Anthropic from '@anthropic-ai/sdk'

export interface AiCallInput {
  model: string
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export async function callAnthropic(input: AiCallInput & { _apiKey?: string }): Promise<string> {
  const apiKey = input._apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: input.model,
    max_tokens: 1024,
    system: input.system,
    messages: input.messages,
  })

  const block = response.content[0]
  if (block.type !== 'text' || !block.text.trim()) {
    throw new Error('Anthropic returned empty response')
  }

  return block.text.trim()
}
