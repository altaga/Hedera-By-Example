/** Tab title. Home is fixed in both languages; labs keep their own title. */
export function documentTitle (view, labTitle, lang) {
  if (view === 'index') return 'HBE by Effisend'
  if (view === 'lab' && labTitle) return `${labTitle} · Hedera by Example`
  if (view === 'resources') return `${lang === 'es' ? 'Recursos' : 'Resources'} · Hedera by Example`
  if (view === 'missing') return `${lang === 'es' ? 'Lab no encontrado' : 'Lab not found'} · Hedera by Example`
  return 'HBE by Effisend'
}

/**
 * Whether "Run in browser" is enabled.
 * A missing account stays blocked. A low balance stays blocked until the
 * learner clicks "Run anyway" for this lab and wallet.
 */
export function canRunLab ({ running, blockReason, allowLowBalance }) {
  if (running) return false
  if (blockReason === 'account') return false
  if (blockReason === 'balance') return !!allowLowBalance
  return true
}
