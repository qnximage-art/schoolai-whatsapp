# School AI Core — Design Spec

**Date:** 2026-06-28  
**Status:** Approved  
**Scope:** Tier 1 — AI FAQ Bot, Multilingual Support, AI Suggest Reply, School Knowledge Base  

---

## Context

wacrm is an MIT-licensed self-hostable WhatsApp CRM. This spec describes adding AI support
tailored for a single school with a multi-role team (Principal, Admin, Teachers, Receptionist).

Parents communicate in English and Hindi. The AI should auto-handle common queries 24/7 and
escalate complex ones to humans during school hours.

---

## Goals

- Auto-answer parent FAQs (timings, fees, holidays, exams) in Hindi or English
- Escalate complex queries to human agents during school hours
- Give agents a one-click AI-suggested reply inside the inbox
- Let admin configure school knowledge via a settings page

---

## Out of Scope (Phase 2)

- Admissions chatbot (Tier 2)
- Fee reminder automations (Tier 3)
- Attendance alerts (Tier 3)

---

## Architecture

Four additions to the existing codebase, all self-contained:

```
1. School Knowledge Base   → new Settings page + DB table
2. AI Engine               → new lib/ai/ module
3. AI Automation Step      → extends automation engine + builder UI
4. AI Suggest Reply button → extends inbox composer UI
```

### Inbound message flow

```
Parent sends WhatsApp message
        ↓
/api/whatsapp/webhook  (existing)
        ↓
runAutomationsForTrigger()  (existing engine)
        ↓
  step_type = 'send_ai_response'  ← NEW
        ↓
lib/ai/school-ai.ts
  - loads knowledge base
  - detects language
  - checks school hours
  - calls Claude API
  - high confidence → auto-reply via engineSendText()
  - low confidence  → escalate, assign to agent
```

### Inbox suggest-reply flow

```
Agent clicks "AI Suggest" in inbox composer
        ↓
POST /api/ai/suggest-reply  ← NEW route
        ↓
lib/ai/school-ai.ts → Claude → suggestion text
        ↓
Populates composer — agent edits and sends
```

---

## Database Changes

### New migration: `school_ai.sql`

#### Table: `school_knowledge_base`

One row per account. Stores all school info the AI draws from.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `account_id` | uuid | FK → accounts, unique, RLS |
| `school_name` | text | |
| `school_hours` | text | e.g. "Mon–Sat 8am to 4pm" |
| `fee_due_date` | text | e.g. "10th of every month" |
| `holidays` | text | Free text |
| `exam_schedule` | text | Free text |
| `admission_info` | text | Eligibility, process |
| `extra_faq` | text | Any additional FAQs |
| `ai_hours_start` | time | School hours start — for escalation logic |
| `ai_hours_end` | time | School hours end |
| `ai_language` | text | `'auto'` \| `'en'` \| `'hi'` (default: `'auto'`) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

RLS: select/insert/update restricted to `account_id = auth.uid()`'s account.

#### Table: `ai_conversation_context`

One row per conversation. Tracks whether AI is handling or has handed off.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `conversation_id` | uuid | FK → conversations, unique |
| `account_id` | uuid | RLS |
| `ai_active` | boolean | true = AI still handling |
| `escalated_at` | timestamptz | null if not escalated |
| `escalation_reason` | text | What triggered escalation |
| `last_ai_reply_at` | timestamptz | |

---

## AI Module: `src/lib/ai/`

### `client.ts`

Thin wrapper around the Anthropic SDK. Reads `ANTHROPIC_API_KEY` from env.
Exports a single `callClaude({ model, system, messages })` function.

Models used:
- `claude-haiku-4-5-20251001` — default (fast, cheap, good for FAQs)
- `claude-sonnet-4-6` — optional upgrade per account config

### `school-ai.ts`

#### `getAiReply(input)` — used by automation step

```ts
input: {
  accountId: string
  contactId: string
  conversationId: string
  messageText: string
}

returns:
  | { action: 'reply';    text: string; language: 'en' | 'hi' }
  | { action: 'escalate'; reason: string }
```

Steps:
1. Load `school_knowledge_base` for account
2. Load last 5 messages for conversation context
3. Detect language from message text
4. Check if current time is within `ai_hours_start`–`ai_hours_end`
5. Build system prompt via `buildSchoolPrompt()`
6. Call Claude
7. Parse response — escalate if uncertainty phrases detected or outside hours
8. Upsert `ai_conversation_context`

#### `getSuggestedReply(input)` — used by inbox button

```ts
input: {
  accountId: string
  conversationId: string
}

returns: { suggestion: string }
```

Steps:
1. Load knowledge base
2. Load last 10 messages for context
3. Call Claude with agent-assist framing ("suggest a reply for the school staff member")
4. Return suggestion text

#### `buildSchoolPrompt(kb, language)` — pure function

Builds the Claude system prompt from a knowledge base row and detected language.
Output: string starting with school name, hours, FAQ content, language instruction.

### Escalation triggers

