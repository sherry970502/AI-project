'use client'

import { useReducer, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, ArrowLeft, BookOpen, Plus, Trash2, Upload, X, MessageCircle, Send } from 'lucide-react'
import { MindMapButton } from './mindmap'
import type { Project, PipelineStage, ExecTask as ExecTaskPrisma, Message, LockedDocument, KnowledgeEntry, ConciergeMessage } from '@prisma/client'
type ExecTask = ExecTaskPrisma & { marker?: string | null }
import { STAGE_META, EXEC_AGENT_COLOR } from '@/lib/agent-prompts'

// ── Types ─────────────────────────────────────────────────────────────────

type MessageRow = Message
type NoteMessage = { id: string; role: 'NOTE'; content: string; stageId: null; execTaskId: null; createdAt: Date }
type DisplayMessage = MessageRow | NoteMessage

type StageWithMessages = PipelineStage & { messages: MessageRow[] }
type ExecTaskWithMessages = ExecTask & { messages: MessageRow[] }
type ProjectFull = Project & {
  stages: StageWithMessages[]
  execTasks: ExecTaskWithMessages[]
  lockedDocs: LockedDocument[]
  knowledgeEntries: KnowledgeEntry[]
  conciergeMessages: ConciergeMessage[]
}

type AgentKey = string // 'calibrate'|'boundary'|'decompose'|'monitor'|'exec-{id}'

interface PlannerState {
  project: ProjectFull
  viewingKey: AgentKey
  conversations: Record<AgentKey, DisplayMessage[]>
  statuses: Record<AgentKey, string>
  streamingKey: AgentKey | null
  streamingText: string
  lockedDocs: LockedDocument[]
  execTasks: ExecTaskWithMessages[]
  knowledgeEntries: KnowledgeEntry[]
  error: string | null
}

type Action =
  | { type: 'STREAM_START'; key: AgentKey }
  | { type: 'STREAM_CHUNK'; text: string }
  | { type: 'STREAM_DONE' }
  | { type: 'SET_STATUS'; key: AgentKey; status: string }
  | { type: 'PUSH_MESSAGE'; key: AgentKey; msg: DisplayMessage }
  | { type: 'PUSH_NOTE'; key: AgentKey; content: string }
  | { type: 'SET_VIEW'; key: AgentKey }
  | { type: 'LOCK_DOC'; doc: LockedDocument }
  | { type: 'ADD_EXEC_TASKS'; tasks: ExecTaskWithMessages[] }
  | { type: 'ADD_KNOWLEDGE'; entry: KnowledgeEntry }
  | { type: 'DELETE_KNOWLEDGE'; entryId: string }
  | { type: 'RESET_STAGE'; key: AgentKey }
  | { type: 'SET_ERROR'; msg: string | null }
  | { type: 'CLEAR_STREAMING' }

function buildInitialState(project: ProjectFull): PlannerState {
  const conversations: Record<string, MessageRow[]> = {}
  const statuses: Record<string, string> = {}

  for (const s of project.stages) {
    conversations[s.stageKey] = s.messages
    statuses[s.stageKey] = s.status
  }
  for (const t of project.execTasks) {
    const key = `exec-${t.id}`
    conversations[key] = t.messages
    statuses[key] = t.status
  }

  return {
    project,
    viewingKey: 'calibrate',
    conversations,
    statuses,
    streamingKey: null,
    streamingText: '',
    lockedDocs: project.lockedDocs,
    execTasks: project.execTasks,
    knowledgeEntries: project.knowledgeEntries,
    error: null,
  }
}

function reducer(state: PlannerState, action: Action): PlannerState {
  switch (action.type) {
    case 'STREAM_START':
      return { ...state, streamingKey: action.key, streamingText: '', error: null }
    case 'STREAM_CHUNK':
      return { ...state, streamingText: state.streamingText + action.text }
    case 'STREAM_DONE':
      return { ...state, streamingKey: null }
    case 'CLEAR_STREAMING':
      return { ...state, streamingText: '', streamingKey: null }
    case 'SET_STATUS':
      return { ...state, statuses: { ...state.statuses, [action.key]: action.status } }
    case 'PUSH_MESSAGE':
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [action.key]: [...(state.conversations[action.key] ?? []), action.msg],
        },
      }
    case 'PUSH_NOTE': {
      const note: NoteMessage = { id: `note-${Date.now()}`, role: 'NOTE', content: action.content, stageId: null, execTaskId: null, createdAt: new Date() }
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [action.key]: [...(state.conversations[action.key] ?? []), note],
        },
      }
    }
    case 'SET_VIEW':
      return { ...state, viewingKey: action.key }
    case 'LOCK_DOC': {
      const existing = state.lockedDocs.findIndex(d => d.id === action.doc.id || d.sourceKey === action.doc.sourceKey)
      const docs = existing >= 0
        ? state.lockedDocs.map((d, i) => i === existing ? action.doc : d)
        : [...state.lockedDocs, action.doc]
      return { ...state, lockedDocs: docs }
    }
    case 'ADD_EXEC_TASKS': {
      const newStatuses = { ...state.statuses }
      const newConvs = { ...state.conversations }
      for (const t of action.tasks) {
        const key = `exec-${t.id}`
        newStatuses[key] = t.status
        // Preserve existing conversation if already has messages (e.g. locked task)
        if (!newConvs[key] || newConvs[key].length === 0) {
          newConvs[key] = t.messages
        }
      }
      return { ...state, execTasks: action.tasks, statuses: newStatuses, conversations: newConvs }
    }
    case 'RESET_STAGE':
      return { ...state, conversations: { ...state.conversations, [action.key]: [] } }
    case 'ADD_KNOWLEDGE':
      return { ...state, knowledgeEntries: [action.entry, ...state.knowledgeEntries] }
    case 'DELETE_KNOWLEDGE':
      return { ...state, knowledgeEntries: state.knowledgeEntries.filter(e => e.id !== action.entryId) }
    case 'SET_ERROR':
      return { ...state, error: action.msg }
    default:
      return state
  }
}

