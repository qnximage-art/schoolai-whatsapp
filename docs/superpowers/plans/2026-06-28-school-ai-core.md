# School AI Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-powered FAQ auto-reply, smart escalation, multilingual support, and agent suggest-reply to the wacrm school WhatsApp CRM.

**Architecture:** A new `src/lib/ai/` module provides a provider-agnostic `callAi()` interface with adapters for Anthropic, OpenAI, and OpenRouter. A new automation step `send_ai_response` plugs into the existing engine. A Settings page lets admins fill in the school knowledge base that the AI draws from.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (PostgreSQL + RLS), `@anthropic-ai/sdk` + `openai` SDK, shadcn/ui, Vitest

## Global Constraints

- Node >= 20
- TypeScript strict mode — no `any`, no implicit returns
- All new DB tables must have RLS policies scoped to `account_id`
- Follow existing file naming: kebab-case files, PascalCase components
- Never throw from automation engine steps — return a string detail or throw a typed Error that the engine catches
- Provider selected via `AI_PROVIDER` env var: `anthropic` | `openai` | `openrouter` (default: `anthropic`)
- Model string is free-form and passed through to the provider — caller picks the right model ID for their provider
- All new API routes require auth via existing middleware (no extra auth code needed)
- Vitest for tests — run with `npm test`

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260628000000_school_ai.sql` | Creates `school_knowledge_base` and `ai_conversation_context` tables with RLS |
| `src/lib/ai/client.ts` | Provider-agnostic `callAi()` — reads `AI_PROVIDER` and delegates |
| `src/lib/ai/providers/anthropic.ts` | Anthropic SDK adapter |
| `src/lib/ai/providers/openai.ts` | OpenAI SDK adapter (also used for OpenRouter) |
| `src/lib/ai/school-ai.ts` | Core AI logic — `buildSchoolPrompt`, `getAiReply`, `getSuggestedReply` |
| `src/lib/ai/school-ai.test.ts` | Unit tests for all AI logic |
| `src/app/api/ai/suggest-reply/route.ts` | `POST /api/ai/suggest-reply` endpoint |
| `src/app/(dashboard)/settings/ai/page.tsx` | Settings page — school knowledge base form |
| `src/components/settings/ai-knowledge-base-form.tsx` | Form component for knowledge base |

### Modified files
| File | Change |
|------|--------|
| `src/types/index.ts` | Add `'send_ai_response'` to `AutomationStepType`, add `SendAiResponseStepConfig` interface, add `SchoolKnowledgeBase` and `AiConversationContext` interfaces |
| `src/lib/automations/engine.ts` | Add `send_ai_response` case to `runStep()` switch |
| `src/components/automations/automation-builder.tsx` | Add `send_ai_response` to `STEP_META`, `ADDABLE_STEPS`, and `blankConfig()`, add its config editor UI |
| `src/components/inbox/message-composer.tsx` | Add "AI Suggest" button to toolbar |
| `src/components/settings/settings-sections.ts` | Add `'ai'` section |
| `.env.local.example` | Add `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260628000000_school_ai.sql`

**Interfaces:**
- Produces: `school_knowledge_base` table, `ai_conversation_context` table — consumed by Tasks 3, 4, 6

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260628000000_school_ai.sql

-- School knowledge base: one row per account, admin-editable
create table public.school_knowledge_base (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null unique references public.accounts(id) on delete cascade,
  school_name      text not null default '',
  school_hours     text not null default '',
  fee_due_date     text not null default '',
  holidays         text not null default '',
  exam_schedule    text not null default '',
  admission_info   text not null default '',
  extra_faq        text not null default '',
  ai_hours_start   time not null default '08:00',
  ai_hours_end     time not null default '16:00',
  ai_language      text not null default 'auto' check (ai_language in ('auto', 'en', 'hi')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.school_knowledge_base enable row level security;

create policy "account members can read knowledge base"
  on public.school_knowledge_base for select
  using (
    account_id in (
      select account_id from public.profiles where user_id = auth.uid()
    )
  );

create policy "admins can upsert knowledge base"
  on public.school_knowledge_base for all
  using (
    account_id in (
      select account_id from public.profiles
      where user_id = auth.uid()
      and account_role in ('owner', 'admin')
    )
  );

-- AI conversation context: tracks whether AI is handling or escalated
create table public.ai_conversation_context (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null unique references public.conversations(id) on delete cascade,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  ai_active          boolean not null default true,
  escalated_at       timestamptz,
  escalation_reason  text,
  last_ai_reply_at   timestamptz,
  created_at         timestamptz not null default now()
);

alter table public.ai_conversation_context enable row level security;

create policy "account members can read ai context"
  on public.ai_conversation_context for select
  using (
    account_id in (
      select account_id from public.profiles where user_id = auth.uid()
    )
  );

create policy "service role can manage ai context"
  on public.ai_conversation_context for all
  using (auth.role() = 'service_role');
```

