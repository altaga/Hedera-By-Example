import React, { useState } from 'react'
import type { TerminalLogLine } from '../lib/hederaBrowser'
import type { Strings } from '../lib/i18n'
import { Visual } from './Visual'

/** Collapsible JSON tree. Objects deeper than `openDepth` start closed. */
function JsonNode ({ name, value, depth, openDepth, t }: { name?: string; value: any; depth: number; openDepth: number; t: Strings }) {
  const isArray = Array.isArray(value)
  const isObject = value !== null && typeof value === 'object'
  const [open, setOpen] = useState(depth < openDepth)
  const label = name !== undefined ? <span className='json-key'>{name}: </span> : null

  if (!isObject) {
    const cls = typeof value === 'string' ? 'json-str' : typeof value === 'number' ? 'json-num' : 'json-lit'
    return <div className='json-row'>{label}<span className={cls}>{typeof value === 'string' ? `"${value}"` : String(value)}</span></div>
  }
  const entries: [string, any][] = isArray ? value.map((v: any, i: number) => [String(i), v] as [string, any]) : Object.entries(value)
  const summary = isArray ? t.itemsCount(entries.length) : t.keysCount(entries.length)
  return (
    <div className='json-row'>
      <button type='button' className='json-toggle' aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className='json-caret' aria-hidden='true'>{open ? '▾' : '▸'}</span>
        {label}<span className='json-brace'>{isArray ? '[' : '{'}</span>
        {!open && <span className='json-summary'> {summary} </span>}
        {!open && <span className='json-brace'>{isArray ? ']' : '}'}</span>}
      </button>
      {open && (
        <div className='json-children'>
          {entries.map(([k, v]: [string, any]) => <JsonNode key={k} name={isArray ? undefined : k} value={v} depth={depth + 1} openDepth={openDepth} t={t} />)}
          <div className='json-brace'>{isArray ? ']' : '}'}</div>
        </div>
      )}
    </div>
  )
}

function TableView ({ data }: { data: { columns: string[]; rows: any[][] } }) {
  const cell = (v: any) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  return (
    <div className='out-table-wrap'>
      <table className='out-table'>
        <thead><tr>{data.columns.map((c) => <th key={c} scope='col'>{c}</th>)}</tr></thead>
        <tbody>{data.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{cell(v)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

function FileView ({ data, t }: { data: { name: string; mime: string; url: string; size: number; text?: string }; t: Strings }) {
  return (
    <figure className='out-file'>
      <figcaption>
        <span>{t.writtenFile}: <code>{data.name}</code> · {data.size.toLocaleString()} bytes</span>
        <a href={data.url} download={data.name}>{t.download}</a>
      </figcaption>
      {data.mime.startsWith('image/')
        ? <img src={data.url} alt={data.name} />
        : data.text !== undefined ? <pre>{data.text}</pre> : null}
    </figure>
  )
}

export function OutputLine ({ line, t }: { line: TerminalLogLine; t: Strings }) {
  const body = (() => {
    switch (line.kind) {
      case 'json': return <div className='out-json'><JsonNode value={line.data} depth={0} openDepth={2} t={t} /></div>
      case 'table': return <TableView data={line.data} />
      case 'file': return <FileView data={line.data} t={t} />
      case 'visual': return <Visual spec={line.data} />
      default:
        return (
          <span className='log-text'>
            {line.text}
            {line.url && <> <a href={line.url} target='_blank' rel='noopener noreferrer'>{/faucet/.test(line.url) ? 'Faucet' : 'HashScan'}</a></>}
          </span>
        )
    }
  })()
  return (
    <div className={`log-line log-${line.type} ${line.kind && line.kind !== 'text' ? 'log-block' : ''}`} data-testid='output-line' data-kind={line.kind || 'text'}>
      <span className='log-ts'>{line.timestamp}</span>
      {body}
    </div>
  )
}