AI escalates to human when any of the following are true:
- Claude response contains uncertainty phrases: "I don't know", "not sure", "please contact", "I'm unable"
- Incoming message contains: "complaint", "urgent", "problem", "issue", "wrong"
- Current time is outside school hours AND query requires human judgement
- `ai_conversation_context.escalated_at` is already set (conversation was previously escalated)
- Incoming message is not text (image, audio, document)

---

## Automation Step: `send_ai_response`

### Engine change (`src/lib/automations/engine.ts`)

New case in `runStep()` switch:

```ts
case 'send_ai_response': {
  const result = await getAiReply({
    accountId: args.automation.account_id,
    contactId: args.contactId,
    conversationId,
    messageText: args.context.message_text,
  })
  if (result.action === 'reply') {
    await engineSendText({ ...args, text: result.text })
    return `ai replied (${result.language})`
  } else {
    await assignToAvailableAgent(args.automation.account_id, conversationId, cfg.fallback_agent_id)
    return `escalated: ${result.reason}`
  }
}
```

### Step config shape

```ts
interface SendAiResponseStepConfig {
  model: 'haiku' | 'sonnet'           // default: 'haiku'
  escalate_outside_hours: boolean      // default: true
  fallback_agent_id: string | null     // null = round-robin
}
```

### Type additions (`src/types/index.ts`)

- Add `'send_ai_response'` to `AutomationStepType` union
- Add `SendAiResponseStepConfig` interface

### Automation builder UI

New step card "AI Auto-Reply" in the step picker with:
- Model dropdown (Haiku — Fast & Cheap / Sonnet — High Quality)
- Toggle: escalate outside school hours
- Optional agent selector for escalations

---

## New API Route: `POST /api/ai/suggest-reply`

**Auth:** existing middleware (agent role minimum)  
**Body:** `{ conversationId: string }`  
**Response:** `{ suggestion: string }`  

Calls `getSuggestedReply()` and returns the text. No DB writes.

---

## Inbox UI: AI Suggest Reply Button

**File:** `src/components/inbox/message-composer.tsx` (or equivalent composer component)

- Add "AI Suggest" button to the composer toolbar
- On click: POST to `/api/ai/suggest-reply`, show spinner
- On success: populate composer input with suggestion text
- Agent can edit freely before sending
- Visible to Agent role and above only
- If no knowledge base configured: button is disabled with tooltip "Set up AI in Settings first"

---

## Settings: School Knowledge Base Page

**Route:** `/settings/ai` (new tab in existing settings layout)  
**Visible to:** Admin and Owner roles only

Form fields matching `school_knowledge_base` columns:
- School name
- School hours (text)
- Fee due date (text)
- Holidays (textarea)
- Exam schedule (textarea)
- Admission info (textarea)
- Extra FAQs (textarea)
- AI active hours: start time + end time picker
- Language preference: Auto / English / Hindi

Save button upserts the row for `account_id`. Shows success toast on save.

---

## Environment Variables

```env
ANTHROPIC_API_KEY=sk-ant-...     # Required for AI features
```

If absent, `send_ai_response` step logs a warning and skips silently (does not fail the automation).

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Claude API down / timeout | Log error, escalate to human, step result = `partial` |
| No knowledge base configured | Reply "Please contact the school directly", escalate |
| Empty or whitespace message | Skip AI entirely, let other automations handle |
| Claude returns empty response | Retry once, then escalate |
| Non-text message (image, audio) | Skip AI, escalate to human |
| Missing `ANTHROPIC_API_KEY` | Step skips silently, logs warning |
| Parent already escalated in this conversation | Always route to human, skip AI |

---

## Testing

### Unit tests (`src/lib/ai/school-ai.test.ts`)

1. **`buildSchoolPrompt()`** — pure function, verify prompt contains school name, hours, FAQ content for various knowledge base inputs
2. **`getAiReply()` escalation** — mock Claude response with uncertainty phrases, verify `action: 'escalate'` returned
3. **`getAiReply()` outside hours** — mock time outside `ai_hours_start/end`, verify escalation
4. **`getAiReply()` happy path** — mock confident Claude response, verify `action: 'reply'` with text

### Integration tests (`src/lib/automations/engine.test.ts`)

5. **`send_ai_response` step — reply path** — mock `getAiReply` returning reply, verify `engineSendText` called
6. **`send_ai_response` step — escalate path** — mock `getAiReply` returning escalate, verify `assignToAvailableAgent` called

No E2E tests (requires live Meta API + Claude API).

---

## File Checklist

New files:
- `src/lib/ai/client.ts`
- `src/lib/ai/school-ai.ts`
- `src/lib/ai/school-ai.test.ts`
- `src/app/api/ai/suggest-reply/route.ts`
- `src/app/(dashboard)/settings/ai/page.tsx`
- `src/components/settings/ai-knowledge-base-form.tsx`
- `supabase/migrations/YYYYMMDD_school_ai.sql`

Modified files:
- `src/lib/automations/engine.ts` — add `send_ai_response` case
- `src/types/index.ts` — add step type + config interface
- `src/components/inbox/[composer component]` — add AI Suggest button
- `src/components/automations/[step picker]` — add AI Auto-Reply card
- `src/components/settings/settings-sections.ts` — add AI tab
- `.env.local.example` — add `ANTHROPIC_API_KEY`