- [ ] **Step 2: Apply the migration to your Supabase project**

```bash
npx supabase db push
```

Expected: migration applied without errors. Verify in Supabase dashboard → Table Editor that both tables exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260628000000_school_ai.sql
git commit -m "feat: add school_knowledge_base and ai_conversation_context tables"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `AutomationStepType` (updated union), `SendAiResponseStepConfig`, `SchoolKnowledgeBase`, `AiConversationContext` — consumed by Tasks 3, 4, 5, 6, 7

- [ ] **Step 1: Add `send_ai_response` to `AutomationStepType`**

Find this block in `src/types/index.ts` (around line 380):

```ts
export type AutomationStepType =
  | 'send_message'
  | 'send_template'
  | 'add_tag'
  | 'remove_tag'
  | 'assign_conversation'
  | 'update_contact_field'
  | 'create_deal'
  | 'wait'
  | 'condition'
  | 'send_webhook'
  | 'close_conversation';
```

Replace with:

```ts
export type AutomationStepType =
  | 'send_message'
  | 'send_template'
  | 'add_tag'
  | 'remove_tag'
  | 'assign_conversation'
  | 'update_contact_field'
  | 'create_deal'
  | 'wait'
  | 'condition'
  | 'send_webhook'
  | 'close_conversation'
  | 'send_ai_response';
```

- [ ] **Step 2: Add `SendAiResponseStepConfig` after `SendWebhookStepConfig`**

After the `SendWebhookStepConfig` interface (around line 480), add:

```ts
export interface SendAiResponseStepConfig {
  /** Full model string — depends on AI_PROVIDER. e.g. "claude-haiku-4-5-20251001", "gpt-4o-mini", "anthropic/claude-haiku-4-5" */
  model: string;
  escalate_outside_hours: boolean;
  fallback_agent_id: string | null;
}
```

- [ ] **Step 3: Add `SendAiResponseStepConfig` to the `AutomationStepConfig` union**

Find:
```ts
export type AutomationStepConfig =
  | SendMessageStepConfig
  | SendTemplateStepConfig
  | TagStepConfig
  | AssignConversationStepConfig
  | UpdateContactFieldStepConfig
  | CreateDealStepConfig
  | WaitStepConfig
  | ConditionStepConfig
  | SendWebhookStepConfig
  | Record<string, never>
  | Record<string, unknown>;
```

Replace with:
```ts
export type AutomationStepConfig =
  | SendMessageStepConfig
  | SendTemplateStepConfig
  | TagStepConfig
  | AssignConversationStepConfig
  | UpdateContactFieldStepConfig
  | CreateDealStepConfig
  | WaitStepConfig
  | ConditionStepConfig
  | SendWebhookStepConfig
  | SendAiResponseStepConfig
  | Record<string, never>
  | Record<string, unknown>;
```

- [ ] **Step 4: Add `SchoolKnowledgeBase` and `AiConversationContext` interfaces**

At the end of `src/types/index.ts`, append:

```ts
export interface SchoolKnowledgeBase {
  id: string;
  account_id: string;
  school_name: string;
  school_hours: string;
  fee_due_date: string;
  holidays: string;
  exam_schedule: string;
  admission_info: string;
  extra_faq: string;
  ai_hours_start: string;
  ai_hours_end: string;
  ai_language: 'auto' | 'en' | 'hi';
  created_at: string;
  updated_at: string;
}

export interface AiConversationContext {
  id: string;
  conversation_id: string;
  account_id: string;
  ai_active: boolean;
  escalated_at: string | null;
  escalation_reason: string | null;
  last_ai_reply_at: string | null;
  created_at: string;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add send_ai_response step type and school AI interfaces"
```

---

## Task 3: Provider-Agnostic AI Client

**Files:**
- Create: `src/lib/ai/providers/anthropic.ts`
- Create: `src/lib/ai/providers/openai.ts`
- Create: `src/lib/ai/client.ts`

**Interfaces:**
- Consumes: `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` env vars
- Produces: `callAi({ model, system, messages }): Promise<string>` — consumed by Task 4

