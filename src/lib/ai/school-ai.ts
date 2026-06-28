import type { SchoolKnowledgeBase } from '@/types'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { callAi } from './client'

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export interface GetAiReplyInput {
  accountId: string
  contactId: string
  conversationId: string
  messageText: string
  /** Full model string for the configured provider, e.g. "claude-haiku-4-5-20251001" or "gpt-4o-mini" */
  model?: string
}

export type AiReplyResult =
  | { action: 'reply'; text: string; language: 'en' | 'hi' }
  | { action: 'escalate'; reason: string }

export interface GetSuggestedReplyInput {
  accountId: string
  conversationId: string
  /** Full model string for the configured provider */
  model?: string
}

// ------------------------------------------------------------
// Escalation keywords
// ------------------------------------------------------------

const UNCERTAINTY_PHRASES = [
  "i don't know",
  "not sure",
  "please contact",
  "i'm unable",
  "i cannot",
  "i am unable",
]

const ESCALATION_KEYWORDS = [
  'complaint',
  'urgent',
  'problem',
  'issue',
  'wrong',
  'शिकायत',
  'जरूरी',
  'समस्या',
]

// ------------------------------------------------------------
// Pure helpers
// ------------------------------------------------------------

export function buildSchoolPrompt(kb: SchoolKnowledgeBase, language: 'en' | 'hi'): string {
  const langInstruction =
    language === 'hi'
      ? 'Always reply in Hindi (Devanagari script).'
      : 'Always reply in English.'

  return `You are a helpful school assistant for ${kb.school_name}.
Answer parent questions using ONLY the information below. If you cannot answer confidently, say "I'm not sure, please contact the school directly."
Do not make up information. Keep replies short and friendly.
${langInstruction}

SCHOOL INFORMATION:
- School hours: ${kb.school_hours}
- Fee due date: ${kb.fee_due_date}
- Holidays: ${kb.holidays}
- Exam schedule: ${kb.exam_schedule}
- Admission info: ${kb.admission_info}
- Additional FAQs: ${kb.extra_faq}`
}

function detectLanguage(text: string): 'en' | 'hi' {
  // Devanagari Unicode block: U+0900–U+097F
  const hindiChars = (text.match(/[ऀ-ॿ]/g) ?? []).length
  return hindiChars > 2 ? 'hi' : 'en'
}

function isWithinSchoolHours(kb: SchoolKnowledgeBase): boolean {
  const now = new Date()
  const [startH, startM] = kb.ai_hours_start.split(':').map(Number)
  const [endH, endM] = kb.ai_hours_end.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return nowMinutes >= startMinutes && nowMinutes <= endMinutes
}

function containsEscalationKeyword(text: string): boolean {
  const lower = text.toLowerCase()
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw))
}

function containsUncertaintyPhrase(text: string): boolean {
  const lower = text.toLowerCase()
  return UNCERTAINTY_PHRASES.some((phrase) => lower.includes(phrase))
}

// ------------------------------------------------------------
// Load helpers (DB reads)
// ------------------------------------------------------------

async function loadKnowledgeBase(accountId: string): Promise<SchoolKnowledgeBase | null> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('school_knowledge_base')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  return data as SchoolKnowledgeBase | null
}

async function loadRecentMessages(
  conversationId: string,
  limit: number,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('messages')
    .select('content, sender_type')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!data) return []

  return (data as Array<{ content: string; sender_type: string }>)
    .reverse()
    .map((m) => ({
      role: m.sender_type === 'contact' ? ('user' as const) : ('assistant' as const),
      content: m.content ?? '',
    }))
    .filter((m) => m.content.trim())
}

async function isAlreadyEscalated(conversationId: string): Promise<boolean> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('ai_conversation_context')
    .select('escalated_at')
    .eq('conversation_id', conversationId)
    .maybeSingle()
  return !!(data as { escalated_at: string | null } | null)?.escalated_at
}

