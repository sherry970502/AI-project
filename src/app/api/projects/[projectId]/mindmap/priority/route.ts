import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.project.findFirst({ where: { id: projectId, userId: session.user.id } })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { nodeId, priority } = await req.json()

  const existing = await prisma.mindMap.findUnique({ where: { projectId } })
  if (!existing) return NextResponse.json({ error: 'Mind map not found' }, { status: 404 })

  const priorities = JSON.parse(existing.priorities) as Record<string, string>
  if (priority === null || priority === undefined) {
    delete priorities[nodeId]
  } else {
    priorities[nodeId] = priority
  }

  const updated = await prisma.mindMap.update({
    where: { projectId },
    data: { priorities: JSON.stringify(priorities) },
  })

  return NextResponse.json({ priorities: JSON.parse(updated.priorities) })
}