> Switching provider = change `AI_PROVIDER` + supply the right API key. No code changes needed.

- [ ] **Step 1: Install both SDKs**

```bash
npm install @anthropic-ai/sdk openai
```

Expected: both packages added to `node_modules`, `package.json` updated.

- [ ] **Step 2: Update `.env.local.example`**

Open `.env.local.example` and append:

```env
# AI features (School AI Core)
# Set AI_PROVIDER to: anthropic | openai | openrouter
AI_PROVIDER=anthropic

# Anthropic (AI_PROVIDER=anthropic)
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (AI_PROVIDER=openai)
# OPENAI_API_KEY=sk-...
# OPENAI_BASE_URL=https://api.openai.com/v1   # optional, this is the default

# OpenRouter — access 200+ models via OpenAI SDK (AI_PROVIDER=openrouter)
# OPENAI_API_KEY=sk-or-...
# OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

**Model strings per provider (use these in automation step config):**

| Provider | Fast / cheap | High quality |
|---|---|---|
| `anthropic` | `claude-haiku-4-5-20251001` | `claude-sonnet-4-6` |
| `openai` | `gpt-4o-mini` | `gpt-4o` |
| `openrouter` | `anthropic/claude-haiku-4-5` | `openai/gpt-4o` or `google/gemini-pro` |

- [ ] **Step 3: Create `src/lib/ai/providers/anthropic.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk'

