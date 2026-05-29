import { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  raised?: boolean
}

const paddingStyles = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
}

export default function Card({ children, className = '', padding = 'md', raised = false }: CardProps) {
  return (
    <div
      className={`${raised ? 'nas-card-raised' : 'nas-card'} ${paddingStyles[padding]} ${className}`}
    >
      {children}
    </div>
  )
}