// ── SSE Consumer ──────────────────────────────────────────────────────────

async function consumeSSE(
  url: string,
  body: object,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok || !res.body) { onError(`HTTP ${res.status}`); return }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  function processLine(line: string) {
    if (!line.startsWith('data: ')) return
    try {
      const evt = JSON.parse(line.slice(6))
      if (evt.type === 'chunk') onChunk(evt.text)
      else if (evt.type === 'done') onDone()
      else if (evt.type === 'error') onError(evt.message)
    } catch {}
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) processLine(line)
  }

  // Flush any remaining data in buffer after stream closes
  if (buffer) processLine(buffer)
}

// ── Main Component ────────────────────────────────────────────────────────

export function PlannerClient({ project }: { project: ProjectFull }) {
  const router = useRouter()
  const [state, dispatch] = useReducer(reducer, buildInitialState(project))
  const [revisionMode, setRevisionMode] = useState(false)
  const [rightTab, setRightTab] = useState<'docs' | 'knowledge'>('docs')
  const [knowledgeInput, setKnowledgeInput] = useState('')
  const [knowledgeTitle, setKnowledgeTitle] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Concierge state
  const [conciergeOpen, setConciergeOpen] = useState(false)
  const [conciergeMessages, setConciergeMessages] = useState<ConciergeMessage[]>(project.conciergeMessages)
  const [conciergeStreaming, setConciergeStreaming] = useState(false)
  const [conciergeText, setConciergeText] = useState('')
  const conciergeInputRef = useRef<HTMLTextAreaElement>(null)
  const conciergeDialogRef = useRef<HTMLDivElement>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const execTasksRef = useRef(state.execTasks)
  useEffect(() => { execTasksRef.current = state.execTasks }, [state.execTasks])

  useEffect(() => {
    if (conciergeOpen) requestAnimationFrame(() => {
      if (conciergeDialogRef.current) conciergeDialogRef.current.scrollTop = conciergeDialogRef.current.scrollHeight
    })
  }, [conciergeMessages, conciergeText, conciergeOpen])

  async function addKnowledgeNote() {
    if (!knowledgeTitle.trim() || !knowledgeInput.trim()) return
    setSavingNote(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: knowledgeTitle, content: knowledgeInput }),
      })
      const entry = await res.json()
      dispatch({ type: 'ADD_KNOWLEDGE', entry })
      setKnowledgeTitle('')
      setKnowledgeInput('')
      setAddingNote(false)
    } finally {
      setSavingNote(false)
    }
  }

  async function uploadKnowledgeFile(file: File) {
    setUploadingFile(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/projects/${project.id}/knowledge/upload`, { method: 'POST', body: form })
      if (!res.ok) {
        const text = await res.text()
        let msg = '上传失败'
        try { msg = JSON.parse(text).error ?? msg } catch { msg = text || msg }
        alert(msg); return
      }
      const entry = await res.json()
      dispatch({ type: 'ADD_KNOWLEDGE', entry })
    } finally {
      setUploadingFile(false)
    }
  }

  async function deleteKnowledge(entryId: string) {
    await fetch(`/api/projects/${project.id}/knowledge/${entryId}`, { method: 'DELETE' })
    dispatch({ type: 'DELETE_KNOWLEDGE', entryId })
  }

  async function recalibrateStage(stageKey: string) {
    const res = await fetch(`/api/projects/${project.id}/stages/${stageKey}/recalibrate`, { method: 'POST' })
    if (!res.ok) return
    // Clear conversation and reset status in client state
    dispatch({ type: 'PUSH_NOTE', key: stageKey, content: '─── 重新校准已启动，知识库已更新 ───' })
    dispatch({ type: 'SET_STATUS', key: stageKey, status: 'IDLE' })
    // Clear existing messages by pushing a pseudo-reset (handled via conversations update)
    dispatch({ type: 'RESET_STAGE', key: stageKey })
    setTimeout(() => runStage(stageKey), 300)
  }

  async function sendConcierge(text: string) {
    if (!text.trim() || conciergeStreaming) return
    const userMsg: ConciergeMessage = { id: `tmp-${Date.now()}`, projectId: project.id, role: 'USER', content: text, createdAt: new Date() }
    setConciergeMessages(prev => [...prev, userMsg])
    setConciergeStreaming(true)
    setConciergeText('')

    let full = ''
    await consumeSSE(
      `/api/projects/${project.id}/concierge`,
      { message: text },
      chunk => { full += chunk; setConciergeText(full) },
      () => {
        const aiMsg: ConciergeMessage = { id: `ai-${Date.now()}`, projectId: project.id, role: 'ASSISTANT', content: full, createdAt: new Date() }
        setConciergeMessages(prev => [...prev, aiMsg])
        setConciergeStreaming(false)
        setConciergeText('')
      },
      () => setConciergeStreaming(false)
    )
  }

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (dialogRef.current) dialogRef.current.scrollTop = dialogRef.current.scrollHeight
    })
  }, [])

  useEffect(() => { scrollToBottom() }, [state.conversations, state.streamingText, scrollToBottom])

  // Auto-start calibrate if no messages
  useEffect(() => {
    const cal = project.stages.find(s => s.stageKey === 'calibrate')
    if (cal && cal.messages.length === 0 && cal.status !== 'LOCKED') {
      runStage('calibrate')
    }
    // Resume WAITING stage
    const waiting = project.stages.find(s => s.status === 'WAITING')
    if (waiting) {
      dispatch({ type: 'SET_VIEW', key: waiting.stageKey })
    }
    // Resume WAITING exec task
    const waitingTask = project.execTasks.find(t => t.status === 'WAITING')
    if (waitingTask) {
      dispatch({ type: 'SET_VIEW', key: `exec-${waitingTask.id}` })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Run stage agent ──
  const runStage = useCallback(async (stageKey: string, userMessage?: string) => {
    dispatch({ type: 'STREAM_START', key: stageKey })
    dispatch({ type: 'SET_STATUS', key: stageKey, status: 'RUNNING' })
    dispatch({ type: 'SET_VIEW', key: stageKey })

    if (userMessage) {
      const fakeMsg: MessageRow = {
        id: `tmp-${Date.now()}`, stageId: '', execTaskId: null,
        role: 'USER', content: userMessage, createdAt: new Date(),
      }
      dispatch({ type: 'PUSH_MESSAGE', key: stageKey, msg: fakeMsg })
    }

    let fullText = ''
    await consumeSSE(
      `/api/projects/${project.id}/stages/${stageKey}/run`,
      { userMessage },
      text => { fullText += text; dispatch({ type: 'STREAM_CHUNK', text }) },
      () => {
        dispatch({ type: 'STREAM_DONE' })
        dispatch({ type: 'SET_STATUS', key: stageKey, status: 'WAITING' })
        const fakeMsg: MessageRow = {
          id: `ai-${Date.now()}`, stageId: '', execTaskId: null,
          role: 'ASSISTANT', content: fullText, createdAt: new Date(),
        }
        dispatch({ type: 'PUSH_MESSAGE', key: stageKey, msg: fakeMsg })
      },
      msg => { dispatch({ type: 'SET_ERROR', msg }); dispatch({ type: 'CLEAR_STREAMING' }) }
    )
  }, [project.id])

  // ── Confirm stage ──
  const confirmStage = useCallback(async (stageKey: string) => {
    dispatch({ type: 'SET_STATUS', key: stageKey, status: 'LOCKED' })
    const stageName = STAGE_META[stageKey as keyof typeof STAGE_META]?.name ?? stageKey
    dispatch({ type: 'PUSH_NOTE', key: stageKey, content: `✓ 已锁定 · ${stageName}` })

    const res = await fetch(`/api/projects/${project.id}/stages/${stageKey}/confirm`, { method: 'POST' })
    const data = await res.json()

    if (data.lockedDoc) dispatch({ type: 'LOCK_DOC', doc: data.lockedDoc })

    const next = data.nextAction
    if (next?.type === 'next_stage') {
      // Only auto-start next stage if it hasn't been started yet
      const nextStatus = state.statuses[next.stageKey] ?? 'IDLE'
      if (nextStatus === 'IDLE') {
        setTimeout(() => runStage(next.stageKey), 300)
      }
    } else if (next?.type === 'build_exec_tasks') {
      const tasks: ExecTaskWithMessages[] = next.execTasks.map((t: ExecTask) => ({ ...t, messages: [] }))
      dispatch({ type: 'ADD_EXEC_TASKS', tasks })
      // Auto-start the first IDLE task (works for both first run and re-decompose)
      const firstIdle = tasks.find(t => t.status === 'IDLE')
      if (firstIdle) setTimeout(() => runExecTask(firstIdle.id), 300)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  // ── Run exec task agent ──
  const runExecTask = useCallback(async (taskId: string, userMessage?: string) => {
    const key = `exec-${taskId}`
    dispatch({ type: 'STREAM_START', key })
    dispatch({ type: 'SET_STATUS', key, status: 'RUNNING' })
    dispatch({ type: 'SET_VIEW', key })

    if (userMessage) {
      const fakeMsg: MessageRow = {
        id: `tmp-${Date.now()}`, stageId: null, execTaskId: taskId,
        role: 'USER', content: userMessage, createdAt: new Date(),
      }
      dispatch({ type: 'PUSH_MESSAGE', key, msg: fakeMsg })
    }

    let fullText = ''
    await consumeSSE(
      `/api/exec-tasks/${taskId}/run`,
      { userMessage },
      text => { fullText += text; dispatch({ type: 'STREAM_CHUNK', text }) },
      () => {
        dispatch({ type: 'STREAM_DONE' })
        dispatch({ type: 'SET_STATUS', key, status: 'WAITING' })
        const fakeMsg: MessageRow = {
          id: `ai-${Date.now()}`, stageId: null, execTaskId: taskId,
          role: 'ASSISTANT', content: fullText, createdAt: new Date(),
        }
        dispatch({ type: 'PUSH_MESSAGE', key, msg: fakeMsg })
      },
      msg => { dispatch({ type: 'SET_ERROR', msg }); dispatch({ type: 'CLEAR_STREAMING' }) }
    )
  }, [])

  // ── Confirm exec task ──
  const confirmExecTask = useCallback(async (taskId: string) => {
    const key = `exec-${taskId}`
    dispatch({ type: 'SET_STATUS', key, status: 'LOCKED' })
    const taskName = execTasksRef.current.find(t => t.id === taskId)?.name ?? '任务'
    dispatch({ type: 'PUSH_NOTE', key, content: `✓ 已锁定 · ${taskName}` })

    const res = await fetch(`/api/exec-tasks/${taskId}/confirm`, { method: 'POST' })
    const data = await res.json()

    if (data.lockedDoc) dispatch({ type: 'LOCK_DOC', doc: data.lockedDoc })

    const next = data.nextAction
    if (next?.type === 'next_exec_task') {
      const nextTaskName = execTasksRef.current.find(t => t.id === next.execTaskId)?.name ?? '下一任务'
      dispatch({ type: 'PUSH_NOTE', key, content: `─── 移交至：${nextTaskName} ───` })
      setTimeout(() => runExecTask(next.execTaskId), 300)
    } else if (next?.type === 'start_monitor') {
      dispatch({ type: 'PUSH_NOTE', key, content: '─── 所有任务完成，进入监控阶段 ───' })
      setTimeout(() => runStage('monitor'), 300)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Send user message ──
  function sendMessage(text: string) {
    if (!text.trim()) return
    setRevisionMode(false)
    const key = state.viewingKey
    if (key.startsWith('exec-')) {
      const taskId = key.replace('exec-', '')
      runExecTask(taskId, text)
    } else {
      runStage(key, text)
    }
  }

  // ── Derive current agent metadata ──
  const viewKey = state.viewingKey
  const isExec = viewKey.startsWith('exec-')
  const currentTask = isExec ? state.execTasks.find(t => `exec-${t.id}` === viewKey) : null
  const currentStageMeta = !isExec ? STAGE_META[viewKey as keyof typeof STAGE_META] : null

  const agentNum = isExec ? String((state.execTasks.findIndex(t => `exec-${t.id}` === viewKey)) + 4).padStart(2, '0') : currentStageMeta?.num ?? '?'
  const agentName = isExec ? `执行 · ${currentTask?.name ?? ''}` : currentStageMeta?.name ?? ''
  const agentColor = isExec ? EXEC_AGENT_COLOR : (currentStageMeta?.color ?? '#888')
  const agentDesc = isExec ? `产出：${currentTask?.outputDesc ?? ''}` : currentStageMeta?.desc ?? ''

  const viewMessages = state.conversations[viewKey] ?? []
  const viewStatus = state.statuses[viewKey] ?? 'IDLE'
  const isStreaming = state.streamingKey === viewKey
  const isWaiting = viewStatus === 'WAITING' && !isStreaming

  const STAGE_KEYS = ['calibrate', 'boundary', 'decompose', 'monitor'] as const

  // Mind map stale detection: any locked doc updated after last generation
  const latestDocUpdate = state.lockedDocs.reduce<Date | null>((max, d) => {
    const t = new Date(d.updatedAt)
    return !max || t > max ? t : max
  }, null)

  return (
    <div className="h-screen flex flex-col font-serif overflow-hidden" style={{ background: 'var(--p-bg)', color: 'var(--p-text)' }}>
      {/* Top bar */}
      <div
        className="h-13 flex items-center gap-4 px-6 shrink-0"
        style={{ borderBottom: '1px solid var(--p-border)', background: 'var(--p-surface)', height: '52px' }}
      >
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-1 font-mono text-xs cursor-pointer"
          style={{ color: 'var(--p-text-dim)' }}
        >
          <ArrowLeft size={11} /> 返回
        </button>
        <div className="w-px h-4" style={{ background: 'var(--p-border2)' }} />
        <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--p-accent)' }}>AI · PROJECT</div>
        <div className="w-px h-4" style={{ background: 'var(--p-border2)' }} />
        <div className="text-sm flex-1 truncate" style={{ color: 'var(--p-text-mid)' }}>{project.title}</div>
        <MindMapButton projectId={project.id} latestDocUpdate={latestDocUpdate} />
        <div className="w-px h-4" style={{ background: 'var(--p-border2)' }} />
        <a
          href={`/api/projects/${project.id}/export`}
          download
          className="flex items-center gap-1.5 font-mono text-xs cursor-pointer"
          style={{ color: 'var(--p-text-dim)' }}
        >
          <Download size={11} /> 导出 MD
        </a>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Pipeline sidebar */}
        <div
          className="w-52 flex flex-col shrink-0 overflow-y-auto"
          style={{ borderRight: '1px solid var(--p-border)', background: 'var(--p-surface)' }}
        >
          {/* Fixed stages */}
          <div className="p-4" style={{ borderBottom: '1px solid var(--p-border)' }}>
            <div className="font-mono text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--p-text-dim)', fontSize: '9px' }}>
              规划流程
            </div>
            {STAGE_KEYS.map(key => {
              const meta = STAGE_META[key]
              const status = state.statuses[key] ?? 'IDLE'
              const isActive = viewKey === key
              const isLocked = status === 'LOCKED'
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 px-2 py-1.5 mb-0.5 group"
                  style={{ borderRadius: '2px', background: isActive ? 'var(--p-surface3)' : 'transparent' }}
                >
                  <div
                    className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
                    onClick={() => dispatch({ type: 'SET_VIEW', key })}
                  >
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color }} />
                    <div className="text-xs flex-1 truncate" style={{ color: isActive ? 'var(--p-text)' : 'var(--p-text-mid)', fontSize: '11px' }}>
                      {meta.name}
                    </div>
                  </div>
                  {isLocked && state.knowledgeEntries.length > 0 && (
                    <button
                      onClick={() => recalibrateStage(key)}
                      className="opacity-0 group-hover:opacity-100 cursor-pointer font-mono shrink-0"
                      style={{ color: 'var(--p-accent)', fontSize: '8px' }}
                      title="根据知识库重新校准"
                    >
                      重校
                    </button>
                  )}
                  <StatusBadge status={status} />
                </div>
              )
            })}
          </div>

          {/* Exec tasks */}
          {state.execTasks.length > 0 && (
            <div className="p-4">
              <div className="font-mono text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--p-text-dim)', fontSize: '9px' }}>
                执行任务
              </div>
              {state.execTasks.map(t => {
                const key = `exec-${t.id}`
                const status = state.statuses[key] ?? 'IDLE'
                const isActive = viewKey === key
                const markerConfig: Record<string, { label: string; color: string }> = {
                  NEW:          { label: '新增', color: 'var(--p-accent2)' },
                  ADJUSTED:     { label: '已调整', color: 'var(--p-accent)' },
                  NEEDS_RERUN:  { label: '待重跑', color: '#e07070' },
                }
                const markerInfo = t.marker ? markerConfig[t.marker] : null
                return (
                  <div
                    key={t.id}
                    onClick={() => dispatch({ type: 'SET_VIEW', key })}
                    className="flex items-center gap-2 px-2 py-1.5 cursor-pointer mb-0.5 pl-4"
                    style={{ borderRadius: '2px', background: isActive ? 'var(--p-surface3)' : 'transparent' }}
                  >
                    <div className="w-1 h-1 rounded-full shrink-0" style={{ background: EXEC_AGENT_COLOR }} />
                    <div className="text-xs flex-1 truncate" style={{ color: isActive ? 'var(--p-text)' : 'var(--p-text-mid)', fontSize: '10px' }}>
                      {t.name}
                    </div>
                    {markerInfo && (
                      <span className="font-mono shrink-0 mr-0.5" style={{ fontSize: '8px', color: markerInfo.color }}>
                        {markerInfo.label}
                      </span>
                    )}
                    <StatusBadge status={status} />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Workspace */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Agent header */}
          <div
            className="flex items-center gap-3 px-6 py-3 shrink-0"
            style={{ borderBottom: '1px solid var(--p-border)', background: 'var(--p-surface)' }}
          >
            <span className="font-mono text-xs" style={{ color: 'var(--p-text-dim)', width: '24px' }}>{agentNum}</span>
            <span className="text-sm" style={{ color: agentColor }}>{agentName}</span>
            <span className="font-mono text-xs ml-auto" style={{ color: 'var(--p-text-dim)', fontSize: '10px' }}>{agentDesc}</span>
          </div>

          {/* Dialog area */}
          <div ref={dialogRef} className="flex-1 overflow-y-auto p-6 flex flex-col gap-4" style={{ scrollbarWidth: 'thin' }}>
            {viewMessages.map((msg, i) => (
              <MessageBubble key={msg.id ?? i} msg={msg} agentNum={agentNum} agentColor={agentColor} />
            ))}

            {/* Streaming */}
            {isStreaming && (
              <div className="flex gap-2.5">
                <div
                  className="w-6 h-6 rounded flex items-center justify-center font-mono shrink-0 mt-0.5"
                  style={{ background: `${agentColor}18`, border: `1px solid ${agentColor}30`, fontSize: '9px' }}
                >
                  <span style={{ color: agentColor }}>{agentNum}</span>
                </div>
                <div className="flex-1">
                  <div className="font-mono mb-1" style={{ color: 'var(--p-text-dim)', fontSize: '9px' }}>
                    <span style={{ color: agentColor }}>{agentName}</span>
                    {' · '}流式输出中
                  </div>
                  {state.streamingText ? (
                    <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--p-text)' }}>
                      {state.streamingText}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-1">
                      <div className="flex gap-1">
                        {[0, 1, 2].map(i => (
                          <div key={i} className="w-1 h-1 rounded-full thinking-dot" style={{ background: agentColor }} />
                        ))}
                      </div>
                      <span className="font-mono" style={{ color: 'var(--p-text-dim)', fontSize: '9px' }}>{agentName} 分析中...</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error */}
            {state.error && (
              <div className="flex items-center gap-3 py-2">
                <span className="font-mono text-xs" style={{ color: 'var(--p-error)' }}>⚠ {state.error}</span>
                <button
                  className="font-mono text-xs px-3 py-1 border cursor-pointer"
                  style={{ borderColor: 'var(--p-accent)', color: 'var(--p-accent)', borderRadius: '2px' }}
                  onClick={() => {
                    dispatch({ type: 'SET_ERROR', msg: null })
                    if (viewKey.startsWith('exec-')) {
                      runExecTask(viewKey.replace('exec-', ''))
                    } else {
                      runStage(viewKey)
                    }
                  }}
                >
                  重试
                </button>
              </div>
            )}

            {/* Action buttons */}
            {isWaiting && !state.streamingKey && !revisionMode && (
              <div className="flex gap-2 py-1">
                <button
                  className="font-mono text-xs px-4 py-1.5 border cursor-pointer transition-colors"
                  style={{ borderColor: 'var(--p-success)', color: 'var(--p-success)', borderRadius: '2px' }}
                  onClick={() => {
                    if (viewKey.startsWith('exec-')) {
                      confirmExecTask(viewKey.replace('exec-', ''))
                    } else {
                      confirmStage(viewKey)
                    }
                  }}
                >
                  ✓ 确认
                </button>
                <button
                  className="font-mono text-xs px-4 py-1.5 border cursor-pointer"
                  style={{ borderColor: 'var(--p-accent)', color: 'var(--p-accent)', borderRadius: '2px' }}
                  onClick={() => {
                    setRevisionMode(true)
                    setTimeout(() => inputRef.current?.focus(), 50)
                  }}
                >
                  需要调整
                </button>
              </div>
            )}
          </div>

          {/* Input bar */}
          <div
            className="flex gap-2 items-end px-6 py-3 shrink-0"
            style={{
              borderTop: `1px solid ${revisionMode ? 'var(--p-accent)' : 'var(--p-border)'}`,
              background: 'var(--p-surface)',
              transition: 'border-color 0.15s',
            }}
          >
            <div className="flex-1">
              <div className="font-mono mb-1.5 flex items-center gap-2" style={{ color: revisionMode ? 'var(--p-accent)' : 'var(--p-text-dim)', fontSize: '9px' }}>
                {revisionMode ? '✎ 输入修改意见，按 Enter 发送' : isWaiting ? '输入反馈，或点击确认 →' : '输入补充说明...'}
                {revisionMode && (
                  <button onClick={() => setRevisionMode(false)} style={{ color: 'var(--p-text-dim)', cursor: 'pointer' }}>取消</button>
                )}
              </div>
              <textarea
                ref={inputRef}
                rows={1}
                placeholder={revisionMode ? '告诉 AI 哪里需要修改...' : '输入内容...'}
                className="w-full text-sm leading-relaxed resize-none outline-none px-3 py-2"
                style={{
                  background: 'var(--p-surface2)',
                  border: `1px solid ${revisionMode ? 'var(--p-accent)' : 'var(--p-border2)'}`,
                  color: 'var(--p-text)', borderRadius: '2px', fontFamily: 'var(--font-serif)',
                  minHeight: '40px', maxHeight: '100px', transition: 'border-color 0.15s',
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    const val = e.currentTarget.value.trim()
                    if (val) { sendMessage(val); e.currentTarget.value = '' }
                  }
                  e.currentTarget.style.height = 'auto'
                  e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 100) + 'px'
                }}
              />
            </div>
            <button
              className="font-mono text-xs px-4 py-2 border cursor-pointer mb-0.5"
              style={{ borderColor: 'var(--p-accent)', color: 'var(--p-accent)', borderRadius: '2px' }}
              onClick={() => {
                const ta = inputRef.current
                if (ta && ta.value.trim()) { sendMessage(ta.value.trim()); ta.value = '' }
              }}
            >
              发送
            </button>
          </div>
        </div>

        {/* Right panel */}
        <div
          className="w-72 flex flex-col shrink-0 overflow-hidden"
          style={{ borderLeft: '1px solid var(--p-border)', background: 'var(--p-surface)' }}
        >
          {/* Tab bar */}
          <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--p-border)' }}>
            {(['docs', 'knowledge'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 font-mono cursor-pointer"
                style={{
                  fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase',
                  color: rightTab === tab ? 'var(--p-accent)' : 'var(--p-text-dim)',
                  borderBottom: rightTab === tab ? '1px solid var(--p-accent)' : '1px solid transparent',
                  marginBottom: '-1px',
                  background: 'transparent',
                }}
              >
                {tab === 'docs' ? <><BookOpen size={9} />文档 ({state.lockedDocs.length})</> : <><BookOpen size={9} />知识库 ({state.knowledgeEntries.length})</>}
              </button>
            ))}
          </div>

          {/* Docs tab */}
          {rightTab === 'docs' && (
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {state.lockedDocs.length === 0 ? (
                <div className="p-8 text-center font-mono leading-relaxed" style={{ color: 'var(--p-text-dim)', fontSize: '10px' }}>
                  确认每步输出后<br />文档将在这里汇总
                </div>
              ) : (
                state.lockedDocs.map(doc => <DocItem key={doc.id} doc={doc} />)
              )}
            </div>
          )}

          {/* Knowledge tab */}
          {rightTab === 'knowledge' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Actions */}
              <div className="flex gap-2 px-3 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--p-border)' }}>
                <button
                  onClick={() => { setAddingNote(v => !v); setKnowledgeTitle(''); setKnowledgeInput('') }}
                  className="flex items-center gap-1 font-mono text-xs px-2.5 py-1 border cursor-pointer"
                  style={{ borderColor: 'var(--p-accent)', color: 'var(--p-accent)', borderRadius: '2px', fontSize: '9px' }}
                >
                  <Plus size={9} /> 添加笔记
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  className="flex items-center gap-1 font-mono text-xs px-2.5 py-1 border cursor-pointer"
                  style={{ borderColor: 'var(--p-border2)', color: 'var(--p-text-dim)', borderRadius: '2px', fontSize: '9px' }}
                >
                  <Upload size={9} /> {uploadingFile ? '上传中...' : '上传文件'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) { uploadKnowledgeFile(f); e.target.value = '' } }}
                />
              </div>

              {/* Add note form */}
              {addingNote && (
                <div className="px-3 py-2.5 flex flex-col gap-2 shrink-0" style={{ borderBottom: '1px solid var(--p-border)', background: 'var(--p-surface2)' }}>
                  <input
                    autoFocus
                    placeholder="标题（如：3月14日会议记录）"
                    value={knowledgeTitle}
                    onChange={e => setKnowledgeTitle(e.target.value)}
                    className="w-full text-xs px-2 py-1.5 outline-none"
                    style={{ background: 'var(--p-surface)', border: '1px solid var(--p-border2)', color: 'var(--p-text)', borderRadius: '2px', fontFamily: 'var(--font-serif)' }}
                  />
                  <textarea
                    placeholder="粘贴会议记录、想法或任何补充内容..."
                    value={knowledgeInput}
                    onChange={e => setKnowledgeInput(e.target.value)}
                    rows={4}
                    className="w-full text-xs px-2 py-1.5 outline-none resize-none"
                    style={{ background: 'var(--p-surface)', border: '1px solid var(--p-border2)', color: 'var(--p-text)', borderRadius: '2px', fontFamily: 'var(--font-serif)' }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={addKnowledgeNote}
                      disabled={savingNote || !knowledgeTitle.trim() || !knowledgeInput.trim()}
                      className="font-mono text-xs px-3 py-1 border cursor-pointer"
                      style={{ borderColor: 'var(--p-accent)', color: 'var(--p-accent)', borderRadius: '2px', fontSize: '9px' }}
                    >
                      {savingNote ? '保存中...' : '保存'}
                    </button>
                    <button onClick={() => setAddingNote(false)} className="font-mono text-xs px-2 py-1 cursor-pointer" style={{ color: 'var(--p-text-dim)', fontSize: '9px' }}>取消</button>
                  </div>
                </div>
              )}

              {/* Entry list */}
              <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                {state.knowledgeEntries.length === 0 ? (
                  <div className="p-8 text-center font-mono leading-relaxed" style={{ color: 'var(--p-text-dim)', fontSize: '10px' }}>
                    上传文件或添加笔记<br />作为项目知识库
                  </div>
                ) : (
                  state.knowledgeEntries.map(entry => (
                    <KnowledgeItem key={entry.id} entry={entry} onDelete={() => deleteKnowledge(entry.id)} />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating concierge button */}
      <button
        onClick={() => setConciergeOpen(v => !v)}
        className="fixed bottom-6 right-6 w-12 h-12 rounded-full flex items-center justify-center cursor-pointer shadow-lg"
        style={{ background: 'var(--p-accent)', color: 'var(--p-bg)', zIndex: 50 }}
        title="AI 小客服"
      >
        {conciergeOpen ? <X size={18} /> : <MessageCircle size={18} />}
      </button>

      {/* Concierge chat window */}
      {conciergeOpen && (
        <div
          className="fixed bottom-22 right-6 w-80 flex flex-col rounded shadow-xl overflow-hidden"
          style={{ height: '460px', background: 'var(--p-surface)', border: '1px solid var(--p-border)', zIndex: 50 }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--p-border)', background: 'var(--p-surface2)' }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--p-accent)' }} />
            <span className="font-mono text-xs" style={{ color: 'var(--p-accent)', letterSpacing: '0.1em' }}>AI 小客服</span>
            <span className="font-mono ml-auto" style={{ color: 'var(--p-text-dim)', fontSize: '9px' }}>{project.title}</span>
          </div>

          {/* Messages */}
          <div ref={conciergeDialogRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3" style={{ scrollbarWidth: 'thin' }}>
            {conciergeMessages.length === 0 && !conciergeStreaming && (
              <div className="text-center font-mono py-8" style={{ color: 'var(--p-text-dim)', fontSize: '10px', lineHeight: '1.8' }}>
                你好！我是这个项目的 AI 助手。<br />可以问我项目目标、进展或任何问题。
              </div>
            )}
            {conciergeMessages.map((msg, i) => (
              <div key={msg.id ?? i} className={`flex gap-2 ${msg.role === 'USER' ? 'flex-row-reverse' : ''}`}>
                <div
                  className="w-5 h-5 rounded flex items-center justify-center font-mono shrink-0 mt-0.5"
                  style={{
                    background: msg.role === 'ASSISTANT' ? 'rgba(200,169,110,0.15)' : 'var(--p-surface3)',
                    border: `1px solid ${msg.role === 'ASSISTANT' ? 'rgba(200,169,110,0.3)' : 'var(--p-border2)'}`,
                    fontSize: '8px',
                    color: msg.role === 'ASSISTANT' ? 'var(--p-accent)' : 'var(--p-text-dim)',
                  }}
                >
                  {msg.role === 'ASSISTANT' ? 'AI' : '你'}
                </div>
                <div
                  className="text-xs leading-relaxed whitespace-pre-wrap break-words max-w-[220px] px-2.5 py-2 rounded"
                  style={{
                    background: msg.role === 'ASSISTANT' ? 'var(--p-surface2)' : 'rgba(200,169,110,0.08)',
                    color: 'var(--p-text)',
                    border: '1px solid var(--p-border)',
                    fontSize: '11px',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {conciergeStreaming && (
              <div className="flex gap-2">
                <div className="w-5 h-5 rounded flex items-center justify-center font-mono shrink-0" style={{ background: 'rgba(200,169,110,0.15)', border: '1px solid rgba(200,169,110,0.3)', fontSize: '8px', color: 'var(--p-accent)' }}>AI</div>
                <div className="text-xs leading-relaxed whitespace-pre-wrap break-words max-w-[220px] px-2.5 py-2 rounded" style={{ background: 'var(--p-surface2)', color: 'var(--p-text)', border: '1px solid var(--p-border)', fontSize: '11px' }}>
                  {conciergeText || <span style={{ color: 'var(--p-text-dim)' }}>思考中...</span>}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex gap-2 p-3 shrink-0" style={{ borderTop: '1px solid var(--p-border)' }}>
            <textarea
              ref={conciergeInputRef}
              rows={1}
              placeholder="问我任何关于项目的问题..."
              disabled={conciergeStreaming}
              className="flex-1 text-xs px-2 py-1.5 outline-none resize-none"
              style={{
                background: 'var(--p-surface2)', border: '1px solid var(--p-border2)',
                color: 'var(--p-text)', borderRadius: '2px', fontFamily: 'var(--font-serif)',
                minHeight: '32px', maxHeight: '80px', fontSize: '11px',
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  const val = e.currentTarget.value.trim()
                  if (val) { sendConcierge(val); e.currentTarget.value = '' }
                }
              }}
            />
            <button
              onClick={() => {
                const ta = conciergeInputRef.current
                if (ta && ta.value.trim()) { sendConcierge(ta.value.trim()); ta.value = '' }
              }}
              disabled={conciergeStreaming}
              className="flex items-center justify-center w-8 h-8 rounded cursor-pointer shrink-0 self-end"
              style={{ background: 'var(--p-accent)', color: 'var(--p-bg)' }}
            >
              <Send size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    IDLE:    { label: '待机', color: 'var(--p-text-dim)', bg: 'transparent' },
    RUNNING: { label: '运行', color: 'var(--p-accent)',   bg: 'rgba(200,169,110,0.1)' },
    WAITING: { label: '等待', color: 'var(--p-accent2)',  bg: 'rgba(126,184,200,0.1)' },
    LOCKED:  { label: '已锁定', color: 'var(--p-success)', bg: 'rgba(110,200,138,0.08)' },
  }
  const s = map[status] ?? map.IDLE
  return (
    <span
      className="font-mono shrink-0"
      style={{ color: s.color, background: s.bg, padding: '1px 5px', borderRadius: '1px', fontSize: '8px' }}
    >
      {s.label}
    </span>
  )
}

function MessageBubble({ msg, agentNum, agentColor }: { msg: DisplayMessage; agentNum: string; agentColor: string }) {
  if (msg.role === 'NOTE') {
    const isLock = msg.content.startsWith('✓')
    return (
      <div className="flex items-center gap-3 py-1">
        <div className="flex-1 h-px" style={{ background: 'var(--p-border)' }} />
        <span
          className="font-mono shrink-0"
          style={{
            fontSize: '9px',
            color: isLock ? 'var(--p-success)' : 'var(--p-text-dim)',
            letterSpacing: '0.05em',
          }}
        >
          {msg.content}
        </span>
        <div className="flex-1 h-px" style={{ background: 'var(--p-border)' }} />
      </div>
    )
  }

  const isAI = msg.role === 'ASSISTANT'
  return (
    <div className="flex gap-2.5">
      <div
        className="w-6 h-6 rounded flex items-center justify-center font-mono shrink-0 mt-0.5"
        style={{
          background: isAI ? `${agentColor}18` : 'var(--p-surface3)',
          border: `1px solid ${isAI ? agentColor + '30' : 'var(--p-border2)'}`,
          fontSize: '9px',
        }}
      >
        <span style={{ color: isAI ? agentColor : 'var(--p-text-dim)' }}>
          {isAI ? agentNum : '你'}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-mono mb-1.5" style={{ color: 'var(--p-text-dim)', fontSize: '9px' }}>
          <span style={{ color: isAI ? agentColor : 'var(--p-text-dim)' }}>
            {isAI ? `Agent ${agentNum}` : '你'}
          </span>
        </div>
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--p-text)' }}>
          {msg.content}
        </div>
      </div>
    </div>
  )
}

function KnowledgeItem({ entry, onDelete }: { entry: KnowledgeEntry; onDelete: () => void }) {
  return (
    <div style={{ borderBottom: '1px solid var(--p-border)' }}>
      <details>
        <summary className="flex items-center gap-2 px-3 py-2.5 cursor-pointer list-none group">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: entry.type === 'FILE' ? 'var(--p-accent2)' : 'var(--p-accent)' }} />
          <div className="text-xs flex-1 truncate" style={{ color: 'var(--p-text-mid)', fontSize: '11px' }}>{entry.title}</div>
          <span className="font-mono shrink-0 mr-1" style={{ color: 'var(--p-text-dim)', fontSize: '8px' }}>
            {entry.type === 'FILE' ? '文件' : '笔记'}
          </span>
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete() }}
            className="shrink-0 opacity-0 group-hover:opacity-100 cursor-pointer"
            style={{ color: 'var(--p-error)' }}
          >
            <Trash2 size={10} />
          </button>
        </summary>
        <div className="px-3 pb-3 text-xs leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--p-text-dim)', fontSize: '10px', maxHeight: '200px', overflowY: 'auto' }}>
          {entry.content.slice(0, 600)}{entry.content.length > 600 ? '...' : ''}
        </div>
      </details>
    </div>
  )
}

function DocItem({ doc }: { doc: LockedDocument }) {
  function exportDoc() {
    const clean = doc.content.replace(/===任务清单===[\s\S]*?===END===/g, '').trim()
    const md = `# ${doc.title}\n\n${clean}`
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${doc.title}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ borderBottom: '1px solid var(--p-border)' }}>
      <details>
        <summary
          className="flex items-center gap-2 px-4 py-3 cursor-pointer list-none group"
          style={{ background: 'transparent' }}
        >
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: doc.color }} />
          <div className="text-xs flex-1 truncate" style={{ color: 'var(--p-text-mid)', fontSize: '11px' }}>{doc.title}</div>
          {doc.version > 1 && (
            <span className="font-mono shrink-0 mr-0.5" style={{ color: 'var(--p-accent)', fontSize: '8px' }}>v{doc.version}</span>
          )}
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); exportDoc() }}
            className="shrink-0 opacity-0 group-hover:opacity-100 cursor-pointer mr-1.5"
            style={{ color: 'var(--p-text-dim)' }}
            title="导出此文档"
          >
            <Download size={10} />
          </button>
          <span className="font-mono shrink-0" style={{ color: 'var(--p-success)', background: 'rgba(110,200,138,0.08)', padding: '1px 5px', borderRadius: '1px', fontSize: '8px' }}>
            已锁定
          </span>
        </summary>
        <div
          className="px-4 pb-3 text-xs leading-relaxed whitespace-pre-wrap break-words"
          style={{ color: 'var(--p-text-dim)', fontSize: '11px' }}
        >
          {doc.content.replace(/===任务清单===[\s\S]*?===END===/g, '').trim()}
        </div>
      </details>
    </div>
  )
}
