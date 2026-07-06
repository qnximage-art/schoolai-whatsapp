'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Eye, EyeOff, CheckCircle2, XCircle, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'

const PROVIDER_MODELS: Record<string, string[]> = {
  openrouter: [
    'meta-llama/llama-3.2-3b-instruct:free',
    'google/gemma-4-26b-a4b-it:free',
    'mistralai/mistral-7b-instruct:free',
    'google/gemini-2.0-flash-001',
    'openai/gpt-4o-mini',
  ],
  gemini: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'],
}

const PROVIDER_BASE_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
  anthropic: '',
}

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

export function AiProviderSettings() {
  const [provider, setProvider] = useState('openrouter')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('meta-llama/llama-3.2-3b-instruct:free')
  const [baseUrl, setBaseUrl] = useState('https://openrouter.ai/api/v1')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [existingKeyPreview, setExistingKeyPreview] = useState('')

  useEffect(() => {
    fetch('/api/settings/ai-config')
      .then((r) => r.json())
      .then(({ config }) => {
        if (config) {
          setProvider(config.provider)
          setModel(config.model)
          setBaseUrl(config.base_url || PROVIDER_BASE_URLS[config.provider] || '')
          setExistingKeyPreview(config.api_key_preview)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function handleProviderChange(p: string) {
    setProvider(p)
    setBaseUrl(PROVIDER_BASE_URLS[p] || '')
    const models = PROVIDER_MODELS[p]
    if (models?.length) setModel(models[0])
  }

  async function handleSave() {
    if (!apiKey && !existingKeyPreview) {
      toast.error('Enter an API key')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/settings/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          api_key: apiKey || undefined,
          model,
          base_url: baseUrl,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('AI settings saved')
      setApiKey('')
      setExistingKeyPreview(apiKey.slice(0, 8) + '...')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    const keyToTest = apiKey || undefined
    if (!keyToTest && !existingKeyPreview) {
      toast.error('Enter an API key first')
      return
    }
    setTestStatus('testing')
    setTestMessage('')
    try {
      const res = await fetch('/api/settings/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, api_key: keyToTest || 'USE_SAVED', model, base_url: baseUrl }),
      })
      const data = await res.json()
      if (data.success) {
        setTestStatus('success')
        setTestMessage(`Response: "${data.response}"`)
      } else {
        setTestStatus('error')
        setTestMessage(data.error || 'Test failed')
      }
    } catch (err) {
      setTestStatus('error')
      setTestMessage(err instanceof Error ? err.message : 'Network error')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading AI settings…
      </div>
    )
  }

  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-5 pt-6">
        {/* Provider */}
        <div className="space-y-1.5">
          <Label>AI Provider</Label>
          <Select value={provider} onValueChange={(v) => v && handleProviderChange(v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openrouter">OpenRouter (free models available)</SelectItem>
              <SelectItem value="gemini">Google Gemini</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* API Key */}
        <div className="space-y-1.5">
          <Label>API Key</Label>
          <div className="relative">
            <Input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={existingKeyPreview ? `Current: ${existingKeyPreview} — paste new key to change` : 'sk-or-v1-...'}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {provider === 'openrouter' && (
            <p className="text-xs text-muted-foreground">
              Get a free key at{' '}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="underline">
                openrouter.ai/keys
              </a>
            </p>
          )}
        </div>

        {/* Model */}
        <div className="space-y-1.5">
          <Label>Model</Label>
          <Select value={model} onValueChange={(v) => v && setModel(v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(PROVIDER_MODELS[provider] ?? []).map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="or type a custom model name"
            className="mt-1.5 text-xs"
          />
        </div>

        {/* Base URL (only for openrouter / custom) */}
        {provider !== 'anthropic' && (
          <div className="space-y-1.5">
            <Label>Base URL <span className="text-xs text-muted-foreground">(optional override)</span></Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
            />
          </div>
        )}

        {/* Test result */}
        {testStatus !== 'idle' && (
          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
              testStatus === 'testing'
                ? 'border-border text-muted-foreground'
                : testStatus === 'success'
                  ? 'border-green-600/30 bg-green-600/10 text-green-400'
                  : 'border-red-600/30 bg-red-600/10 text-red-400'
            }`}
          >
            {testStatus === 'testing' && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
            {testStatus === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            {testStatus === 'error' && <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{testStatus === 'testing' ? 'Testing connection…' : testMessage}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testStatus === 'testing'}
          >
            <FlaskConical className="mr-2 h-4 w-4" />
            Test Connection
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
