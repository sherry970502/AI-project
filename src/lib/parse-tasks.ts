export interface ParsedTask {
  name: string
  outputDesc: string
}

function parseTaskLine(line: string): ParsedTask {
  const parts = line.split(/[|｜]/)
  const name = parts[0]
    .replace(/^[\s\-\*]*任务\s*\d+\s*[：:\.\s]+/, '')
    .replace(/^[\s\-\*]*\d+\s*[\.、\)）]\s*/, '')
    .trim()
  const outputDesc = parts[1]
    ? parts[1].replace(/^产出[物]?\s*[：:\s]+/, '').trim()
    : '待定'
  return { name: name || line.trim(), outputDesc }
}

export function parseTasks(content: string): ParsedTask[] {
  // Strategy 1: structured block ===任务清单=== ... ===END===
  const blockMatch = content.match(/===\s*任务清单\s*===([\s\S]*?)===\s*END\s*===/)
  if (blockMatch) {
    const lines = blockMatch[1].trim().split('\n').filter(l => l.trim())
    const tasks = lines.map(parseTaskLine).filter(t => t.name)
    if (tasks.length > 0) return tasks
  }

  // Strategy 2: lines starting with 任务N：
  const taskLines = content.split('\n').filter(l => l.match(/^[\s\-]*任务\s*\d+\s*[：:]/))
  if (taskLines.length > 0) {
    return taskLines.map(parseTaskLine).filter(t => t.name)
  }

  // Strategy 3: numbered list items (1. / 1、 / 1) with | pipe for output
  const numberedWithPipe = content.split('\n').filter(l => l.match(/^\s*\d+[\.\、\)）]\s*.+\|/))
  if (numberedWithPipe.length > 0) {
    return numberedWithPipe.map(parseTaskLine).filter(t => t.name)
  }

  // Strategy 4: any numbered list items (best effort)
  const numbered = content.split('\n').filter(l => l.match(/^\s*\d+[\.\、\)）]\s+\S/))
  if (numbered.length > 0) {
    return numbered.map(parseTaskLine).filter(t => t.name)
  }

  return [{ name: '综合执行', outputDesc: '基于任务清单的综合产出物' }]
}
