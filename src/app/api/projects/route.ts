import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, description: true, status: true, currentStage: true, createdAt: true, updatedAt: true },
  })

  return NextResponse.json(projects)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { title, description, initialMaterial } = await req.json()
  if (!description?.trim()) return NextResponse.json({ error: 'Description required' }, { status: 400 })

  const project = await prisma.project.create({
    data: {
      userId: session.user.id,
      title: title || description.slice(0, 30),
      description,
      stages: {
        create: [
          { stageKey: 'calibrate', status: 'IDLE' },
          { stageKey: 'boundary',  status: 'IDLE' },
          { stageKey: 'decompose', status: 'IDLE' },
          { stageKey: 'monitor',   status: 'IDLE' },
        ],
      },
      ...(initialMaterial?.trim() ? {
        knowledgeEntries: {
          create: [{
            type: 'NOTE',
            title: '初始材料',
            content: initialMaterial.trim(),
          }],
        },
      } : {}),
    },
    include: { stages: true },
  })

  return NextResponse.json(project, { status: 201 })
}
