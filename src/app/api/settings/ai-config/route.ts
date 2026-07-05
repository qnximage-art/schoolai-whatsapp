import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import OpenAI from 'openai'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('account_id').eq('user_id', user.id).maybeSingle()
  if (!profile?.account_id) return NextResponse.json({ error: 'No account' }, { status: 403 })

  const { data } = await supabase
    .from('ai_provider_config')
    .select('provider, model, base_url, api_key')
    .eq('account_id', profile.account_id)
    .maybeSingle()

  if (!data) return NextResponse.json({ config: null })

  return NextResponse.json({
    config: {
      provider: data.provider,
      model: data.model,
      base_url: data.base_url ?? '',
      // Return masked key so the UI can show it's set without exposing it
      api_key_set: true,
      api_key_preview: data.api_key ? `${decrypt(data.api_key).slice(0, 8)}...` : '',
    },
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('account_id, account_role').eq('user_id', user.id).maybeSingle()
  if (!profile?.account_id) return NextResponse.json({ error: 'No account' }, { status: 403 })
  if (!['owner', 'admin'].includes(profile.account_role ?? ''))
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const body = await request.json()
  const { provider, api_key, model, base_url } = body

  if (!provider || !api_key || !model)
    return NextResponse.json({ error: 'provider, api_key, and model are required' }, { status: 400 })

  const encryptedKey = encrypt(api_key)

  const { error } = await supabase.from('ai_provider_config').upsert(
    {
      account_id: profile.account_id,
      provider,
      api_key: encryptedKey,
      model,
      base_url: base_url || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' },
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function PUT(request: Request) {
  // Test endpoint — makes a real API call with provided credentials
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('account_id').eq('user_id', user.id).maybeSingle()

  const body = await request.json()
  let { provider, api_key, model, base_url } = body

  // If UI sends USE_SAVED, load the saved key from DB
  if (api_key === 'USE_SAVED' && profile?.account_id) {
    const { data: saved } = await supabase
      .from('ai_provider_config').select('api_key, provider, model, base_url')
      .eq('account_id', profile.account_id).maybeSingle()
    if (!saved) return NextResponse.json({ error: 'No saved config found. Save your settings first.' }, { status: 400 })
    api_key = decrypt(saved.api_key)
    provider = provider || saved.provider
    model = model || saved.model
    base_url = base_url || saved.base_url
  }

  if (!api_key || !model)
    return NextResponse.json({ error: 'api_key and model are required' }, { status: 400 })

  try {
    let resolvedBaseUrl: string | undefined
    if (provider === 'openrouter') resolvedBaseUrl = 'https://openrouter.ai/api/v1'
    else if (base_url) resolvedBaseUrl = base_url

    const client = new OpenAI({ apiKey: api_key, baseURL: resolvedBaseUrl })
    const response = await client.chat.completions.create({
      model,
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Reply with just: OK' }],
    })
    const text = response.choices[0]?.message?.content?.trim() ?? '(empty)'
    return NextResponse.json({ success: true, response: text })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}
