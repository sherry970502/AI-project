import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ execTaskId: string }> }
) {
  const { execTaskId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const task = await prisma.execTask.findFirst({
    where: { id: execTaskId, project: { userId: session.user.id } },
    select: { id: true },
  })
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const items = await prisma.actionItem.findMany({
    where: { execTaskId },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(items)
}
