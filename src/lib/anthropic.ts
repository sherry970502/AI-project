import Anthropic from '@anthropic-ai/sdk'
import { setGlobalDispatcher, ProxyAgent } from 'undici'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 8192

// 设置全局代理（影响所有 fetch 请求，包括 Anthropic SDK 的流式调用）
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent({ uri: proxyUrl }))
}

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}

export interface StreamMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function streamCompletion(
  system: string,
  messages: StreamMessage[],
  onChunk: (text: string) => void
): Promise<string> {
  const client = getClient()
  let full = ''

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages,
  })

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      full += chunk.delta.text
      onChunk(chunk.delta.text)
    }
  }

  return full
}
