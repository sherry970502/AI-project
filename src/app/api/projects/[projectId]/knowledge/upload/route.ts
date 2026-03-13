import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.project.findFirst({ where: { id: projectId, userId: session.user.id } })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const fileName = file.name
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const buffer = Buffer.from(await file.arrayBuffer())

  let content = ''

  try {
    if (ext === 'txt') {
      content = buffer.toString('utf-8')
    } else if (ext === 'pdf') {
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse(buffer)
      const result = await parser.getText()
      content = result.text
    } else if (ext === 'docx' || ext === 'doc') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      content = result.value
    } else {
      return NextResponse.json({ error: '不支持的文件格式，请上传 PDF、Word 或 TXT' }, { status: 400 })
    }
  } catch (err) {
    console.error('[upload] parse error:', err)
    const msg = err instanceof Error ? err.message : '文件解析失败'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  content = content.trim()
  if (!content) return NextResponse.json({ error: '文件内容为空' }, { status: 400 })

  const title = fileName.replace(/\.[^.]+$/, '')
  const entry = await prisma.knowledgeEntry.create({
    data: { projectId, type: 'FILE', title, content, fileName },
  })
  return NextResponse.json(entry)
}
