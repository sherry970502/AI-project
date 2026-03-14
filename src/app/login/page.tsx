'use client'

import { signIn } from 'next-auth/react'
import { Github } from 'lucide-react'

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

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

        <div className="w-full flex flex-col gap-3">
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

          <button
            onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
            className="w-full flex items-center justify-center gap-3 py-3 font-mono text-xs tracking-wider border cursor-pointer transition-all"
            style={{
              borderColor: 'var(--p-border2)',
              color: 'var(--p-text-mid)',
              background: 'transparent',
              borderRadius: '2px',
            }}
          >
            <GoogleIcon />
            用 Google 账号登录
          </button>
        </div>

        <p className="text-center font-mono text-xs" style={{ color: 'var(--p-text-dim)' }}>
          登录即可开始使用
        </p>
      </div>
    </div>
  )
}
