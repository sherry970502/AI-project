import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { EXEC_AGENT_COLOR } from '@/lib/agent-prompts'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ execTaskId: string }> }
) {
  const { execTaskId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const task = await prisma.execTask.findFirst({
    where: {
      id: execTaskId,
      status: 'WAITING',
      project: { userId: session.user.id },
    },
    include: { messages: { orderBy: { createdAt: 'asc' } }, project: true },
  })

  if (!task) return NextResponse.json({ error: 'Task not found or not in WAITING state' }, { status: 404 })

  const lastAssistant = [...task.messages].reverse().find(m => m.role === 'ASSISTANT')
  if (!lastAssistant) return NextResponse.json({ error: 'No assistant message to lock' }, { status: 400 })

  const sourceKey = `exec-${task.order}`
  const latestDoc = await prisma.lockedDocument.findFirst({
    where: { projectId: task.projectId, sourceKey },
    orderBy: { version: 'desc' },
  })
  const nextVersion = latestDoc ? latestDoc.version + 1 : 1

  // Use existing order if doc already exists, otherwise count current docs
  const docOrder = latestDoc?.order ?? await prisma.lockedDocument.count({
    where: { projectId: task.projectId, version: 1 },
  })

  const [lockedDoc] = await prisma.$transaction([
    prisma.lockedDocument.create({
      data: {
        projectId: task.projectId,
        title: task.name,
        sourceKey,
        content: lastAssistant.content,
        order: docOrder,
        color: EXEC_AGENT_COLOR,
        version: nextVersion,
      },
    }),
    prisma.execTask.update({
      where: { id: task.id },
      data: { status: 'LOCKED', lockedContent: lastAssistant.content },
    }),
  ])

  // Check if there's a next exec task
  const nextTask = await prisma.execTask.findFirst({
    where: { projectId: task.projectId, order: task.order + 1 },
  })

  if (nextTask) {
    return NextResponse.json({
      lockedDoc,
      nextAction: { type: 'next_exec_task', execTaskId: nextTask.id },
    })
  }

  // All tasks done → go to monitor
  await prisma.project.update({
    where: { id: task.projectId },
    data: { currentStage: 'monitor', status: 'MONITORING' },
  })

  return NextResponse.json({
    lockedDoc,
    nextAction: { type: 'start_monitor' },
  })
}
