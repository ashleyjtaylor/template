import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'

interface AuthCardLayoutProps {
  eyebrow: string
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}

export function AuthCardLayout({
  eyebrow,
  title,
  subtitle,
  children,
  footer
}: AuthCardLayoutProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,_var(--foreground)_1px,_transparent_0)] [background-size:24px_24px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-background to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-background to-transparent"
      />

      <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="relative rounded-lg border bg-card shadow-sm">
            <div
              aria-hidden
              className="absolute -top-px right-6 left-6 h-px bg-linear-to-r from-transparent via-foreground/30 to-transparent"
            />

            <div className="px-6 pt-7 pb-6">
              <div className="mb-6">
                <div className="mb-2 text-[10px] font-medium uppercase text-muted-foreground">
                  {eyebrow}
                </div>
                <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
                {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
              </div>

              {children}
            </div>
          </div>

          {footer && <div className="mt-5 text-center text-xs text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </div>
  )
}

interface AuthFieldProps {
  id: string
  label: string
  type: 'email' | 'password' | 'text'
  autoComplete?: string
  autoFocus?: boolean
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function AuthField({
  id,
  label,
  type,
  autoComplete,
  autoFocus,
  value,
  onChange,
  disabled
}: AuthFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  )
}
