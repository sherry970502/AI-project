import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getAgentSystemPrompt } from '@/lib/agent-prompts'
import { buildContext } from '@/lib/build-context'
import { streamCompletion } from '@/lib/anthropic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; stageKey: string }> }
) {
  const { projectId, stageKey } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return new Response('Unauthorized', { status: 401 })

  const { userMessage } = await req.json().catch(() => ({}))
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        const stage = await prisma.pipelineStage.findFirst({
          where: {
            stageKey,
            project: { id: projectId, userId: session.user.id },
          },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        })

        if (!stage) { send({ type: 'error', message: 'Stage not found' }); controller.close(); return }

        const history: { role: 'user' | 'assistant'; content: string }[] = []

        if (stage.messages.length === 0) {
          const ctx = await buildContext(projectId)
          const firstMsg = `${ctx}\n\n请开始执行你的职责。`
          await prisma.message.create({ data: { stageId: stage.id, role: 'USER', content: firstMsg } })
          history.push({ role: 'user', content: firstMsg })
        } else {
          const msgs = stage.messages
          const filtered = msgs[msgs.length - 1]?.role === 'ASSISTANT' && stage.status === 'RUNNING'
            ? msgs.slice(0, -1)
            : msgs

          for (const m of filtered) {
            history.push({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content })
          }

          if (userMessage) {
            await prisma.message.create({ data: { stageId: stage.id, role: 'USER', content: userMessage } })
            history.push({ role: 'user', content: userMessage })
          }

          // Ensure history ends with a user message
          if (history.length > 0 && history[history.length - 1].role === 'assistant') {
            const resumeMsg = '请根据以上反馈，重新输出更新后的完整文档内容。'
            await prisma.message.create({ data: { stageId: stage.id, role: 'USER', content: resumeMsg } })
            history.push({ role: 'user', content: resumeMsg })
          }
        }

        await prisma.pipelineStage.update({ where: { id: stage.id }, data: { status: 'RUNNING' } })

        const fullContent = await streamCompletion(
          getAgentSystemPrompt(stageKey),
          history,
          text => send({ type: 'chunk', text })
        )

        const [saved] = await prisma.$transaction([
          prisma.message.create({ data: { stageId: stage.id, role: 'ASSISTANT', content: fullContent } }),
          prisma.pipelineStage.update({ where: { id: stage.id }, data: { status: 'WAITING' } }),
        ])

        send({ type: 'done', messageId: saved.id })
        controller.close()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        send({ type: 'error', message: msg })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
