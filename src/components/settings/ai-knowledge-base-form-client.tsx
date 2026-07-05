'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'
import { AiKnowledgeBaseForm } from './ai-knowledge-base-form'
import type { SchoolKnowledgeBase } from '@/types'

export function AiKnowledgeBaseFormClient() {
  const [accountId, setAccountId] = useState<string | null>(null)
  const [kb, setKb] = useState<SchoolKnowledgeBase | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data: profile } = await supabase
        .from('profiles').select('account_id').eq('user_id', user.id).maybeSingle()
      if (!profile?.account_id) return
      setAccountId(profile.account_id)
      const { data } = await supabase
        .from('school_knowledge_base').select('*')
        .eq('account_id', profile.account_id).maybeSingle()
      setKb(data as SchoolKnowledgeBase | null)
      setLoading(false)
    })
  }, [])

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  )

  if (!accountId) return (
    <p className="text-sm text-muted-foreground">Could not load account.</p>
  )

  return <AiKnowledgeBaseForm accountId={accountId} initial={kb} />
}
