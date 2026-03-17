'use client'

import { useState, useCallback, useRef } from 'react'
import { X, RefreshCw, GitBranch, AlertCircle } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface TreeNode {
  id: string
  title: string
  summary?: string
  children: TreeNode[]
}

type Priority = 'HIGH' | 'MEDIUM' | 'LOW'
type Priorities = Record<string, Priority>

interface LayoutNode {
  id: string
  title: string
  summary?: string
  x: number
  y: number
  depth: number
  parentId?: string
}

// ── Layout ─────────────────────────────────────────────────────────────────

const NW = 164   // node width
const NH = 44    // node height
const HGAP = 72  // horizontal gap between levels
const VGAP = 14  // vertical gap between siblings
const PAD = 24   // padding

function layoutTree(root: TreeNode): LayoutNode[] {
  const result: LayoutNode[] = []

  function place(node: TreeNode, depth: number, yStart: number, parentId?: string): number {
    const x = PAD + depth * (NW + HGAP)

    const children = Array.isArray(node.children) ? node.children : []
    if (children.length === 0) {
      const y = yStart + NH / 2
      result.push({ id: node.id, title: node.title, summary: node.summary, x, y, depth, parentId })
      return yStart + NH + VGAP
    }

    let childY = yStart
    const childCenters: number[] = []
    for (const child of children) {
      const childEnd = place(child, depth + 1, childY, node.id)
      const childNode = result.find(n => n.id === child.id)
      if (childNode) childCenters.push(childNode.y)
      childY = childEnd
    }

    const y = (childCenters[0] + childCenters[childCenters.length - 1]) / 2
    result.push({ id: node.id, title: node.title, summary: node.summary, x, y, depth, parentId })
    return childY
  }

  place(root, 0, PAD)
  return result
}

// ── Priority ───────────────────────────────────────────────────────────────

const PRIORITY_CYCLE: (Priority | null)[] = [null, 'HIGH', 'MEDIUM', 'LOW']
const PRIORITY_COLOR: Record<Priority, string> = {
  HIGH: '#e07070',
  MEDIUM: '#c8a96e',
  LOW: '#7eb8c8',
}
const PRIORITY_LABEL: Record<Priority, string> = {
  HIGH: '高优',
  MEDIUM: '中优',
  LOW: '低优',
}

// ── SVG Components ─────────────────────────────────────────────────────────

function Edge({ from, to }: { from: LayoutNode; to: LayoutNode }) {
  const x1 = from.x + NW
  const y1 = from.y
  const x2 = to.x
  const y2 = to.y
  const mx = (x1 + x2) / 2
  return (
    <path
      d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
      fill="none"
      stroke="var(--p-border2)"
      strokeWidth={1.5}
    />
  )
}

function Node({
  node,
  priority,
  onPriorityClick,
}: {
  node: LayoutNode
  priority: Priority | null
  onPriorityClick: (id: string) => void
}) {
  const isRoot = node.depth === 0
  const color = isRoot ? 'var(--p-accent)' : node.depth === 1 ? 'var(--p-accent2)' : 'var(--p-text-mid)'
  const bg = isRoot ? 'rgba(200,169,110,0.08)' : 'var(--p-surface2)'
  const border = isRoot ? 'rgba(200,169,110,0.4)' : 'var(--p-border2)'

  return (
    <g>
      {/* Node box */}
      <rect
        x={node.x}
        y={node.y - NH / 2}
        width={NW}
        height={NH}
        rx={3}
        fill={bg}
        stroke={border}
        strokeWidth={1}
      />
      {/* Title */}
      <foreignObject x={node.x + 8} y={node.y - NH / 2 + 4} width={NW - 20} height={NH - 8}>
        <div
          style={{
            fontSize: isRoot ? '12px' : '11px',
            fontWeight: isRoot ? 600 : 400,
            color,
            lineHeight: '1.3',
            wordBreak: 'break-all',
            fontFamily: 'var(--font-serif)',
          }}
        >
          {node.title}
        </div>
      </foreignObject>
      {/* Priority dot */}
      <circle
        cx={node.x + NW - 8}
        cy={node.y - NH / 2 + 8}
        r={5}
        fill={priority ? PRIORITY_COLOR[priority] : 'var(--p-border2)'}
        stroke={priority ? PRIORITY_COLOR[priority] : 'var(--p-border)'}
        strokeWidth={1}
        style={{ cursor: 'pointer' }}
        onClick={() => onPriorityClick(node.id)}
      />
    </g>
  )
}

// ── MindMap SVG ────────────────────────────────────────────────────────────

