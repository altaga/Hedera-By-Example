import React from 'react'

export interface SequenceSpec {
  actors: string[]
  steps: ({ from: string; to: string; label: string } | { actor: string; note: string })[]
}

/**
 * Sequence diagram: one lifeline per actor, one row per message or note.
 * Built with CSS positioning so long labels wrap at any width.
 */
export function SequenceDiagram ({ spec, title }: { spec: SequenceSpec; title: string }) {
  const n = spec.actors.length
  const col = (name: string) => spec.actors.indexOf(name)
  const pct = (x: number) => `${(x / n) * 100}%`
  let msgNo = 0
  return (
    <figure className='seq' style={{ ['--seq-cols' as any]: n }} aria-label={title} data-testid='sequence-diagram'>
      <div className='seq-scroll'>
        <div className='seq-inner'>
          <div className='seq-actors'>
            {spec.actors.map((a) => <div key={a} className='seq-actor'><span>{a}</span></div>)}
          </div>
          <ol className='seq-steps'>
            {spec.actors.map((a, i) => <span key={a} className='seq-lifeline' style={{ left: pct(i + 0.5) }} aria-hidden='true' />)}
            {spec.steps.map((s, i) => {
              if ('note' in s) {
                const c = col(s.actor)
                return (
                  <li key={i} className='seq-row seq-row-note'>
                    <div className='seq-note' style={{ marginLeft: pct(Math.max(c - 0.35, 0)), width: pct(Math.min(1.7, n - Math.max(c - 0.35, 0))) }}>
                      {s.note}
                    </div>
                  </li>
                )
              }
              const a = col(s.from)
              const b = col(s.to)
              const left = Math.min(a, b) + 0.5
              const width = Math.abs(b - a)
              msgNo++
              return (
                <li key={i} className={`seq-row ${b < a ? 'is-back' : ''}`}>
                  <div className='seq-msg' style={{ marginLeft: pct(left), width: pct(width) }}>
                    <span className='seq-label'><span className='seq-no'>{msgNo}</span>{s.label}</span>
                    <span className='seq-arrow' aria-hidden='true' />
                  </div>
                  <span className='sr-only'>{`${s.from} → ${s.to}: ${s.label}`}</span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </figure>
  )
}
