import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; stageKey: string }> }
) {
  const { projectId, stageKey } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stage = await prisma.pipelineStage.findFirst({
    where: {
      stageKey,
      project: { id: projectId, userId: session.user.id },
    },
  })

  if (!stage) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })

  // Reset stage: clear messages and set back to IDLE
  await prisma.$transaction([
    prisma.message.deleteMany({ where: { stageId: stage.id } }),
    prisma.pipelineStage.update({
      where: { id: stage.id },
      data: { status: 'IDLE', lockedContent: null },
    }),
  ])

  return NextResponse.json({ ok: true, stageKey })
}
