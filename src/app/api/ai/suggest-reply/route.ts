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