function MindMapSVG({
  root,
  priorities,
  onPriorityClick,
}: {
  root: TreeNode
  priorities: Priorities
  onPriorityClick: (id: string) => void
}) {
  const nodes = layoutTree(root)
  const w = Math.max(...nodes.map(n => n.x)) + NW + PAD
  const h = Math.max(...nodes.map(n => n.y)) + NH / 2 + PAD

  const edges: { from: LayoutNode; to: LayoutNode }[] = []
  for (const node of nodes) {
    if (node.parentId) {
      const parent = nodes.find(n => n.id === node.parentId)
      if (parent) edges.push({ from: parent, to: node })
    }
  }

  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      {edges.map((e, i) => <Edge key={i} from={e.from} to={e.to} />)}
      {nodes.map(n => (
        <Node
          key={n.id}
          node={n}
          priority={priorities[n.id] ?? null}
          onPriorityClick={onPriorityClick}
        />
      ))}
    </svg>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

interface MindMapData {
  id: string
  nodes: string
  priorities: string
  generatedAt: string
}

export function MindMapButton({
  projectId,
  latestDocUpdate,
}: {
  projectId: string
  latestDocUpdate: Date | null
}) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<MindMapData | null>(null)
  const [priorities, setPriorities] = useState<Priorities>({})
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const isStale = !!(data && latestDocUpdate && new Date(data.generatedAt) < latestDocUpdate)

  const openModal = useCallback(async () => {
    setOpen(true)
    if (data) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/mindmap`)
      const json = await res.json()
      if (json) {
        setData(json)
        setPriorities(JSON.parse(json.priorities ?? '{}'))
      }
    } finally {
      setLoading(false)
    }
  }, [projectId, data])

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/mindmap/generate`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? '生成失败'); return }
      setData(json)
      setPriorities(JSON.parse(json.priorities ?? '{}'))
    } catch {
      setError('网络错误')
    } finally {
      setGenerating(false)
    }
  }

  async function handlePriorityClick(nodeId: string) {
    const current = priorities[nodeId] ?? null
    const idx = PRIORITY_CYCLE.indexOf(current)
    const next = PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length]

    const newPriorities = { ...priorities }
    if (next === null) delete newPriorities[nodeId]
    else newPriorities[nodeId] = next
    setPriorities(newPriorities)

    await fetch(`/api/projects/${projectId}/mindmap/priority`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId, priority: next }),
    })
  }

  let root: TreeNode | null = null
  if (data) {
    try { root = JSON.parse(data.nodes) } catch {}
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={openModal}
        className="flex items-center gap-1.5 font-mono text-xs cursor-pointer"
        style={{ color: isStale ? 'var(--p-accent)' : 'var(--p-text-dim)' }}
        title={isStale ? '文档已更新，思维导图可能需要重新生成' : '思维导图'}
      >
        <GitBranch size={11} />
        导图{isStale ? ' ·' : ''}
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: 'var(--p-bg)' }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-4 px-6 py-3 shrink-0"
            style={{ borderBottom: '1px solid var(--p-border)', background: 'var(--p-surface)' }}
          >
            <GitBranch size={13} style={{ color: 'var(--p-accent)' }} />
            <span className="font-mono text-xs tracking-widest" style={{ color: 'var(--p-accent)' }}>
              思维导图
            </span>
            {isStale && !generating && (
              <span className="font-mono text-xs flex items-center gap-1" style={{ color: 'var(--p-accent)', opacity: 0.7 }}>
                <AlertCircle size={10} /> 文档已更新
              </span>
            )}
            <div className="flex-1" />

            {/* Priority legend */}
            <div className="flex items-center gap-3 mr-4">
              {(Object.entries(PRIORITY_LABEL) as [Priority, string][]).map(([p, label]) => (
                <div key={p} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: PRIORITY_COLOR[p] }} />
                  <span className="font-mono" style={{ fontSize: '9px', color: 'var(--p-text-dim)' }}>{label}</span>
                </div>
              ))}
              <span className="font-mono ml-1" style={{ fontSize: '9px', color: 'var(--p-text-dim)' }}>· 点击节点右上角圆点标记优先级</span>
            </div>

            <button
              onClick={generate}
              disabled={generating}
              className="flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 border cursor-pointer"
              style={{ borderColor: 'var(--p-accent)', color: 'var(--p-accent)', borderRadius: '2px' }}
            >
              <RefreshCw size={10} className={generating ? 'animate-spin' : ''} />
              {generating ? 'AI 生成中...' : data ? '重新生成' : '生成思维导图'}
            </button>
            <button onClick={() => setOpen(false)} style={{ color: 'var(--p-text-dim)', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div ref={scrollRef} className="flex-1 overflow-auto p-8">
            {loading && (
              <div className="flex items-center justify-center h-full font-mono text-xs" style={{ color: 'var(--p-text-dim)' }}>
                加载中...
              </div>
            )}
            {!loading && error && (
              <div className="flex items-center justify-center h-full">
                <span className="font-mono text-xs" style={{ color: 'var(--p-error)' }}>⚠ {error}</span>
              </div>
            )}
            {!loading && !error && !root && !generating && (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="font-mono text-xs text-center leading-loose" style={{ color: 'var(--p-text-dim)' }}>
                  还没有生成思维导图<br />
                  点击「生成思维导图」让 AI 根据项目文档自动生成
                </div>
              </div>
            )}
            {!loading && generating && (
              <div className="flex items-center justify-center h-full font-mono text-xs" style={{ color: 'var(--p-text-dim)' }}>
                AI 正在分析项目文档，生成思维导图...
              </div>
            )}
            {!loading && !generating && root && (
              <MindMapSVG
                root={root}
                priorities={priorities}
                onPriorityClick={handlePriorityClick}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}
