import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ execTaskId: string; itemId: string }> }
) {
  const { execTaskId, itemId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { completed } = await req.json()

  const item = await prisma.actionItem.findFirst({
    where: { id: itemId, execTaskId, execTask: { project: { userId: session.user.id } } },
  })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.actionItem.update({
    where: { id: itemId },
    data: { completed },
  })
  return NextResponse.json(updated)
}
