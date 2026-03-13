import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamCompletion } from '@/lib/anthropic'
import { buildContext } from '@/lib/build-context'

const CONCIERGE_SYSTEM = (projectTitle: string, context: string) => `你是「${projectTitle}」项目的 AI 助手。你熟悉这个项目的所有细节，能帮助任何人快速了解项目。

${context}

你的职责：
1. 帮助用户理解项目目标、背景和现状
2. 引导用户查阅对应的项目文档（告知文档名称）
3. 基于项目信息给出咨询建议
4. 对于尚未整理成结构化信息的问题，基于已有数据给出合理推断

回答要简洁专业，使用中文。如果问题超出项目范围，说明你只了解此项目相关信息。`

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.project.findFirst({ where: { id: projectId, userId: session.user.id } })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = await prisma.conciergeMessage.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(messages)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.project.findFirst({ where: { id: projectId, userId: session.user.id } })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { message } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: 'message required' }, { status: 400 })

  // Save user message
  await prisma.conciergeMessage.create({ data: { projectId, role: 'USER', content: message } })

  // Load full history for context
  const history = await prisma.conciergeMessage.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  })

  const context = await buildContext(projectId)
  const systemPrompt = CONCIERGE_SYSTEM(project.title, context)

  const messages = history.map(m => ({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content }))

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      try {
        let full = ''
        await streamCompletion(systemPrompt, messages, chunk => {
          full += chunk
          send({ type: 'chunk', text: chunk })
        })
        await prisma.conciergeMessage.create({ data: { projectId, role: 'ASSISTANT', content: full } })
        send({ type: 'done' })
      } catch (e: unknown) {
        const err = e as { message?: string }
        send({ type: 'error', message: err.message ?? 'Unknown error' })
      } finally {
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
