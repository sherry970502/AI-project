'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Plus, Zap, LogOut } from 'lucide-react'
import type { Project } from '@prisma/client'

const STATUS_LABEL: Record<string, string> = {
  PLANNING: '规划中', EXECUTING: '执行中', MONITORING: '监控中', COMPLETED: '已完成',
}

export function DashboardClient({ projects, user }: { projects: Project[]; user: { name?: string | null; image?: string | null } }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(false)

  async function createProject() {
    if (!desc.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const project = await res.json()
      if (!project.id) throw new Error('No project ID returned')
      // 强制全页跳转，避免 Next.js 路由缓存返回旧项目页
      window.location.href = `/projects/${project.id}`
    } catch (e) {
      console.error('创建项目失败', e)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen font-serif" style={{ background: 'var(--p-bg)', color: 'var(--p-text)' }}>
      {/* Top bar */}
      <nav
        className="h-14 flex items-center px-8 gap-4"
        style={{ borderBottom: '1px solid var(--p-border)', background: 'var(--p-surface)' }}
      >
        <Zap size={14} style={{ color: 'var(--p-accent)' }} />
        <span className="font-mono text-xs tracking-widest" style={{ color: 'var(--p-accent)' }}>AI · PROJECT</span>
        <div className="w-px h-4" style={{ background: 'var(--p-border2)' }} />
        <span className="text-sm flex-1" style={{ color: 'var(--p-text-mid)' }}>我的项目</span>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="flex items-center gap-2 font-mono text-xs cursor-pointer"
          style={{ color: 'var(--p-text-dim)' }}
        >
          <LogOut size={12} /> 退出
        </button>
      </nav>

      <div className="max-w-4xl mx-auto px-8 py-12">
        {/* New project button */}
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 font-mono text-xs tracking-wider px-5 py-2.5 border cursor-pointer transition-all mb-10"
            style={{ borderColor: 'var(--p-accent)', color: 'var(--p-accent)', borderRadius: '2px', background: 'transparent' }}
          >
            <Plus size={12} /> 新建项目
          </button>
        ) : (
          <div
            className="mb-10 p-6 flex flex-col gap-4"
            style={{ border: '1px solid var(--p-border2)', background: 'var(--p-surface)', borderRadius: '4px' }}
          >
            <label className="font-mono text-xs tracking-widest uppercase" style={{ color: 'var(--p-text-dim)' }}>
              描述你的项目
            </label>
            <textarea
              autoFocus
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="例如：我想做一个音乐学院，帮助包子老师成为明星..."
              rows={3}
              className="w-full text-sm leading-relaxed resize-none outline-none p-4"
              style={{
                background: 'var(--p-surface2)', border: '1px solid var(--p-border2)',
                color: 'var(--p-text)', borderRadius: '2px', fontFamily: 'var(--font-serif)',
              }}
              onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) createProject() }}
            />
            <div className="flex gap-3">
              <button
                onClick={createProject}
                disabled={loading || !desc.trim()}
                className="font-mono text-xs tracking-wider px-5 py-2 border cursor-pointer"
                style={{ borderColor: 'var(--p-accent)', color: 'var(--p-accent)', borderRadius: '2px', background: 'transparent' }}
              >
                {loading ? '创建中...' : '开始规划 →'}
              </button>
              <button
                onClick={() => { setCreating(false); setDesc('') }}
                className="font-mono text-xs px-4 py-2 cursor-pointer"
                style={{ color: 'var(--p-text-dim)' }}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Project list */}
        {projects.length === 0 ? (
          <div className="text-center py-20 font-mono text-xs" style={{ color: 'var(--p-text-dim)' }}>
            还没有项目 · 点击新建开始
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {projects.map(p => (
              <div
                key={p.id}
                onClick={() => router.push(`/projects/${p.id}`)}
                className="p-5 cursor-pointer transition-colors flex items-center gap-4"
                style={{
                  border: '1px solid var(--p-border)',
                  background: 'var(--p-surface)',
                  borderRadius: '4px',
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm mb-1 truncate">{p.title}</div>
                  <div className="font-mono text-xs truncate" style={{ color: 'var(--p-text-dim)' }}>
                    {p.description}
                  </div>
                </div>
                <div
                  className="font-mono text-xs px-2 py-0.5 shrink-0"
                  style={{
                    background: 'rgba(200,169,110,0.08)',
                    color: 'var(--p-accent)',
                    borderRadius: '2px',
                  }}
                >
                  {STATUS_LABEL[p.status] ?? p.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
