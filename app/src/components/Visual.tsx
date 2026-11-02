import React from 'react'

export interface VisualSpec { type: string; title?: string; [key: string]: any }

const fmtNum = (v: number, unit?: string) =>
  `${Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`

/** Every chart ships a table view (identity never relies on color alone). */
function TableView ({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <details className='viz-table'>
      <summary>Table</summary>
      <div className='out-table-wrap'>
        <table className='out-table'>
          <thead><tr>{columns.map((c) => <th key={c} scope='col'>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{typeof v === 'number' ? fmtNum(v) : v}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  )
}

function Frame ({ title, children, legend }: { title?: string; children: React.ReactNode; legend?: { name: string; slot: number }[] }) {
  return (
    <figure className='viz' data-testid='visual'>
      {(title || legend) && (
        <figcaption className='viz-head'>
          {title && <span className='viz-title'>{title}</span>}
          {legend && (
            <span className='viz-legend'>
              {legend.map((l) => <span key={l.name} className='viz-key'><i className={`sw s${l.slot}`} />{l.name}</span>)}
            </span>
          )}
        </figcaption>
      )}
      {children}
    </figure>
  )
}

// ---------- bars ----------

/** Horizontal bars: label, bar, value. items: [{ label, value, status? }] */
function BarChart ({ spec }: { spec: VisualSpec }) {
  const items: { label: string; value: number; status?: string }[] = spec.items || []
  const max = Math.max(...items.map((i) => i.value), 0) || 1
  return (
    <Frame title={spec.title}>
      <div className='bars'>
        {items.map((it) => (
          <div key={it.label} className='bar-row' title={`${it.label}: ${fmtNum(it.value, spec.unit)}`}>
            <span className='bar-label'>{it.label}</span>
            <span className='bar-track'>
              <span className={`bar-fill ${it.status ? `st-${it.status}` : 's1'}`} style={{ width: `${(it.value / max) * 100}%` }} />
            </span>
            <span className='bar-value'>{fmtNum(it.value, spec.unit)}</span>
          </div>
        ))}
      </div>
      {spec.note && <p className='viz-note'>{spec.note}</p>}
      <TableView columns={[spec.xLabel || 'Item', spec.yLabel || 'Value']} rows={items.map((i) => [i.label, i.value])} />
    </Frame>
  )
}

/** Stacked horizontal bars. categories: [label], series: [{ name, values }] (max 3 series). */
function StackedChart ({ spec }: { spec: VisualSpec }) {
  const cats: string[] = spec.categories || []
  const series: { name: string; values: number[] }[] = (spec.series || []).slice(0, 3)
  const totals = cats.map((_c, i) => series.reduce((s, x) => s + Math.max(0, x.values[i] || 0), 0))
  const max = Math.max(...totals, 0) || 1
  return (
    <Frame title={spec.title} legend={series.map((s, i) => ({ name: s.name, slot: i + 1 }))}>
      <div className='bars'>
        {cats.map((c, i) => (
          <div key={c} className='bar-row'>
            <span className='bar-label'>{c}</span>
            <span className='bar-track bar-stack' style={{ width: `${(totals[i] / max) * 100}%` }}>
              {series.map((s, k) => {
                const v = Math.max(0, s.values[i] || 0)
                return v > 0 && <span key={s.name} className={`bar-seg s${k + 1}`} style={{ flexGrow: v }} title={`${c} · ${s.name}: ${fmtNum(v, spec.unit)}`} />
              })}
            </span>
            <span className='bar-value'>{fmtNum(totals[i], spec.unit)}</span>
          </div>
        ))}
      </div>
      <TableView columns={[spec.xLabel || 'Item', ...series.map((s) => s.name), 'Total']} rows={cats.map((c, i) => [c, ...series.map((s) => s.values[i] || 0), totals[i]])} />
    </Frame>
  )
}

// ---------- line ----------

/** points: [{ x, y, status?, label? }], threshold?: { value, label } */
function LineChart ({ spec }: { spec: VisualSpec }) {
  const pts: { x: string | number; y: number; status?: string; label?: string }[] = spec.points || []
  const W = 640
  const H = 220
  const pad = { l: 44, r: 16, t: 14, b: 26 }
  const ys = pts.map((p) => p.y).concat(spec.threshold ? [spec.threshold.value] : [])
  const lo = Math.min(...ys, 0)
  const hi = Math.max(...ys, 1)
  const span = hi - lo || 1
  const x = (i: number) => pad.l + (pts.length > 1 ? (i / (pts.length - 1)) * (W - pad.l - pad.r) : (W - pad.l - pad.r) / 2)
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b)
  const ticks = [lo, lo + span / 2, hi]
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')
  return (
    <Frame title={spec.title}>
      <svg className='line-svg' viewBox={`0 0 ${W} ${H}`} role='img' aria-label={spec.title}>
        {ticks.map((t) => (
          <g key={t}>
            <line className='grid' x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className='axis' x={pad.l - 6} y={y(t) + 4} textAnchor='end'>{fmtNum(Math.round(t))}</text>
          </g>
        ))}
        {spec.threshold && (
          <g>
            <line className='threshold' x1={pad.l} x2={W - pad.r} y1={y(spec.threshold.value)} y2={y(spec.threshold.value)} />
            <text className='axis' x={W - pad.r} y={y(spec.threshold.value) - 5} textAnchor='end'>{spec.threshold.label}</text>
          </g>
        )}
        <path className='line s1-stroke' d={path} />
        {pts.map((p, i) => (
          <g key={i}>
            <circle className={p.status ? `mark st-${p.status}-fill` : 'mark s1-fill'} cx={x(i)} cy={y(p.y)} r={p.status ? 5 : 3.5} />
            {p.status && <text className='mark-label' x={x(i)} y={y(p.y) - 10} textAnchor='middle'>{p.label || fmtNum(p.y, spec.unit)}</text>}
            <circle className='hit' cx={x(i)} cy={y(p.y)} r={12}><title>{`${spec.xLabel || 'x'} ${p.x}: ${fmtNum(p.y, spec.unit)}${p.label ? ` · ${p.label}` : ''}`}</title></circle>
            {(i === 0 || i === pts.length - 1 || pts.length <= 12) && <text className='axis' x={x(i)} y={H - 8} textAnchor='middle'>{p.x}</text>}
          </g>
        ))}
      </svg>
      <TableView columns={[spec.xLabel || 'x', spec.yLabel || 'y', '']} rows={pts.map((p) => [p.x, p.y, p.label || ''])} />
    </Frame>
  )
}

// ---------- Merkle tree ----------

/** leafCount, leafIndex (proved leaf), root, proof (sibling hashes, leaf → root). */
function MerkleSpine ({ spec }: { spec: VisualSpec }) {
  // Large trees: show only the proved path and one sibling per level.
  const n: number = spec.leafCount
  const depth = Math.ceil(Math.log2(n))
  const leaf = spec.leafIndex as number
  const proof: string[] = Array.isArray(spec.proof) ? spec.proof : []
  return (
    <Frame title={spec.title} legend={[{ name: 'Proved path', slot: 1 }, { name: 'Proof sibling', slot: 2 }]}>
      <ol className='spine'>
        {Array.from({ length: depth + 1 }, (_, lvl) => {
          const idx = Math.floor(leaf / 2 ** lvl)
          return (
            <li key={lvl} className='spine-row'>
              <span className='spine-level'>{lvl === 0 ? 'leaf' : lvl === depth ? 'root' : `level ${lvl}`}</span>
              <span className='spine-node on-path' title={`Level ${lvl}, node ${idx}`}>#{idx}</span>
              {lvl < depth && <span className='spine-node proof' title={proof[lvl] || ''}>#{idx ^ 1}{proof[lvl] ? ` · ${proof[lvl].slice(0, 10)}…` : ''}</span>}
              {lvl === depth && spec.root && <span className='spine-hash'>{String(spec.root).slice(0, 18)}…</span>}
            </li>
          )
        }).reverse()}
      </ol>
      <p className='viz-note'>{n.toLocaleString('en-US')} leaves · proof for leaf #{leaf} needs {depth} sibling hashes, not all {n.toLocaleString('en-US')} leaves</p>
      {proof.length > 0 && <TableView columns={['Step', 'Sibling hash']} rows={proof.map((h, i) => [i + 1, h])} />}
    </Frame>
  )
}

function MerkleTree ({ spec }: { spec: VisualSpec }) {
  if (spec.leafCount > 64 && typeof spec.leafIndex === 'number') return <MerkleSpine spec={spec} />
  const n: number = Math.max(1, Math.min(spec.leafCount || 1, 64))
  const levels: number[] = []
  for (let c = n; ; c = Math.ceil(c / 2)) { levels.push(c); if (c === 1) break }
  const depth = levels.length
  const W = 680
  const rowH = 40
  const H = depth * rowH + 24
  const leaf = typeof spec.leafIndex === 'number' ? spec.leafIndex : -1
  const pathAt = (lvl: number) => (leaf < 0 ? -1 : Math.floor(leaf / 2 ** lvl))
  const pos = (lvl: number, i: number) => ({ x: ((i + 0.5) / levels[lvl]) * W, y: H - 16 - lvl * rowH })
  const r = n > 64 ? 2.5 : n > 16 ? 4 : 7
  const short = (h?: string) => (h ? `${h.slice(0, 10)}…` : '')
  const edges: React.ReactNode[] = []
  const nodes: React.ReactNode[] = []
  levels.forEach((count, lvl) => {
    const onPath = pathAt(lvl)
    const sibling = onPath >= 0 ? onPath ^ 1 : -1
    for (let i = 0; i < count; i++) {
      const p = pos(lvl, i)
      if (lvl < depth - 1) {
        const parent = pos(lvl + 1, Math.floor(i / 2))
        edges.push(<line key={`e${lvl}-${i}`} className={i === onPath ? 'tree-edge on-path' : 'tree-edge'} x1={p.x} y1={p.y} x2={parent.x} y2={parent.y} />)
      }
      const cls = i === onPath ? 'tree-node on-path' : i === sibling && sibling < count ? 'tree-node proof' : 'tree-node'
      nodes.push(
        <circle key={`n${lvl}-${i}`} className={cls} cx={p.x} cy={p.y} r={lvl === depth - 1 ? r + 2 : r}>
          <title>{lvl === depth - 1 ? `Root ${spec.root || ''}` : lvl === 0 ? `Leaf #${i}` : `Level ${lvl}, node ${i}`}</title>
        </circle>
      )
    }
  })
  const rootPos = pos(depth - 1, 0)
  const leafPos = leaf >= 0 ? pos(0, leaf) : null
  return (
    <Frame title={spec.title} legend={leaf >= 0 ? [{ name: 'Proved path', slot: 1 }, { name: 'Proof sibling', slot: 2 }] : undefined}>
      <svg className='tree-svg' viewBox={`0 0 ${W} ${H}`} role='img' aria-label={spec.title || 'Merkle tree'}>
        {edges}{nodes}
        {spec.root && <text className='mark-label' x={rootPos.x} y={rootPos.y - 12} textAnchor='middle'>root {short(spec.root)}</text>}
        {leafPos && <text className='mark-label' x={leafPos.x} y={H - 2} textAnchor='middle'>leaf #{leaf}</text>}
      </svg>
      <p className='viz-note'>
        {n} leaves · {depth - 1} levels{leaf >= 0 ? ` · proof for leaf #${leaf} needs ${depth - 1} sibling hashes, not all ${n} leaves` : ''}
      </p>
      {Array.isArray(spec.proof) && spec.proof.length > 0 && (
        <TableView columns={['Step', 'Sibling hash']} rows={spec.proof.map((h: string, i: number) => [i + 1, h])} />
      )}
    </Frame>
  )
}

// ---------- hashgraph DAG ----------

/** events: [{ id, creator, label, selfParent?, otherParent? }] in creation order. */
function Dag ({ spec }: { spec: VisualSpec }) {
  const events: { id: string; creator: string; label?: string; selfParent?: string; otherParent?: string }[] = spec.events || []
  const creators = [...new Set(events.map((e) => e.creator))]
  const W = 560
  const rowH = 64
  const H = events.length * rowH + 40
  const colX = (c: string) => ((creators.indexOf(c) + 0.5) / creators.length) * W
  const at = new Map(events.map((e, i) => [e.id, { x: colX(e.creator), y: H - 30 - i * rowH }]))
  return (
    <Frame title={spec.title} legend={[{ name: 'Self-parent', slot: 1 }, { name: 'Other-parent (gossip)', slot: 2 }]}>
      <svg className='dag-svg' viewBox={`0 0 ${W} ${H}`} role='img' aria-label={spec.title || 'Hashgraph'}>
        {creators.map((c) => (
          <g key={c}>
            <line className='grid' x1={colX(c)} x2={colX(c)} y1={8} y2={H - 16} />
            <text className='axis' x={colX(c)} y={H - 2} textAnchor='middle'>{c}</text>
          </g>
        ))}
        {events.map((e) => {
          const p = at.get(e.id)!
          return (
            <g key={e.id}>
              {e.selfParent && at.has(e.selfParent) && <line className='dag-edge self' x1={p.x} y1={p.y} x2={at.get(e.selfParent)!.x} y2={at.get(e.selfParent)!.y} />}
              {e.otherParent && at.has(e.otherParent) && <line className='dag-edge other' x1={p.x} y1={p.y} x2={at.get(e.otherParent)!.x} y2={at.get(e.otherParent)!.y} />}
            </g>
          )
        })}
        {events.map((e) => {
          const p = at.get(e.id)!
          const right = colX(e.creator) < W / 2
          return (
            <g key={`n${e.id}`}>
              <circle className='dag-node' cx={p.x} cy={p.y} r={9}><title>{`${e.id} by ${e.creator}${e.label ? ` · ${e.label}` : ''}`}</title></circle>
              <text className='mark-label' x={p.x + (right ? -14 : 14)} y={p.y + 4} textAnchor={right ? 'end' : 'start'}>{e.id}{e.label ? ` · ${e.label}` : ''}</text>
            </g>
          )
        })}
      </svg>
      <TableView columns={['Event', 'Creator', 'Self-parent', 'Other-parent', 'Data']} rows={events.map((e) => [e.id, e.creator, e.selfParent || '—', e.otherParent || '—', e.label || ''])} />
    </Frame>
  )
}

// ---------- shards / states ----------

/** id, total, done: a grid that fills as a file is uploaded in chunks. */
function Shards ({ spec }: { spec: VisualSpec }) {
  const total = Math.max(0, Math.min(spec.total || 0, 400))
  const done = Math.max(0, Math.min(spec.done || 0, total))
  return (
    <Frame title={spec.title}>
      <div className='shards' role='progressbar' aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={spec.title}>
        {Array.from({ length: total }, (_, i) => <span key={i} className={i < done ? 'shard done' : 'shard'} title={`Chunk ${i + 1}`} />)}
      </div>
      <p className='viz-note'>{done} / {total}{spec.unitLabel ? ` ${spec.unitLabel}` : ''}</p>
    </Frame>
  )
}

const STATE_ICON: Record<string, string> = { good: '✓', warning: '!', serious: '!', critical: '✕' }

/** items: [{ label, state: good|warning|serious|critical, detail }] — always icon + text. */
function States ({ spec }: { spec: VisualSpec }) {
  const items: { label: string; state: string; detail?: string }[] = spec.items || []
  return (
    <Frame title={spec.title}>
      <ol className='states'>
        {items.map((it, i) => (
          <li key={i} className={`state st-${it.state}-edge`}>
            <span className={`state-icon st-${it.state}`} aria-hidden='true'>{STATE_ICON[it.state] || '•'}</span>
            <span className='state-label'>{it.label}</span>
            {it.detail && <span className='state-detail'>{it.detail}</span>}
          </li>
        ))}
      </ol>
    </Frame>
  )
}

// Structured visuals emitted by labs through show.* (course/<lang>/M99_Utilities/show.js).
export function Visual ({ spec }: { spec: VisualSpec }) {
  switch (spec?.type) {
    case 'bar': return <BarChart spec={spec} />
    case 'stacked': return <StackedChart spec={spec} />
    case 'line': return <LineChart spec={spec} />
    case 'merkle': return <MerkleTree spec={spec} />
    case 'dag': return <Dag spec={spec} />
    case 'shards': return <Shards spec={spec} />
    case 'states': return <States spec={spec} />
    default: return <pre className='visual-fallback'>{JSON.stringify(spec, null, 2)}</pre>
  }
}
