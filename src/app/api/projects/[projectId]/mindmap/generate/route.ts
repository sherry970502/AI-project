import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamCompletion } from '@/lib/anthropic'
import { buildContext } from '@/lib/build-context'

const SYSTEM = `你是项目战略规划专家。根据项目文档，生成一个层级思维导图的 JSON 结构。

规则：
1. 根节点代表项目的理想化愿景与终极目标
2. 从根节点向下：战略目标 → 阶段计划 → 具体事务
3. 层数由内容自然决定（通常2-4层）
4. 每个节点 title 控制在 15 字以内，简洁有力
5. 每个节点可以有可选的 summary（一句话，30字以内）
6. 严格只输出 JSON，不要任何其他文字

输出格式（严格遵守）：
{
  "id": "root",
  "title": "节点标题",
  "summary": "可选说明",
  "children": [
    {
      "id": "n1",
      "title": "子节点",
      "summary": "可选说明",
      "children": []
    }
  ]
}

每个节点 id 唯一，使用 root、n1、n2、n1-1、n1-2 等格式。`

function extractJSON(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AI 未返回有效 JSON')
  return text.slice(start, end + 1)
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.project.findFirst({ where: { id: projectId, userId: session.user.id } })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const context = await buildContext(projectId)
  if (!context.trim()) {
    return NextResponse.json({ error: '请先完成规划流程，生成项目文档后再生成思维导图' }, { status: 400 })
  }

  try {
    const fullText = await streamCompletion(
      SYSTEM,
      [{ role: 'user', content: `项目信息：\n${context}\n\n请生成思维导图 JSON。` }],
      () => {}
    )

    const jsonStr = extractJSON(fullText)
    JSON.parse(jsonStr) // validate

    const existing = await prisma.mindMap.findUnique({ where: { projectId } })
    const mindMap = existing
      ? await prisma.mindMap.update({
          where: { projectId },
          data: { nodes: jsonStr, generatedAt: new Date() },
        })
      : await prisma.mindMap.create({
          data: { projectId, nodes: jsonStr },
        })

    return NextResponse.json(mindMap)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '生成失败'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
