import { NextResponse } from 'next/server'

// Temporary debug route — DELETE after confirming env vars load correctly
export async function GET() {
  return NextResponse.json({
    AI_PROVIDER: process.env.AI_PROVIDER ?? 'NOT SET',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ? `set (${process.env.OPENROUTER_API_KEY.slice(0, 12)}...)` : 'NOT SET',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? `set (${process.env.OPENAI_API_KEY.slice(0, 12)}... — system var, ignored for OpenRouter)` : 'NOT SET',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? 'NOT SET',
    META_APP_SECRET: process.env.META_APP_SECRET ? `set (${process.env.META_APP_SECRET.slice(0, 6)}...)` : 'NOT SET',
  })
}
