import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSchoolPrompt, getAiReply, getSuggestedReply } from './school-ai'
import type { SchoolKnowledgeBase } from '@/types'

// Mock the Claude client
vi.mock('./client', () => ({
  callAi: vi.fn(),
}))

// Mock supabase admin
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: [], error: null })),
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
      upsert: vi.fn(async () => ({ error: null })),
    })),
  })),
}))

const mockKb: SchoolKnowledgeBase = {
  id: 'kb-1',
  account_id: 'acc-1',
  school_name: 'Sunrise School',
  school_hours: 'Mon-Sat 8am to 4pm',
  fee_due_date: '10th of every month',
  holidays: 'Diwali: Oct 24, Christmas: Dec 25',
  exam_schedule: 'Unit test: March, Final: May',
  admission_info: 'Open for classes 1-10, age 5+',
  extra_faq: 'Uniform: navy blue. Bus available.',
  ai_hours_start: '08:00',
  ai_hours_end: '16:00',
  ai_language: 'auto',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('buildSchoolPrompt', () => {
  it('includes school name in prompt', () => {
    const prompt = buildSchoolPrompt(mockKb, 'en')
    expect(prompt).toContain('Sunrise School')
  })

  it('includes school hours in prompt', () => {
    const prompt = buildSchoolPrompt(mockKb, 'en')
    expect(prompt).toContain('Mon-Sat 8am to 4pm')
  })

  it('includes fee due date in prompt', () => {
    const prompt = buildSchoolPrompt(mockKb, 'en')
    expect(prompt).toContain('10th of every month')
  })

  it('includes Hindi language instruction when language is hi', () => {
    const prompt = buildSchoolPrompt(mockKb, 'hi')
    expect(prompt.toLowerCase()).toContain('hindi')
  })

  it('includes English language instruction when language is en', () => {
    const prompt = buildSchoolPrompt(mockKb, 'en')
    expect(prompt.toLowerCase()).toContain('english')
  })
})

describe('getAiReply', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns reply action when AI gives confident response', async () => {
    const { callAi } = await import('./client')
    vi.mocked(callAi).mockResolvedValue('School timings are Mon-Sat 8am to 4pm.')

    const result = await getAiReply({
      accountId: 'acc-1',
      contactId: 'con-1',
      conversationId: 'cv-1',
      messageText: 'What are the school timings?',
    })

    expect(result.action).toBe('reply')
    if (result.action === 'reply') {
      expect(result.text).toContain('8am')
    }
  })

  it('escalates when AI response contains uncertainty phrase', async () => {
    const { callAi } = await import('./client')
    vi.mocked(callAi).mockResolvedValue("I'm not sure about that. Please contact the school.")

    const result = await getAiReply({
      accountId: 'acc-1',
      contactId: 'con-1',
      conversationId: 'cv-1',
      messageText: 'Can I get a fee waiver?',
    })

    expect(result.action).toBe('escalate')
  })

  it('escalates when message contains urgent keyword', async () => {
    const { callAi } = await import('./client')
    vi.mocked(callAi).mockResolvedValue('I will help you.')

    const result = await getAiReply({
      accountId: 'acc-1',
      contactId: 'con-1',
      conversationId: 'cv-1',
      messageText: 'This is urgent, my child has a complaint',
    })

    expect(result.action).toBe('escalate')
  })

  it('escalates when AI API throws', async () => {
    const { callAi } = await import('./client')
    vi.mocked(callAi).mockRejectedValue(new Error('API timeout'))

    const result = await getAiReply({
      accountId: 'acc-1',
      contactId: 'con-1',
      conversationId: 'cv-1',
      messageText: 'What time does school start?',
    })

    expect(result.action).toBe('escalate')
    if (result.action === 'escalate') {
      expect(result.reason).toContain('AI error')
    }
  })

  it('skips AI and escalates when messageText is empty', async () => {
    const result = await getAiReply({
      accountId: 'acc-1',
      contactId: 'con-1',
      conversationId: 'cv-1',
      messageText: '   ',
    })

    expect(result.action).toBe('escalate')
  })
})

describe('getSuggestedReply', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns suggestion text from AI', async () => {
    const { callAi } = await import('./client')
    vi.mocked(callAi).mockResolvedValue('You can pay fees by the 10th of each month.')

    const result = await getSuggestedReply({
      accountId: 'acc-1',
      conversationId: 'cv-1',
    })

    expect(result.suggestion).toContain('10th')
  })
})
