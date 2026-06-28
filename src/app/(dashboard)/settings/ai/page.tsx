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
