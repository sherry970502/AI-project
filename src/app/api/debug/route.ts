import { NextResponse } from 'next/server'
import '@/lib/anthropic' // 触发全局代理设置
import Anthropic from '@anthropic-ai/sdk'

export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY

  if (!key) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

  const keyPreview = key.slice(0, 10) + '...' + key.slice(-4)

  try {
    const client = new Anthropic({ apiKey: key })
    const res = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    })
    return NextResponse.json({ ok: true, keyPreview, proxy: proxyUrl ?? 'none', model: res.model })
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string }
    return NextResponse.json({ ok: false, keyPreview, proxy: proxyUrl ?? 'none', status: e.status, error: e.message })
  }
}
