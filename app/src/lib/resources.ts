/**
 * Everything the learner's wallets created on testnet (tokens, topics,
 * accounts, contracts, files, schedules), read from the Mirror Node, plus a
 * local log of lab runs so each resource can name the lab that made it.
 */
import { mirrorFetch } from './mirror'
import { labFor, normalizeTxId } from './labAttribution.mjs'

export { labFor, normalizeTxId }

const MIRROR = 'https://testnet.mirrornode.hedera.com/api/v1'
const RUNS_KEY = 'hbe_runs_v1'
const MAX_RUNS = 500

export type ResourceKind = 'token' | 'topic' | 'account' | 'contract' | 'file' | 'schedule'

export const KINDS: { kind: ResourceKind; tx: string }[] = [
  { kind: 'token', tx: 'TOKENCREATION' },
  { kind: 'topic', tx: 'CONSENSUSCREATETOPIC' },
  { kind: 'account', tx: 'CRYPTOCREATEACCOUNT' },
  { kind: 'contract', tx: 'CONTRACTCREATEINSTANCE' },
  { kind: 'file', tx: 'FILECREATE' },
  { kind: 'schedule', tx: 'SCHEDULECREATE' }
]

export interface Resource {
  kind: ResourceKind
  id: string
  /** Consensus timestamp of the creating transaction ("seconds.nanos"). */
  createdAt: string
  /** The learner's wallet that paid for or took part in the creation. */
  wallet: string
  txId: string
  memo: string
  /** Lab that was running when the resource was created, if it ran in this browser. */
  labSlug?: string
  /** Token name / symbol / type, filled in after the list loads. */
  label?: string
}

export interface LabRun {
  slug: string
  start: number
  end: number
  accountId: string
  /** Transaction ids the run submitted (SDK "0.0.1@secs.nanos" form). */
  txIds?: string[]
}

export function loadRuns (): LabRun[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '[]') } catch (_) { return [] }
}

/** Remember that a lab ran between start and end (seconds since epoch). */
export function recordRun (run: LabRun): void {
  try {
    const runs = loadRuns()
    runs.push(run)
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
    localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(-MAX_RUNS)))
  } catch (_) {}
}

const decode64 = (value?: string | null): string => {
  if (!value) return ''
  try { return new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))) } catch (_) { return '' }
}

/** Readable text if the bytes look like text, otherwise hex. */
export function decodeBytes (value?: string | null): string {
  if (!value) return ''
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const printable = text.replace(/[\x20-\x7e\s -￿]/g, '').length === 0 && !text.includes('�')
  return printable ? text : '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Reads go through the site's Mirror Node limiter and are cached for 30 s.
async function getJson (url: string): Promise<any> {
  const res = await mirrorFetch(url, { ttlMs: 30_000 })
  if (!res.ok) throw new Error(`Mirror Node ${res.status}`)
  return res.json()
}

async function fetchCreations (accountId: string, kind: ResourceKind, tx: string, pages = 1): Promise<Resource[]> {
  const out: Resource[] = []
  let url: string | null = `${MIRROR}/transactions?account.id=${accountId}&transactiontype=${tx}&result=success&order=desc&limit=100`
  for (let i = 0; url && i < pages; i++) {
    const data: any = await getJson(url)
    for (const t of data.transactions || []) {
      if (!t.entity_id) continue
      out.push({ kind, id: t.entity_id, createdAt: t.consensus_timestamp, wallet: accountId, txId: t.transaction_id, memo: decode64(t.memo_base64) })
    }
    url = data.links?.next ? `https://testnet.mirrornode.hedera.com${data.links.next}` : null
  }
  return out
}

/** All resources created with the given accounts, newest first, without duplicates. */
export async function fetchResources (accountIds: string[]): Promise<Resource[]> {
  const runs = loadRuns()
  const lists = await Promise.all(accountIds.flatMap((a) => KINDS.map(({ kind, tx }) => fetchCreations(a, kind, tx).catch(() => []))))
  const byId = new Map<string, Resource>()
  for (const r of lists.flat()) if (!byId.has(r.id)) byId.set(r.id, { ...r, labSlug: labFor(runs, r.createdAt, r.txId) })
  return [...byId.values()].sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
}

/** Token names for the list (a few requests at a time). */
export async function fetchTokenLabels (ids: string[], onLabel: (id: string, label: string) => void): Promise<void> {
  const queue = ids.slice()
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const t = await getJson(`${MIRROR}/tokens/${id}`)
        onLabel(id, `${t.name} (${t.symbol}) · ${t.type === 'NON_FUNGIBLE_UNIQUE' ? 'NFT' : 'FT'}`)
      } catch (_) {}
    }
  }
  await Promise.all(Array.from({ length: 2 }, worker))
}

