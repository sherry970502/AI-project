'use client'

import { signIn } from 'next-auth/react'
import { Github } from 'lucide-react'

export default function LoginPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center font-serif"
      style={{ background: 'var(--p-bg)', color: 'var(--p-text)' }}
    >
      <div
        className="w-full max-w-sm p-10 flex flex-col items-center gap-8"
        style={{ border: '1px solid var(--p-border)', background: 'var(--p-surface)', borderRadius: '4px' }}
      >
        <div className="text-center">
          <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--p-accent)' }}>
            AI · PROJECT
          </div>
          <div className="text-xl font-light" style={{ color: 'var(--p-text)' }}>登录</div>
        </div>

        <button
          onClick={() => signIn('github', { callbackUrl: '/dashboard' })}
          className="w-full flex items-center justify-center gap-3 py-3 font-mono text-xs tracking-wider border cursor-pointer transition-all"
          style={{
            borderColor: 'var(--p-border2)',
            color: 'var(--p-text-mid)',
            background: 'transparent',
            borderRadius: '2px',
          }}
        >
          <Github size={15} />
          用 GitHub 账号登录
        </button>

        <p className="text-center font-mono text-xs" style={{ color: 'var(--p-text-dim)' }}>
          登录即可开始使用
        </p>
      </div>
    </div>
  )
}