export interface AiCallInput {
  model: string
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export async function callAnthropic(input: AiCallInput): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
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
```

- [ ] **Step 4: Create `src/lib/ai/providers/openai.ts`**

This adapter works for OpenAI **and** OpenRouter — both use the OpenAI SDK interface. Set `OPENAI_BASE_URL` to switch between them.

```ts
import OpenAI from 'openai'

export interface AiCallInput {
  model: string
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export async function callOpenAI(input: AiCallInput): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

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
```

- [ ] **Step 5: Create `src/lib/ai/client.ts`**

```ts
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
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/client.ts src/lib/ai/providers/anthropic.ts src/lib/ai/providers/openai.ts .env.local.example package.json package-lock.json
git commit -m "feat: add provider-agnostic AI client (Anthropic, OpenAI, OpenRouter)"
```

---

## Task 4: School AI Logic + Tests

**Files:**
- Create: `src/lib/ai/school-ai.ts`
- Create: `src/lib/ai/school-ai.test.ts`

**Interfaces:**
- Consumes: `callAi()` from `src/lib/ai/client.ts`, `SchoolKnowledgeBase` + `AiConversationContext` from `src/types/index.ts`, `supabaseAdmin` from `src/lib/automations/admin-client.ts`
- Produces:
  - `buildSchoolPrompt(kb: SchoolKnowledgeBase, language: 'en' | 'hi'): string`
  - `getAiReply(input: GetAiReplyInput): Promise<AiReplyResult>`
  - `getSuggestedReply(input: GetSuggestedReplyInput): Promise<{ suggestion: string }>`

- [ ] **Step 1: Write the failing tests first**

Create `src/lib/ai/school-ai.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test src/lib/ai/school-ai.test.ts
```

Expected: FAIL — `school-ai` module not found.

- [ ] **Step 3: Create `src/lib/ai/school-ai.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

```bash
npm test src/lib/ai/school-ai.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/school-ai.ts src/lib/ai/school-ai.test.ts
git commit -m "feat: add school AI logic with getAiReply, getSuggestedReply, buildSchoolPrompt"
```

---

## Task 5: Automation Engine — `send_ai_response` Step

**Files:**
- Modify: `src/lib/automations/engine.ts`

**Interfaces:**
- Consumes: `getAiReply()` from `src/lib/ai/school-ai.ts`, `SendAiResponseStepConfig` from `src/types/index.ts`
- Produces: `send_ai_response` case in `runStep()` — returns detail string

- [ ] **Step 1: Import `getAiReply` at the top of the engine**

In `src/lib/automations/engine.ts`, add this import after the existing imports:

```ts
import { getAiReply } from '@/lib/ai/school-ai'
import type { SendAiResponseStepConfig } from '@/types'
```

- [ ] **Step 2: Add the `send_ai_response` case to `runStep()`**

In `src/lib/automations/engine.ts`, find the `runStep()` function's switch statement. After the last `case` (before the closing `default` or end of switch), add:

```ts
    case 'send_ai_response': {
      const cfg = step.step_config as SendAiResponseStepConfig
      if (!args.contactId) throw new Error('send_ai_response needs a contact')
      if (!args.context.message_text) {
        return 'skipped: no message text (non-text message)'
      }
      const conversationId = await resolveConversationId(args)
      const result = await getAiReply({
        accountId: args.automation.account_id,
        contactId: args.contactId,
        conversationId,
        messageText: args.context.message_text,
        model: cfg.model ?? 'haiku',
      })
      if (result.action === 'reply') {
        await engineSendText({
          accountId: args.automation.account_id,
          userId: args.automation.user_id,
          conversationId,
          contactId: args.contactId,
          text: result.text,
        })
        return `ai replied (${result.language})`
      } else {
        // Assign to agent — reuse existing assign logic
        const assignCfg = cfg.fallback_agent_id
          ? { mode: 'specific' as const, agent_id: cfg.fallback_agent_id }
          : { mode: 'round_robin' as const }
        await runStep(
          { ...step, step_type: 'assign_conversation', step_config: assignCfg },
          args,
        )
        return `escalated: ${result.reason}`
      }
    }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/automations/engine.ts
git commit -m "feat: add send_ai_response step to automation engine"
```

---

## Task 6: Automation Builder UI

**Files:**
- Modify: `src/components/automations/automation-builder.tsx`

**Interfaces:**
- Consumes: `AutomationStepType` (updated), `SendAiResponseStepConfig` from `src/types/index.ts`
- Produces: `send_ai_response` step card visible in builder UI

- [ ] **Step 1: Add import for Bot icon**

In `src/components/automations/automation-builder.tsx`, add `Bot` to the lucide-react import:

```ts
import {
  // ...existing icons...
  Bot,
} from "lucide-react"
```

- [ ] **Step 2: Add `send_ai_response` to `STEP_META`**

Find `const STEP_META: Record<AutomationStepType, StepMeta> = {` and add this entry:

```ts
  send_ai_response: { label: "AI Auto-Reply", icon: Bot, border: "border-l-violet-500" },
```

- [ ] **Step 3: Add `send_ai_response` to `ADDABLE_STEPS`**

Find `const ADDABLE_STEPS: AutomationStepType[] = [` and add `"send_ai_response"` to the array:

```ts
const ADDABLE_STEPS: AutomationStepType[] = [
  "send_message",
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
  "send_ai_response",
]
```

- [ ] **Step 4: Add blank config for `send_ai_response`**

Find `function blankConfig(type: AutomationStepType)` and add this case before the `default`:

```ts
    case 'send_ai_response':
      return { model: 'claude-haiku-4-5-20251001', escalate_outside_hours: true, fallback_agent_id: null }
```

- [ ] **Step 5: Add config editor UI for `send_ai_response`**

Find the section in `automation-builder.tsx` where each step type renders its config form (look for `case 'send_message':` inside the step config render block). Add:

```tsx
case 'send_ai_response': {
  const cfg = step.step_config as { model: string; escalate_outside_hours: boolean; fallback_agent_id: string | null }
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          AI Model <span className="font-normal">(must match your AI_PROVIDER)</span>
        </label>
        <Input
          value={cfg.model ?? 'claude-haiku-4-5-20251001'}
          onChange={(e) => onConfigChange({ ...cfg, model: e.target.value })}
          placeholder="e.g. claude-haiku-4-5-20251001 / gpt-4o-mini / openai/gpt-4o"
        />
        <p className="text-xs text-muted-foreground">
          Anthropic: claude-haiku-4-5-20251001 · OpenAI: gpt-4o-mini · OpenRouter: anthropic/claude-haiku-4-5
        </p>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Escalate outside school hours</span>
        <Switch
          checked={cfg.escalate_outside_hours ?? true}
          onCheckedChange={(v) => onConfigChange({ ...cfg, escalate_outside_hours: v })}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/automations/automation-builder.tsx
git commit -m "feat: add AI Auto-Reply step card to automation builder"
```

---

## Task 7: Suggest Reply API Route

**Files:**
- Create: `src/app/api/ai/suggest-reply/route.ts`

**Interfaces:**
- Consumes: `getSuggestedReply()` from `src/lib/ai/school-ai.ts`
- Produces: `POST /api/ai/suggest-reply` → `{ suggestion: string }`

- [ ] **Step 1: Create the route**

```ts
// src/app/api/ai/suggest-reply/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSuggestedReply } from '@/lib/ai/school-ai'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single()

  if (!profile?.account_id) {
    return NextResponse.json({ error: 'No account found' }, { status: 403 })
  }

  const body = await req.json()
  const conversationId: string | undefined = body.conversationId
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  try {
    const result = await getSuggestedReply({
      accountId: profile.account_id,
      conversationId,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[suggest-reply]', err)
    return NextResponse.json({ error: 'AI unavailable' }, { status: 503 })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ai/suggest-reply/route.ts
git commit -m "feat: add POST /api/ai/suggest-reply route"
```

---

## Task 8: Inbox AI Suggest Button

**Files:**
- Modify: `src/components/inbox/message-composer.tsx`

**Interfaces:**
- Consumes: `POST /api/ai/suggest-reply` from Task 7, `conversationId` prop (already on `MessageComposerProps`)
- Produces: "AI Suggest" button in the composer toolbar that populates the text input

- [ ] **Step 1: Add `Sparkles` to the lucide-react import**

In `src/components/inbox/message-composer.tsx`, add `Sparkles` to the existing lucide-react import block.

- [ ] **Step 2: Add `aiSuggesting` state**

Inside the `MessageComposer` function, after existing `useState` declarations, add:

```ts
const [aiSuggesting, setAiSuggesting] = useState(false)
```

- [ ] **Step 3: Add `handleAiSuggest` handler**

After the existing handler functions inside `MessageComposer`, add:

```ts
const handleAiSuggest = useCallback(async () => {
  setAiSuggesting(true)
  try {
    const res = await fetch('/api/ai/suggest-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    })
    if (!res.ok) throw new Error('AI unavailable')
    const data = await res.json()
    if (data.suggestion) {
      setText(data.suggestion)
    }
  } catch {
    toast.error('Could not get AI suggestion')
  } finally {
    setAiSuggesting(false)
  }
}, [conversationId])
```

- [ ] **Step 4: Add the AI Suggest button to the toolbar**

Find the composer toolbar — look for the `<Button>` that triggers the template picker (`onOpenTemplates`). Add the AI Suggest button next to it:

```tsx
<Button
  type="button"
  size="icon"
  variant="ghost"
  className="h-8 w-8 shrink-0"
  onClick={handleAiSuggest}
  disabled={aiSuggesting || sessionExpired}
  title="AI Suggest Reply"
>
  {aiSuggesting ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : (
    <Sparkles className="h-4 w-4" />
  )}
</Button>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/inbox/message-composer.tsx
git commit -m "feat: add AI Suggest Reply button to inbox composer"
```

---

## Task 9: Settings — School Knowledge Base Page

**Files:**
- Modify: `src/components/settings/settings-sections.ts`
- Create: `src/components/settings/ai-knowledge-base-form.tsx`
- Create: `src/app/(dashboard)/settings/ai/page.tsx`

**Interfaces:**
- Consumes: `SchoolKnowledgeBase` from `src/types/index.ts`, Supabase client
- Produces: `/settings?tab=ai` page with knowledge base form

- [ ] **Step 1: Add `'ai'` to `settings-sections.ts`**

In `src/components/settings/settings-sections.ts`:

Add `Brain` to the lucide-react import.

Add `'ai'` to the `SETTINGS_SECTIONS` array:
```ts
export const SETTINGS_SECTIONS = [
  'overview', 'profile', 'security', 'appearance',
  'whatsapp', 'templates', 'fields', 'deals', 'members', 'api',
  'ai',
] as const;
```

Add to `SECTION_META`:
```ts
  ai: { id: 'ai', label: 'AI & Knowledge Base', icon: Brain, group: 'workspace' },
```

- [ ] **Step 2: Create the form component**

Create `src/components/settings/ai-knowledge-base-form.tsx`:

```tsx
"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import type { SchoolKnowledgeBase } from "@/types"

interface AiKnowledgeBaseFormProps {
  accountId: string
  initial: Partial<SchoolKnowledgeBase> | null
}

export function AiKnowledgeBaseForm({ accountId, initial }: AiKnowledgeBaseFormProps) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    school_name: initial?.school_name ?? "",
    school_hours: initial?.school_hours ?? "",
    fee_due_date: initial?.fee_due_date ?? "",
    holidays: initial?.holidays ?? "",
    exam_schedule: initial?.exam_schedule ?? "",
    admission_info: initial?.admission_info ?? "",
    extra_faq: initial?.extra_faq ?? "",
    ai_hours_start: initial?.ai_hours_start ?? "08:00",
    ai_hours_end: initial?.ai_hours_end ?? "16:00",
    ai_language: initial?.ai_language ?? "auto",
  })

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from("school_knowledge_base")
      .upsert({ account_id: accountId, ...form }, { onConflict: "account_id" })

    if (error) {
      toast.error("Failed to save: " + error.message)
    } else {
      toast.success("Knowledge base saved")
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-1">
        <Label>School Name</Label>
        <Input value={form.school_name} onChange={(e) => set("school_name", e.target.value)} placeholder="Sunrise Public School" />
      </div>
      <div className="space-y-1">
        <Label>School Hours</Label>
        <Input value={form.school_hours} onChange={(e) => set("school_hours", e.target.value)} placeholder="Mon–Sat 8am to 4pm" />
      </div>
      <div className="space-y-1">
        <Label>Fee Due Date</Label>
        <Input value={form.fee_due_date} onChange={(e) => set("fee_due_date", e.target.value)} placeholder="10th of every month" />
      </div>
      <div className="space-y-1">
        <Label>Holidays</Label>
        <Textarea rows={3} value={form.holidays} onChange={(e) => set("holidays", e.target.value)} placeholder="Diwali: Oct 24, Christmas: Dec 25..." />
      </div>
      <div className="space-y-1">
        <Label>Exam Schedule</Label>
        <Textarea rows={3} value={form.exam_schedule} onChange={(e) => set("exam_schedule", e.target.value)} placeholder="Unit test: March, Final exams: May" />
      </div>
      <div className="space-y-1">
        <Label>Admission Info</Label>
        <Textarea rows={3} value={form.admission_info} onChange={(e) => set("admission_info", e.target.value)} placeholder="Open for classes 1–10, minimum age 5+" />
      </div>
      <div className="space-y-1">
        <Label>Extra FAQs</Label>
        <Textarea rows={4} value={form.extra_faq} onChange={(e) => set("extra_faq", e.target.value)} placeholder="Uniform: navy blue. Bus available for 5km radius..." />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>AI Active From</Label>
          <Input type="time" value={form.ai_hours_start} onChange={(e) => set("ai_hours_start", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>AI Active Until</Label>
          <Input type="time" value={form.ai_hours_end} onChange={(e) => set("ai_hours_end", e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Reply Language</Label>
        <select
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={form.ai_language}
          onChange={(e) => set("ai_language", e.target.value)}
        >
          <option value="auto">Auto-detect (Hindi or English)</option>
          <option value="en">English only</option>
          <option value="hi">Hindi only</option>
        </select>
      </div>
      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Knowledge Base"}
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Create the settings page**

Create `src/app/(dashboard)/settings/ai/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AiKnowledgeBaseForm } from "@/components/settings/ai-knowledge-base-form"
import type { SchoolKnowledgeBase } from "@/types"

export default async function AiSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .single()