export interface ResourceDetail {
  /** Main record from the Mirror Node. */
  record: any
  /** Related lists: NFTs, holders, messages, tokens held, contract calls. */
  lists: { title: string; rows: Record<string, string>[] }[]
}

const keyLabel = (k: any): string => (k?.key ? `${k._type || 'key'} ${String(k.key).slice(0, 12)}…` : '—')
const tsDate = (ts?: string | null): string => (ts ? new Date(Number(ts) * 1000).toLocaleString() : '—')

/** Live details for one resource. */
export async function fetchDetail (r: Resource): Promise<ResourceDetail> {
  const lists: ResourceDetail['lists'] = []
  if (r.kind === 'token') {
    const record = await getJson(`${MIRROR}/tokens/${r.id}`)
    if (record.type === 'NON_FUNGIBLE_UNIQUE') {
      const nfts = await getJson(`${MIRROR}/tokens/${r.id}/nfts?limit=10`).catch(() => ({ nfts: [] }))
      lists.push({ title: 'nfts', rows: nfts.nfts.map((n: any) => ({ serial: String(n.serial_number), owner: n.account_id, metadata: decodeBytes(n.metadata) })) })
    }
    const bal = await getJson(`${MIRROR}/tokens/${r.id}/balances?limit=10`).catch(() => ({ balances: [] }))
    lists.push({ title: 'holders', rows: bal.balances.map((b: any) => ({ account: b.account, balance: String(b.balance) })) })
    return { record, lists }
  }
  if (r.kind === 'topic') {
    const record = await getJson(`${MIRROR}/topics/${r.id}`)
    const msgs = await getJson(`${MIRROR}/topics/${r.id}/messages?order=desc&limit=10`).catch(() => ({ messages: [] }))
    lists.push({ title: 'messages', rows: msgs.messages.map((m: any) => ({ seq: String(m.sequence_number), time: tsDate(m.consensus_timestamp), payer: m.payer_account_id, message: decodeBytes(m.message).slice(0, 400) })) })
    return { record, lists }
  }
  if (r.kind === 'account') {
    const record = await getJson(`${MIRROR}/accounts/${r.id}?transactions=false`)
    const tokens = await getJson(`${MIRROR}/accounts/${r.id}/tokens?limit=10`).catch(() => ({ tokens: [] }))
    lists.push({ title: 'tokens', rows: tokens.tokens.map((t: any) => ({ token: t.token_id, balance: String(t.balance), frozen: t.freeze_status, kyc: t.kyc_status })) })
    return { record, lists }
  }
  if (r.kind === 'contract') {
    const record = await getJson(`${MIRROR}/contracts/${r.id}`)
    const results = await getJson(`${MIRROR}/contracts/${r.id}/results?order=desc&limit=10`).catch(() => ({ results: [] }))
    lists.push({ title: 'calls', rows: results.results.map((c: any) => ({ time: tsDate(c.timestamp), from: c.from, result: c.result, gas: `${c.gas_used} / ${c.gas_limit}` })) })
    return { record, lists }
  }
  if (r.kind === 'schedule') {
    const record = await getJson(`${MIRROR}/schedules/${r.id}`)
    lists.push({ title: 'signatures', rows: (record.signatures || []).map((s: any) => ({ time: tsDate(s.consensus_timestamp), type: s.type, key: String(s.public_key_prefix).slice(0, 16) + '…' })) })
    return { record, lists }
  }
  // Files: the Mirror Node does not serve file contents; show the creating transaction.
  const tx = await getJson(`${MIRROR}/transactions/${r.txId}`)
  return { record: tx.transactions?.[0] || {}, lists }
}

