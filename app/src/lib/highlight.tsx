import React from 'react'

const KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function',
  'async', 'await', 'return', 'if', 'else', 'for', 'while', 'do', 'switch',
  'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new',
  'class', 'extends', 'typeof', 'instanceof', 'in', 'of', 'true', 'false',
  'null', 'undefined', 'void', 'this', 'static', 'get', 'set', 'yield'
])

const TOKEN_RE =
  /(\/\/.*$|\/\*.*?(?:\*\/|$)|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b\d+(?:_\d+)*(?:\.\d+)?n?\b|\b[A-Za-z_$][\w$]*\b)/gm

const SDK_SHAPE = /^[A-Z][A-Za-z0-9]+(Transaction|Query|Id|Key|Status|Type|Client|Hbar|Flow)$/

function highlightPlain (line: string, sdk: Set<string>, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(line)) !== null) {
    const idx = m.index
    const tok = m[0]
    if (idx > last) out.push(line.slice(last, idx))
    let cls = ''
    if (tok.startsWith('//') || tok.startsWith('/*')) cls = 't-com'
    else if (/^['"`]/.test(tok)) cls = 't-str'
    else if (/^\d/.test(tok)) cls = 't-num'
    else if (KEYWORDS.has(tok)) cls = 't-kw'
    else if (sdk.has(tok) || SDK_SHAPE.test(tok)) cls = 't-sdk'
    else if (line[idx + tok.length] === '(') cls = 't-fn'
    out.push(cls ? <span key={`${keyBase}-${idx}`} className={cls}>{tok}</span> : tok)
    last = idx + tok.length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

/**
 * Highlight a block of source lines, carrying block-comment state across
 * lines so headers and `/* ... *\/` notes render as comments.
 */
export function highlightLines (lines: string[], sdk: Set<string>): React.ReactNode[][] {
  let inBlock = false
  return lines.map((line, i) => {
    const key = String(i)
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end === -1) return [<span key={key} className='t-com'>{line}</span>]
      inBlock = false
      return [
        <span key={key} className='t-com'>{line.slice(0, end + 2)}</span>,
        ...highlightPlain(line.slice(end + 2), sdk, key)
      ]
    }
    const start = line.indexOf('/*')
    if (start !== -1 && line.indexOf('*/', start + 2) === -1 && !/['"`]/.test(line.slice(0, start))) {
      inBlock = true
      return [
        ...highlightPlain(line.slice(0, start), sdk, key),
        <span key={`${key}-c`} className='t-com'>{line.slice(start)}</span>
      ]
    }
    return highlightPlain(line, sdk, key)
  })
}
