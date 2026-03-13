import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { buildMarkdownExport } from '@/lib/export'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    include: { lockedDocs: { orderBy: { order: 'asc' } } },
  })

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const markdown = buildMarkdownExport(project.title, project.description, project.lockedDocs)
  const filename = `${project.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-')}-规划文档.md`

  return new NextResponse(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  })
}
