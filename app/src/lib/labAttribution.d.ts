export function normalizeTxId (id: string): string
export function labFor (
  runs: { slug: string; start: number; end: number; txIds?: string[] }[],
  createdAt: string,
  txId?: string
): string | undefined
