export interface ParsedTask {
  name: string
  outputDesc: string
}

export function parseTasks(content: string): ParsedTask[] {
  const match = content.match(/===任务清单===([\s\S]*?)===END===/)
  if (match) {
    const lines = match[1].trim().split('\n').filter(l => l.trim())
    return lines.map(l => {
      const parts = l.split('|')
      const name = parts[0].replace(/^任务\d+[：:\s]+/, '').trim()
      const outputDesc = parts[1] ? parts[1].replace(/产出[：:\s]+/, '').trim() : '待定'
      return { name, outputDesc }
    })
  }

  // Fallback: numbered lines
  const lines = content.split('\n').filter(l => l.match(/^任务\d+[：:]/))
  if (lines.length) {
    return lines.map(l => {
      const parts = l.split('|')
      const name = parts[0].replace(/^任务\d+[：:\s]+/, '').trim()
      const outputDesc = parts[1] ? parts[1].replace(/产出[：:\s]+/, '').trim() : '待定'
      return { name, outputDesc }
    })
  }

  return [{ name: '综合执行', outputDesc: '基于任务清单的综合产出物' }]
}
