'use client'

import { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'navy' | 'destructive'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  loading?: boolean
}

const variantStyles: Record<ButtonVariant, { cls: string; style?: CSSProperties }> = {
  primary: {
    cls: 'text-white font-semibold hover:brightness-110 active:scale-[0.97] disabled:opacity-40',
    style: {
      background: 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)',
      boxShadow: '0 4px 14px rgba(18,103,242,0.38), inset 0 1px 0 rgba(255,255,255,0.22)',
    },
  },
  secondary: {
    cls: 'font-semibold hover:bg-[#f1f6ff] active:scale-[0.97] disabled:opacity-40',
    style: {
      color: '#1267f2',
      background: 'rgba(18,103,242,0.08)',
      border: '1px solid rgba(18,103,242,0.22)',
      boxShadow: '0 1px 2px rgba(18,103,242,0.06)',
    },
  },
  ghost: {
    cls: 'text-[#10213f] font-semibold hover:bg-white/80 active:scale-[0.97] disabled:opacity-40',
    style: {
      background: 'rgba(255,255,255,0.60)',
      border: '1px solid rgba(20,44,92,0.13)',
      boxShadow: '0 1px 3px rgba(20,44,92,0.07)',
    },
  },
  navy: {
    cls: 'text-white font-semibold hover:brightness-110 active:scale-[0.97] disabled:opacity-40',
    style: {
      background: 'linear-gradient(135deg, #0a3fae 0%, #1267f2 100%)',
      boxShadow: '0 4px 12px rgba(10,63,174,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
    },
  },
  destructive: {
    cls: 'text-white font-semibold hover:brightness-110 active:scale-[0.97] disabled:opacity-40',
    style: {
      background: '#e53e4f',
      boxShadow: '0 4px 12px rgba(229,62,79,0.30)',
    },
  },
}

const sizeStyles: Record<string, string> = {
  sm: 'min-h-[36px] px-3 py-1.5 text-sm rounded-[9px] gap-1.5',
  md: 'min-h-[44px] px-4 py-2 text-sm rounded-[11px] gap-2',
  lg: 'min-h-[48px] px-6 py-3 text-[15px] rounded-[12px] gap-2',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  children,
  loading = false,
  disabled,
  className = '',
  style,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading
  const { cls, style: varStyle } = variantStyles[variant]

  return (
    <button
      {...props}
      disabled={isDisabled}
      style={{ ...varStyle, ...style }}
      className={`
        inline-flex items-center justify-center
        transition-all duration-[130ms] ease-out
        cursor-pointer select-none
        ${cls}
        ${sizeStyles[size]}
        ${isDisabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
        ${className}
      `}
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4 shrink-0"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  )
}
