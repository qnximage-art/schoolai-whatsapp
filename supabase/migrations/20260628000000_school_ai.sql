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
  )
  with check (
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
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