/** The fields worth showing first, per kind, as [label, value]. */
export function summary (r: Resource, d: any): [string, string][] {
  const rows: [string, string][] = []
  const add = (label: string, value: any) => { if (value !== undefined && value !== null && value !== '') rows.push([label, String(value)]) }
  if (r.kind === 'token') {
    add('name', `${d.name} (${d.symbol})`)
    add('type', d.type)
    add('decimals', d.decimals)
    add('total_supply', d.total_supply)
    add('max_supply', d.supply_type === 'FINITE' ? d.max_supply : 'infinite')
    add('treasury', d.treasury_account_id)
    add('memo', d.memo)
    add('pause_status', d.pause_status)
    add('freeze_default', d.freeze_default)
    for (const k of ['admin_key', 'supply_key', 'kyc_key', 'freeze_key', 'wipe_key', 'pause_key', 'fee_schedule_key', 'metadata_key']) {
      if (d[k]) add(k, keyLabel(d[k]))
    }
    const fees = d.custom_fees || {}
    const n = (fees.fixed_fees?.length || 0) + (fees.fractional_fees?.length || 0) + (fees.royalty_fees?.length || 0)
    if (n) add('custom_fees', `${fees.fixed_fees?.length || 0} fixed · ${fees.fractional_fees?.length || 0} fractional · ${fees.royalty_fees?.length || 0} royalty`)
    add('deleted', d.deleted)
  } else if (r.kind === 'topic') {
    add('memo', d.memo)
    add('admin_key', d.admin_key ? keyLabel(d.admin_key) : 'none (immutable)')
    add('submit_key', d.submit_key ? keyLabel(d.submit_key) : 'none (public)')
    if (d.fee_schedule_key) add('fee_schedule_key', keyLabel(d.fee_schedule_key))
    if (d.custom_fees?.fixed_fees?.length) add('custom_fees', `${d.custom_fees.fixed_fees.length} fixed (HIP-991)`)
    add('auto_renew_account', d.auto_renew_account)
    add('deleted', d.deleted)
  } else if (r.kind === 'account') {
    add('balance', `${((d.balance?.balance ?? 0) / 1e8).toFixed(4)} ℏ`)
    add('evm_address', d.evm_address)
    add('key', keyLabel(d.key))
    add('memo', d.memo)
    add('max_auto_associations', d.max_automatic_token_associations)
    add('receiver_sig_required', d.receiver_sig_required)
    add('staked_node_id', d.staked_node_id)
    add('deleted', d.deleted)
  } else if (r.kind === 'contract') {
    add('evm_address', d.evm_address)
    add('admin_key', d.admin_key ? keyLabel(d.admin_key) : 'none')
    add('memo', d.memo)
    add('bytecode', d.runtime_bytecode ? `${(d.runtime_bytecode.length - 2) / 2} bytes` : undefined)
    add('file_id', d.file_id)
    add('deleted', d.deleted)
  } else if (r.kind === 'schedule') {
    add('memo', d.memo)
    add('creator', d.creator_account_id)
    add('payer', d.payer_account_id)
    add('executed', d.executed_timestamp ? tsDate(d.executed_timestamp) : 'not yet')
    add('expires', tsDate(d.expiration_time))
    add('wait_for_expiry', d.wait_for_expiry)
    add('deleted', d.deleted)
  } else {
    add('memo', r.memo)
    add('charged_fee', d.charged_tx_fee != null ? `${(d.charged_tx_fee / 1e8).toFixed(4)} ℏ` : undefined)
  }
  add('created', tsDate(r.createdAt))
  return rows
}

export const hashscanUrl = (r: Pick<Resource, 'kind' | 'id'>) => `https://hashscan.io/testnet/${r.kind}/${r.id}`
