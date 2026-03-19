import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getExecTaskSystemPrompt } from '@/lib/agent-prompts'
import { buildContext } from '@/lib/build-context'
import { streamCompletion } from '@/lib/anthropic'

function parseActionItems(content: string): { cleanContent: string; items: string[] } {
  const match = content.match(/===人工待办===\n([\s\S]*?)\n===END===/)
  if (!match) return { cleanContent: content, items: [] }
  const items = match[1]
    .split('\n')
    .map(l => l.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
  const cleanContent = content.replace(/\n*===人工待办===[\s\S]*?===END===/g, '').trim()
  return { cleanContent, items }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ execTaskId: string }> }
) {
  const { execTaskId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return new Response('Unauthorized', { status: 401 })

  const { userMessage } = await req.json().catch(() => ({}))
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        const task = await prisma.execTask.findFirst({
          where: {
            id: execTaskId,
            project: { userId: session.user.id },
          },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        })

        if (!task) { send({ type: 'error', message: 'Task not found' }); controller.close(); return }
        if (task.status === 'LOCKED') { send({ type: 'error', message: 'Task already locked' }); controller.close(); return }

        const history: { role: 'user' | 'assistant'; content: string }[] = []

        // Context always goes into system prompt — never into chat messages
        const ctx = await buildContext(task.projectId)

        if (task.messages.length === 0) {
          const firstMsg = `请开始执行任务【${task.name}】，直接生成产出物。`
          await prisma.message.create({ data: { execTaskId: task.id, role: 'USER', content: firstMsg } })
          history.push({ role: 'user', content: firstMsg })
        } else {
          const msgs = task.messages
          const filtered = msgs[msgs.length - 1]?.role === 'ASSISTANT' && task.status === 'RUNNING'
            ? msgs.slice(0, -1)
            : msgs

          for (const m of filtered) {
            history.push({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content })
          }

          if (userMessage) {
            await prisma.message.create({ data: { execTaskId: task.id, role: 'USER', content: userMessage } })
            history.push({ role: 'user', content: userMessage })
          }

          // Ensure history ends with a user message
          if (history.length > 0 && history[history.length - 1].role === 'assistant') {
            const resumeMsg = '请结合项目背景和知识库，重新生成此任务的产出。'
            await prisma.message.create({ data: { execTaskId: task.id, role: 'USER', content: resumeMsg } })
            history.push({ role: 'user', content: resumeMsg })
          }
        }

        await prisma.execTask.update({ where: { id: task.id }, data: { status: 'RUNNING' } })

        const fullContent = await streamCompletion(
          getExecTaskSystemPrompt(task.name, task.outputDesc, ctx),
          history,
          text => send({ type: 'chunk', text })
        )

        const { cleanContent, items } = parseActionItems(fullContent)

        const [saved] = await prisma.$transaction([
          prisma.message.create({ data: { execTaskId: task.id, role: 'ASSISTANT', content: cleanContent } }),
          prisma.execTask.update({ where: { id: task.id }, data: { status: 'WAITING' } }),
        ])

        if (items.length > 0) {
          await prisma.actionItem.createMany({
            data: items.map(content => ({ execTaskId: task.id, content })),
          })
        }

        send({ type: 'done', messageId: saved.id, actionItems: items })
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
