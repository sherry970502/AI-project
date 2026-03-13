import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { STAGE_META } from '@/lib/agent-prompts'
import { parseTasks } from '@/lib/parse-tasks'

const STAGE_ORDER = ['calibrate', 'boundary', 'decompose'] as const

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; stageKey: string }> }
) {
  const { projectId, stageKey } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stage = await prisma.pipelineStage.findFirst({
    where: {
      stageKey: stageKey,
      project: { id: projectId, userId: session.user.id },
      status: 'WAITING',
    },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })

  if (!stage) return NextResponse.json({ error: 'Stage not found or not in WAITING state' }, { status: 404 })

  const lastAssistant = [...stage.messages].reverse().find(m => m.role === 'ASSISTANT')
  if (!lastAssistant) return NextResponse.json({ error: 'No assistant message to lock' }, { status: 400 })

  const meta = STAGE_META[stageKey as keyof typeof STAGE_META]
  const docOrder = STAGE_ORDER.indexOf(stageKey as typeof STAGE_ORDER[number])

  // Determine next version for this document
  const latestDoc = await prisma.lockedDocument.findFirst({
    where: { projectId, sourceKey: stageKey },
    orderBy: { version: 'desc' },
  })
  const nextVersion = latestDoc ? latestDoc.version + 1 : 1

  // Lock stage + create new versioned locked document
  const [lockedDoc] = await prisma.$transaction([
    prisma.lockedDocument.create({
      data: {
        projectId: projectId,
        title: meta?.docTitle ?? stageKey,
        sourceKey: stageKey,
        content: lastAssistant.content,
        order: docOrder >= 0 ? docOrder : 99,
        color: meta?.color ?? '#888',
        version: nextVersion,
      },
    }),
    prisma.pipelineStage.update({
      where: { id: stage.id },
      data: { status: 'LOCKED', lockedContent: lastAssistant.content },
    }),
  ])

  // Special: decompose → parse and smart-merge exec tasks
  if (stageKey === 'decompose') {
    const newTasks = parseTasks(lastAssistant.content)
    const existingTasks = await prisma.execTask.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    })

    function norm(s: string) { return s.toLowerCase().replace(/\s+/g, ' ').trim() }

    const existingByName = new Map(existingTasks.map(t => [norm(t.name), t]))
    const newTaskNorms = new Set(newTasks.map(t => norm(t.name)))

    // Delete unmatched unlocked tasks
    const toDelete = existingTasks
      .filter(t => t.status !== 'LOCKED' && !newTaskNorms.has(norm(t.name)))
      .map(t => t.id)
    if (toDelete.length > 0) {
      await prisma.execTask.deleteMany({ where: { id: { in: toDelete } } })
    }

    // Build merged task list following new task order
    const mergedTasks = []
    for (let i = 0; i < newTasks.length; i++) {
      const nt = newTasks[i]
      const existing = existingByName.get(norm(nt.name))
      if (existing) {
        const marker = existing.status === 'LOCKED' ? 'NEEDS_RERUN' : 'ADJUSTED'
        // Clear messages for non-locked tasks so they restart fresh
        if (existing.status !== 'LOCKED') {
          await prisma.message.deleteMany({ where: { execTaskId: existing.id } })
        }
        const updated = await prisma.execTask.update({
          where: { id: existing.id },
          data: { name: nt.name, outputDesc: nt.outputDesc, order: i, marker, status: existing.status === 'LOCKED' ? existing.status : 'IDLE' },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        })
        mergedTasks.push(updated)
      } else {
        const created = await prisma.execTask.create({
          data: { projectId, name: nt.name, outputDesc: nt.outputDesc, order: i, status: 'IDLE', marker: 'NEW' },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        })
        mergedTasks.push(created)
      }
    }

    // Append locked tasks not in new list (push to end, preserve history)
    let endOrder = newTasks.length
    for (const locked of existingTasks.filter(t => t.status === 'LOCKED' && !newTaskNorms.has(norm(t.name)))) {
      const updated = await prisma.execTask.update({
        where: { id: locked.id },
        data: { order: endOrder++ },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
      mergedTasks.push(updated)
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { currentStage: 'execute', status: 'EXECUTING' },
    })
    return NextResponse.json({
      lockedDoc,
      nextAction: { type: 'build_exec_tasks', execTasks: mergedTasks },
    })
  }

  // Next pipeline stage
  const idx = STAGE_ORDER.indexOf(stageKey as typeof STAGE_ORDER[number])
  if (idx >= 0 && idx < STAGE_ORDER.length - 1) {
    const nextKey = STAGE_ORDER[idx + 1]
    await prisma.project.update({
      where: { id: projectId },
      data: { currentStage: nextKey },
    })
    return NextResponse.json({ lockedDoc, nextAction: { type: 'next_stage', stageKey: nextKey } })
  }

  // Monitor confirm → complete
  if (stageKey === 'monitor') {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'COMPLETED' },
    })
    return NextResponse.json({ lockedDoc, nextAction: { type: 'complete' } })
  }

  return NextResponse.json({ lockedDoc, nextAction: { type: 'complete' } })
}
