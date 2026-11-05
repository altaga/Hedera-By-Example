/**
 * What a lab declares in its [ BEFORE YOU RUN ] block: whether it needs a
 * funded account, the approximate HBAR cost, and a coarse difficulty.
 */
const isAccountId = (id: string) => /^\d+\.\d+\.\d+$/.test(id.trim())

export interface BeforeItem { label: string; text: string }

export type Difficulty = 'local' | 'light' | 'heavy'

export interface LabRequirements {
  needsAccount: boolean
  /** Declared cost of the first run, in HBAR. "<0.1 ℏ" contributes 0.1. */
  firstHbar: number | null
  /** Declared cost of a repeat run, when the lab says it reuses what it created. */
  againHbar: number | null
  difficulty: Difficulty
}

const row = (before: BeforeItem[] | undefined, labels: RegExp) =>
  before?.find((b) => labels.test(b.label.trim()))

function amountIn (text: string): number | null {
  const m = text.match(/(?:~|<)?\s*(\d+(?:\.\d+)?)\s*ℏ/)
  return m ? Number(m[1]) : null
}

export function labRequirements (before?: BeforeItem[]): LabRequirements {
  const wallet = row(before, /^(wallet|billetera)$/i)
  const needsAccount = !!wallet && !/^\s*(none|ninguna)\b/i.test(wallet.text)
  const cost = row(before, /^(cost|costo)$/i)
  let firstHbar: number | null = null
  let againHbar: number | null = null
  if (cost) {
    const parts = cost.text.split(';')
    firstHbar = amountIn(parts[0])
    againHbar = parts.length > 1 ? amountIn(parts.slice(1).join(';')) : firstHbar
  }
  let difficulty: Difficulty = 'light'
  if (!needsAccount) difficulty = 'local'
  else if (firstHbar != null && firstHbar >= 5) difficulty = 'heavy'
  return { needsAccount, firstHbar, againHbar, difficulty }
}

export type RunBlock =
  | { reason: 'account' }
  | { reason: 'balance'; have: number; need: number; again: number | null }

/** Why Run should wait, or null when the wallet can pay for a first run. */
export function runBlock (before: BeforeItem[] | undefined, wallet: { accountId: string; balanceHbar: number | null }): RunBlock | null {
  const req = labRequirements(before)
  if (!req.needsAccount) return null
  if (!isAccountId(wallet.accountId)) return { reason: 'account' }
  if (req.firstHbar == null || wallet.balanceHbar == null) return null
  if (wallet.balanceHbar + 1e-6 < req.firstHbar) {
    return { reason: 'balance', have: wallet.balanceHbar, need: req.firstHbar, again: req.againHbar }
  }
  return null
}

export function difficultyLabel (level: Difficulty, hbar: number | null, lang: 'en' | 'es'): string {
  if (level === 'local') return lang === 'es' ? 'En tu máquina' : 'On your machine'
  if (level === 'heavy') return hbar != null ? `~${hbar} ℏ` : (lang === 'es' ? 'Cuesta ℏ' : 'Costs ℏ')
  return lang === 'es' ? 'Comisión baja' : 'Low fee'
}
