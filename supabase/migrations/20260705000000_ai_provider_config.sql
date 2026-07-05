-- AI provider config per account
-- Stores provider, encrypted API key, model, and base URL
-- so users can configure AI from the Settings UI instead of env vars.

create table if not exists ai_provider_config (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  provider        text not null default 'openrouter', -- openrouter | openai | anthropic
  api_key         text not null,                       -- encrypted with app ENCRYPTION_KEY
  model           text not null default 'meta-llama/llama-3.2-3b-instruct:free',
  base_url        text,                                -- optional, for OpenRouter override
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (account_id)
);

alter table ai_provider_config enable row level security;

create policy "account members can read ai_provider_config"
  on ai_provider_config for select
  using (
    account_id in (
      select account_id from profiles where user_id = auth.uid()
    )
  );

create policy "account admins can write ai_provider_config"
  on ai_provider_config for all
  using (
    account_id in (
      select account_id from profiles
      where user_id = auth.uid()
        and account_role in ('owner', 'admin')
    )
  );