async function upsertAiContext(
  conversationId: string,
  accountId: string,
  update: { ai_active: boolean; escalated_at?: string; escalation_reason?: string; last_ai_reply_at?: string },
): Promise<void> {
  const db = supabaseAdmin()
  await db.from('ai_conversation_context').upsert(
    { conversation_id: conversationId, account_id: accountId, ...update },
    { onConflict: 'conversation_id' },
  )
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export async function getAiReply(input: GetAiReplyInput): Promise<AiReplyResult> {
  const { accountId, contactId, conversationId, messageText, model = 'claude-haiku-4-5-20251001' } = input

  // Skip empty messages
  if (!messageText.trim()) {
    return { action: 'escalate', reason: 'empty message' }
  }

  // Escalation keyword check — no need to call Claude
  if (containsEscalationKeyword(messageText)) {
    await upsertAiContext(conversationId, accountId, {
      ai_active: false,
      escalated_at: new Date().toISOString(),
      escalation_reason: 'escalation keyword in message',
    })
    return { action: 'escalate', reason: 'escalation keyword in message' }
  }

  // Already escalated in this conversation
  if (await isAlreadyEscalated(conversationId)) {
    return { action: 'escalate', reason: 'previously escalated' }
  }

  // Load knowledge base
  const kb = await loadKnowledgeBase(accountId)
  if (!kb) {
    await upsertAiContext(conversationId, accountId, {
      ai_active: false,
      escalated_at: new Date().toISOString(),
      escalation_reason: 'no knowledge base configured',
    })
    return { action: 'escalate', reason: 'no knowledge base configured' }
  }

  const language =
    kb.ai_language === 'auto' ? detectLanguage(messageText) : (kb.ai_language as 'en' | 'hi')

  const outsideHours = !isWithinSchoolHours(kb)

  // Load recent conversation history
  const history = await loadRecentMessages(conversationId, 5)

  const systemPrompt = buildSchoolPrompt(kb, language)

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...history,
    { role: 'user', content: messageText },
  ]

  let replyText: string
  try {
    replyText = await callAi({ model, system: systemPrompt, messages })
  } catch (err) {
    const reason = `AI error: ${err instanceof Error ? err.message : String(err)}`
    await upsertAiContext(conversationId, accountId, {
      ai_active: false,
      escalated_at: new Date().toISOString(),
      escalation_reason: reason,
    })
    return { action: 'escalate', reason }
  }

  // Escalate if Claude is uncertain or outside hours
  if (containsUncertaintyPhrase(replyText) || outsideHours) {
    const reason = outsideHours ? 'outside school hours' : 'low AI confidence'
    await upsertAiContext(conversationId, accountId, {
      ai_active: false,
      escalated_at: new Date().toISOString(),
      escalation_reason: reason,
    })
    return { action: 'escalate', reason }
  }

  await upsertAiContext(conversationId, accountId, {
    ai_active: true,
    last_ai_reply_at: new Date().toISOString(),
  })

  return { action: 'reply', text: replyText, language }
}

export async function getSuggestedReply(input: GetSuggestedReplyInput): Promise<{ suggestion: string }> {
  const { accountId, conversationId, model = 'claude-haiku-4-5-20251001' } = input

  const kb = await loadKnowledgeBase(accountId)
  const history = await loadRecentMessages(conversationId, 10)

  const system = kb
    ? `You are helping a school staff member reply to a parent on WhatsApp for ${kb.school_name}.
Suggest a short, friendly reply based on the conversation and the school information below.
Only suggest — the staff member will review before sending.

SCHOOL INFORMATION:
- School hours: ${kb.school_hours}
- Fee due date: ${kb.fee_due_date}
- Holidays: ${kb.holidays}
- Exam schedule: ${kb.exam_schedule}
- Admission info: ${kb.admission_info}
- Additional FAQs: ${kb.extra_faq}`
    : `You are helping a school staff member reply to a parent on WhatsApp.
Suggest a short, friendly reply based on the conversation.`

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = history.length
    ? [...history, { role: 'user', content: 'Suggest a reply for the last parent message.' }]
    : [{ role: 'user', content: 'Suggest a friendly reply to start the conversation.' }]

  const suggestion = await callAi({ model, system, messages })
  return { suggestion }
}
