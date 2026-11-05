export const SITE_TITLE: 'HBE by Effisend'
export function documentTitle (
  view?: 'index' | 'resources' | 'lab' | 'missing',
  labTitle?: string | null,
  lang?: 'en' | 'es'
): 'HBE by Effisend'

export function canRunLab (opts: {
  running: boolean
  blockReason: 'account' | 'balance' | null
  allowLowBalance: boolean
}): boolean
