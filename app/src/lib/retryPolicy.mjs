/**
 * When a lab's execute() may be tried again.
 *
 * Transactions: only errors that prove the transaction never reached
 * consensus. The node map lost the node before sending, no healthy node to
 * send to, or a precheck that rejects without processing (BUSY,
 * PLATFORM_NOT_ACTIVE, UNAVAILABLE). Timeouts, dropped connections or
 * "max attempts reached" may hide a submission that still lands, so those are
 * never retried. A retry reuses the same frozen transaction (same
 * transaction id), so the network rejects any duplicate.
 *
 * Queries do not move value, so transport errors are retried too.
 */
export const MAX_NODE_ATTEMPTS = 3

const PRE_SUBMISSION = /NodeAccountId not recognized|failed to find a healthy working node|\bBUSY\b|PLATFORM_NOT_ACTIVE|\bUNAVAILABLE\b|status: ?14\b/i
const MAYBE_SUBMITTED = /max attempts|timed? ?out|timeout|deadline|RST_STREAM|ECONNRESET|Failed to fetch|NetworkError|fetch failed|DUPLICATE_TRANSACTION/i
const QUERY_TRANSIENT = /NodeAccountId not recognized|failed to find a healthy working node|\bBUSY\b|PLATFORM_NOT_ACTIVE|\bUNAVAILABLE\b|RST_STREAM|Failed to fetch|NetworkError|fetch failed|timed? ?out|deadline exceeded|ECONNRESET/i

export function shouldRetryExecution ({ isTransaction, message, attempt, stopped }) {
  if (stopped || attempt >= MAX_NODE_ATTEMPTS) return false
  const msg = String(message || '')
  if (isTransaction) return PRE_SUBMISSION.test(msg) && !MAYBE_SUBMITTED.test(msg)
  return QUERY_TRANSIENT.test(msg)
}

/** Backoff before attempt n+1: 0.5 s, 1 s, 2 s. */
export const retryDelayMs = (attempt) => 500 * 2 ** (attempt - 1)
