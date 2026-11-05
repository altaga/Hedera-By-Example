/** The one browser tab title for every page, screen and language (same as the global header). */
export const SITE_TITLE = 'HBE by Effisend'

/** Tab title: always SITE_TITLE, whatever the view, lab or language. */
export function documentTitle (_view, _labTitle, _lang) {
  return SITE_TITLE
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
