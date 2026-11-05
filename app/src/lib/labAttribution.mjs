/** "0.0.1@123.000000045" or "0.0.1-123-45" -> "0.0.1-123-000000045", so SDK and Mirror Node ids compare equal. */
export function normalizeTxId (id) {
  const s = String(id || '').trim().replace(/\?.*$/, '')
  const m = s.match(/^(\d+\.\d+\.\d+)[@-](\d+)[.-](\d+)$/)
  return m ? `${m[1]}-${m[2]}-${m[3].padStart(9, '0')}` : s
}

/**
 * The lab that created a resource. A run that recorded the creating
 * transaction id wins outright. Runs without recorded ids (older history)
 * fall back to time: a run whose own window contains the timestamp beats
 * one that only overlaps the grace margins; among equals the latest start wins.
 */
export function labFor (runs, createdAt, txId) {
  if (txId) {
    const id = normalizeTxId(txId)
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].txIds && runs[i].txIds.some((t) => normalizeTxId(t) === id)) return runs[i].slug
    }
  }
  const t = Number(createdAt)
  let best
  let bestScore = -1
  for (const r of runs) {
    // A run that recorded its transactions did not create this one.
    if (txId && r.txIds && r.txIds.length) continue
    if (t < r.start - 2 || t > r.end + 15) continue
    const score = t >= r.start && t <= r.end ? 1 : 0
    if (score > bestScore || (score === bestScore && best && r.start > best.start)) { best = r; bestScore = score }
  }
  return best ? best.slug : undefined
}
