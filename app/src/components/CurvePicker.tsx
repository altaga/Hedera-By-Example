import type { Curve } from '../lib/wallets'

export interface CurveInfo {
  name: string
  badge: string
  pros: string[]
  cons: string[]
}

/**
 * One radio per curve. The whole card, including its title and badge, is the
 * control, so a click on "Ed25519" cannot land on the other card.
 */
export function CurvePicker ({
  curves,
  value,
  onChange,
  label
}: {
  curves: Record<Curve, CurveInfo>
  value: Curve
  onChange: (c: Curve) => void
  label: string
}) {
  return (
    <div className='curve-picker' role='radiogroup' aria-label={label}>
      {(['ECDSA', 'ED25519'] as Curve[]).map((c) => {
        const info = curves[c]
        const selected = value === c
        return (
          <div
            key={c}
            role='radio'
            aria-checked={selected}
            aria-label={`${info.name}, ${info.badge}`}
            tabIndex={0}
            className={`curve-card ${selected ? 'is-selected' : ''}`}
            data-testid={`curve-${c.toLowerCase()}`}
            onClick={() => onChange(c)}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                onChange(c)
              }
            }}
          >
            <span className='curve-head'><strong>{info.name}</strong><span className={`tag ${c === 'ECDSA' ? 'tag-accent' : ''}`}>{info.badge}</span></span>
            <ul className='curve-pros'>{info.pros.map((p) => <li key={p}>{p}</li>)}</ul>
            <ul className='curve-cons'>{info.cons.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )
      })}
    </div>
  )
}