  if (!profile?.account_id || !["owner", "admin"].includes(profile.account_role ?? "")) {
    redirect("/settings")
  }

  const { data: kb } = await supabase
    .from("school_knowledge_base")
    .select("*")
    .eq("account_id", profile.account_id)
    .maybeSingle()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">AI &amp; Knowledge Base</h2>
        <p className="text-sm text-muted-foreground">
          Fill in your school information. The AI uses this to answer parent questions automatically.
        </p>
      </div>
      <AiKnowledgeBaseForm accountId={profile.account_id} initial={kb as SchoolKnowledgeBase | null} />
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/settings-sections.ts src/components/settings/ai-knowledge-base-form.tsx src/app/(dashboard)/settings/ai/page.tsx
git commit -m "feat: add AI Knowledge Base settings page"
```

---

## Task 10: Final Check + Push

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all tests pass including `school-ai.test.ts`.

- [ ] **Step 2: Run full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Build the app**

```bash
npm run build
```

Expected: build completes without errors.

- [ ] **Step 4: Push to GitHub**

```bash
git push origin main
```

Expected: all commits pushed to `qnximage-art/schoolai-whatsapp`.

---

## Manual Test Checklist (after deploy)

- [ ] Go to Settings → AI & Knowledge Base, fill in school info, save — success toast appears
- [ ] Create an automation with trigger "New Message Received" + step "AI Auto-Reply", activate it
- [ ] Send a WhatsApp message matching a FAQ (e.g. "What time does school start?") — AI replies automatically
- [ ] Send a message with "complaint" — conversation is escalated to an agent
- [ ] Open any conversation in inbox — "AI Suggest" (sparkle icon) button appears in composer
- [ ] Click AI Suggest — suggestion text populates the composer input
- [ ] Non-admin user cannot see Settings → AI tab
