/** Minimal POSIX path for labs in the browser. The lab's working directory is /lab. */
export const LAB_CWD = '/lab'

export function normalize (p) {
  const s = String(p ?? '')
  if (!s) return '.'
  const abs = s.startsWith('/')
  const out = []
  for (const part of s.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..') } else out.push(part)
  }
  const body = out.join('/')
  return abs ? '/' + body : (body || '.')
}

export const join = (...args) => normalize(args.filter((a) => a !== '' && a != null).join('/'))

export function resolve (...args) {
  let p = ''
  for (let i = args.length - 1; i >= 0 && !p.startsWith('/'); i--) {
    const a = args[i]
    if (a === '' || a == null) continue
    p = p ? `${a}/${p}` : String(a)
  }
  if (!p.startsWith('/')) p = `${LAB_CWD}/${p}`
  const n = normalize(p)
  return n.length > 1 ? n.replace(/\/$/, '') : n
}
