import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'

const STEPS = [
  { num: '01', label: '校准', color: '#c8a96e' },
  { num: '02', label: '边界', color: '#7eb8c8' },
  { num: '03', label: '拆解', color: '#b87ec8' },
  { num: '04', label: '执行', color: '#7eb8c8' },
  { num: '05', label: '监控', color: '#7ec8a0' },
]

export default async function Home() {
  const session = await getServerSession(authOptions)
  if (session) redirect('/dashboard')

  return (
    <div
      className="min-h-screen font-serif"
      style={{ background: 'var(--p-bg)', color: 'var(--p-text)' }}
    >
      {/* Nav */}
      <nav
        className="h-14 flex items-center px-8 gap-4"
        style={{ borderBottom: '1px solid var(--p-border)', background: 'var(--p-surface)' }}
      >
        <span className="font-mono text-xs tracking-widest" style={{ color: 'var(--p-accent)' }}>
          AI · PROJECT
        </span>
        <div className="w-px h-4 mx-2" style={{ background: 'var(--p-border2)' }} />
        <span className="text-sm flex-1" style={{ color: 'var(--p-text-mid)' }}>Planner</span>
        <Link href="/login">
          <button
            className="font-mono text-xs tracking-widest px-5 py-2 border cursor-pointer transition-colors"
            style={{
              borderColor: 'var(--p-accent)',
              color: 'var(--p-accent)',
              borderRadius: '2px',
              background: 'transparent',
            }}
          >
            开始使用
          </button>
        </Link>
      </nav>

      {/* Hero */}
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] gap-10 px-8 text-center">
        <div className="text-4xl sm:text-5xl font-light leading-tight tracking-wide">
          将项目<span style={{ color: 'var(--p-accent)' }}>全权交给 AI</span><br />
          你只需要验收
        </div>

        <div className="font-mono text-xs leading-relaxed max-w-md" style={{ color: 'var(--p-text-mid)' }}>
          输入项目描述，AI 自动完成需求校准、目标边界定义、任务拆解与逐一执行。<br />
          每步确认后内容锁定，最终生成完整规划文档集。
        </div>

        {/* Flow */}
        <div className="flex items-center gap-0">
          {STEPS.map((s, i) => (
            <div key={s.num} className="flex items-center">
              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full border flex items-center justify-center font-mono text-xs"
                  style={{ borderColor: s.color, color: s.color }}
                >
                  {s.num}
                </div>
                <span className="font-mono text-xs" style={{ color: 'var(--p-text-dim)' }}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="w-8 h-px mb-5" style={{ background: 'var(--p-border2)' }} />
              )}
            </div>
          ))}
        </div>

        <Link href="/login">
          <button
            className="font-mono text-xs tracking-widest px-8 py-3 border cursor-pointer transition-all"
            style={{
              borderColor: 'var(--p-accent)',
              color: 'var(--p-accent)',
              borderRadius: '2px',
              background: 'transparent',
            }}
          >
            用 GitHub 账号免费开始 →
          </button>
        </Link>
      </div>
    </div>
  )
}
