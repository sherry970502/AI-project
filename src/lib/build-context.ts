import { prisma } from './db'

export async function buildContext(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { description: true },
  })

  const [docs, knowledge] = await Promise.all([
    prisma.lockedDocument.findMany({ where: { projectId }, orderBy: { order: 'asc' } }),
    prisma.knowledgeEntry.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
  ])

  let ctx = `项目描述：${project?.description ?? ''}\n\n`
  for (const doc of docs) {
    ctx += `【已锁定·${doc.title}】\n${doc.content}\n\n`
  }
  if (knowledge.length > 0) {
    ctx += `【知识库补充材料】\n`
    for (const k of knowledge) {
      ctx += `─ ${k.title}（${k.type === 'FILE' ? '文件' : '笔记'}）\n${k.content}\n\n`
    }
  }
  return ctx.trim()
}
