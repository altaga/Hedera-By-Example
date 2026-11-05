export function documentTitle (
  view: 'index' | 'resources' | 'lab' | 'missing',
  labTitle: string | null,
  lang: 'en' | 'es'
): string

export function canRunLab (opts: {
  running: boolean
  blockReason: 'account' | 'balance' | null
  allowLowBalance: boolean
}): boolean
