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
