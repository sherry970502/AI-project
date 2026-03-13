import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    include: {
      stages: {
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      },
      execTasks: {
        include: { messages: { orderBy: { createdAt: 'asc' } } },
        orderBy: { order: 'asc' },
      },
      lockedDocs: { orderBy: { order: 'asc' } },
    },
  })

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(project)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.project.deleteMany({
    where: { id: projectId, userId: session.user.id },
  })

  return NextResponse.json({ ok: true })
}
