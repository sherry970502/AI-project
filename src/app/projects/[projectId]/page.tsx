import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { PlannerClient } from './client'

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    include: {
      stages: {
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      },
      execTasks: {
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
          actionItems: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { order: 'asc' },
      },
      lockedDocs: { orderBy: [{ order: 'asc' }, { version: 'asc' }] },
      knowledgeEntries: { orderBy: { createdAt: 'desc' } },
      conciergeMessages: { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!project) notFound()

  // Deduplicate: keep only latest version per sourceKey
  const docMap = new Map<string, typeof project.lockedDocs[0]>()
  for (const doc of project.lockedDocs) {
    const existing = docMap.get(doc.sourceKey)
    if (!existing || doc.version > existing.version) docMap.set(doc.sourceKey, doc)
  }
  const deduped = { ...project, lockedDocs: Array.from(docMap.values()).sort((a, b) => a.order - b.order) }

  return <PlannerClient project={JSON.parse(JSON.stringify(deduped))} />
}
