export interface ParsedTask {
  name: string
  outputDesc: string
}

function parseTaskLine(line: string): ParsedTask {
  const parts = line.split(/[|｜]/)
  const name = parts[0]
    .replace(/^[\s\-\*#]*任务\s*\d+\s*[：:\.\s]+/, '')
    .replace(/^[\s\-\*#]*\d+\s*[\.、\)）]\s*/, '')
    .replace(/\*\*/g, '')
    .trim()
  const outputDesc = parts[1]
    ? parts[1].replace(/^产出[物]?\s*[：:\s]+/, '').trim()
    : '待定'
  return { name: name || line.trim(), outputDesc }
}

function extractOutputDesc(lines: string[], startIdx: number): string {
  // Look ahead for outputDesc in the following lines (within next 5 lines)
  for (let i = startIdx + 1; i < Math.min(startIdx + 6, lines.length); i++) {
    const l = lines[i].trim()
    if (l.match(/^[-\s\*]*具体产出物?\s*[：:]/)) {
      return l.replace(/^[-\s\*]*具体产出物?\s*[：:\s]+/, '').trim()
    }
    if (l.match(/^[-\s\*]*产出[物]?\s*[：:]/)) {
      return l.replace(/^[-\s\*]*产出[物]?\s*[：:\s]+/, '').trim()
    }
    // Stop at next task heading
    if (l.match(/^[\s\-\*#]*任务\s*\d+/) || l.match(/^\s*\d+[\.\、\)）]/)) break
  }
  return '待定'
}

export function parseTasks(content: string): ParsedTask[] {
  // Strategy 1: structured block ===任务清单=== ... ===END===
  // Handle variations: full-width ===, different spacing, or 【任务清单】 wrapper
  const blockMatch = content.match(/[=＝]{2,}\s*任务清单\s*[=＝]{2,}([\s\S]*?)[=＝]{2,}\s*END\s*[=＝]{2,}/i)
  if (blockMatch) {
    const lines = blockMatch[1].trim().split('\n').filter(l => l.trim())
    const tasks = lines.map(parseTaskLine).filter(t => t.name)
    if (tasks.length > 0) return tasks
  }

  // Strategy 2: markdown code block containing task list
  const codeBlockMatch = content.match(/```[\s\S]*?===\s*任务清单\s*===([\s\S]*?)===\s*END\s*===[\s\S]*?```/)
  if (codeBlockMatch) {
    const lines = codeBlockMatch[1].trim().split('\n').filter(l => l.trim())
    const tasks = lines.map(parseTaskLine).filter(t => t.name)
    if (tasks.length > 0) return tasks
  }

  // Strategy 3: lines starting with 任务N：(handles bold, headers, etc.)
  const taskLines = content.split('\n').filter(l => l.match(/^[\s\-\*#]*\*{0,2}任务\s*\d+\s*[：:]/))
  if (taskLines.length > 0) {
    const allLines = content.split('\n')
    return taskLines.map(line => {
      const idx = allLines.indexOf(line)
      const parsed = parseTaskLine(line)
      if (parsed.outputDesc === '待定' && idx >= 0) {
        parsed.outputDesc = extractOutputDesc(allLines, idx)
      }
      return parsed
    }).filter(t => t.name)
  }

  // Strategy 4: numbered list items with | pipe for output
  const numberedWithPipe = content.split('\n').filter(l => l.match(/^\s*\*{0,2}\d+[\.\、\)）]\s*.+[|｜]/))
  if (numberedWithPipe.length > 0) {
    return numberedWithPipe.map(parseTaskLine).filter(t => t.name)
  }

  // Strategy 5: markdown headers that look like tasks (### 任务N or ### N. TaskName)
  const headerTasks = content.split('\n').filter(l => l.match(/^#{1,4}\s*(任务\s*\d+|[\d]+[\.\s])/))
  if (headerTasks.length > 0) {
    const allLines = content.split('\n')
    return headerTasks.map(line => {
      const idx = allLines.indexOf(line)
      const parsed = parseTaskLine(line.replace(/^#+\s*/, ''))
      if (parsed.outputDesc === '待定' && idx >= 0) {
        parsed.outputDesc = extractOutputDesc(allLines, idx)
      }
      return parsed
    }).filter(t => t.name)
  }

  // Strategy 6: any numbered list items (best effort)
  const numbered = content.split('\n').filter(l => l.match(/^\s*\d+[\.\、\)）]\s+\S/))
  if (numbered.length > 0) {
    return numbered.map(parseTaskLine).filter(t => t.name)
  }

  return [{ name: '综合执行', outputDesc: '基于任务清单的综合产出物' }]
}
