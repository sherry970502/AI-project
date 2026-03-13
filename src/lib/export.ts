import { LockedDocument } from '@prisma/client'

export function buildMarkdownExport(
  projectTitle: string,
  projectDescription: string,
  docs: LockedDocument[]
): string {
  const date = new Date().toLocaleDateString('zh-CN')
  let md = `# ${projectTitle}\n\n`
  md += `> 生成时间：${date}\n\n`
  md += `## 项目描述\n\n${projectDescription}\n\n`
  md += `---\n\n`

  for (const doc of docs) {
    md += `## ${doc.title}\n\n`
    md += `${doc.content}\n\n`
    md += `---\n\n`
  }

  return md
}
