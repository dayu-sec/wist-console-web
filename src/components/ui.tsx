import type { ReactNode } from 'react'

export type BadgeTone = 'green' | 'amber' | 'red' | 'gray' | 'blue'

export function Badge({ tone = 'gray', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

export function PageShell({
  title,
  summary,
  actions,
  children,
}: {
  title: string
  summary: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="page-header__row">
          <div>
            <h1 className="page-title">{title}</h1>
            <p className="page-summary">{summary}</p>
          </div>
          {actions ? <div className="page-actions">{actions}</div> : null}
        </div>
      </header>
      <main className="page-main">{children}</main>
    </div>
  )
}

/** 内容块：与 page-header 的左右边界对齐。 */
export function Block({ wide, children }: { wide?: boolean; children: ReactNode }) {
  return <section className={wide ? 'block' : 'block block--narrow'}>{children}</section>
}

export function Card({
  title,
  subtitle,
  aside,
  children,
  className,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className ? `card ${className}` : 'card'}>
      {title || subtitle || aside ? (
        <header className="card__header">
          <div>
            {title ? <h2 className="card__title">{title}</h2> : null}
            {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
          </div>
          {aside ? <div className="card__aside">{aside}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}

export function Empty({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="empty">
      <strong className="empty__title">{title}</strong>
      {hint ? <p className="empty__hint">{hint}</p> : null}
    </div>
  )
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="banner banner--crit" role="alert">
      {children}
    </div>
  )
}

export function InfoBanner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn'
  children: ReactNode
}) {
  return <div className={`banner banner--${tone}`}>{children}</div>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="field__value">{children}</div>
    </div>
  )
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <code className="mono" title={title}>
      {children}
    </code>
  )
}
