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

  const project = await prisma.project.findFirst({ where: { id: projectId, userId: session.user.id } })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const entries = await prisma.knowledgeEntry.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(entries)
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

  const { title, content } = await req.json()
  if (!title?.trim() || !content?.trim()) {
    return NextResponse.json({ error: 'title and content required' }, { status: 400 })
  }

  const entry = await prisma.knowledgeEntry.create({
    data: { projectId, type: 'NOTE', title: title.trim(), content: content.trim() },
  })
  return NextResponse.json(entry)
}
