/**
 * @file faucet-pool.mjs
 * Round-robin pool orchestration, error classification, and retry decision engine.
 * Direct parity with Hedera for Dummies (HFD) enterprise architecture.
 */

export const MAX_NONCE_RETRIES_PER_WALLET = 3;

/**
 * Returns safe size of account pool.
 * @param {Array<unknown>} accounts
 * @returns {number}
 */
export function poolSize(accounts) {
  return Array.isArray(accounts) && accounts.length > 0 ? accounts.length : 0;
}

/**
 * Generates initial random index in the pool.
 * @param {number} size
 * @param {() => number} [random=Math.random]
 * @returns {number}
 */
export function startIndex(size, random = Math.random) {
  if (size <= 0) return 0;
  return Math.floor(random() * size);
}

/**
 * Steps to the next round-robin index in the pool.
 * @param {number} index
 * @param {number} size
 * @returns {number}
 */
export function nextIndex(index, size) {
  if (size <= 0) return 0;
  return (index + 1) % size;
}

/**
 * Classifies transaction and network errors into actionable categories.
 * @param {unknown} error
 * @returns {'funds' | 'nonce' | 'rpc' | 'other'}
 */
export function classifyFaucetError(error) {
  if (!error) return 'other';
  const err = error;
  const code = (err.code || '').toString().toLowerCase();
  const msg = (err.message || '').toString().toLowerCase();
  const info = err.info?.error?.message ? String(err.info.error.message).toLowerCase() : '';
  const combined = `${code} ${msg} ${info}`;

  if (combined.match(/insufficient|balance|funds|insufficient_payer_balance|insufficient_account_balance/)) {
    return 'funds';
  }
  if (
    code === 'nonce_expired' ||
    code === 'replacement_underpriced' ||
    combined.includes('nonce') ||
    combined.includes('replacement') ||
    combined.includes('already known') ||
    combined.includes('transaction underpriced')
  ) {
    return 'nonce';
  }
  if (
    code === 'server_error' ||
    code === 'network_error' ||
    combined.includes('502') ||
    combined.includes('503') ||
    combined.includes('504') ||
    combined.includes('429') ||
    combined.includes('rate limit') ||
    combined.includes('econnreset') ||
    combined.includes('enotfound') ||
    combined.includes('timeout')
  ) {
    return 'rpc';
  }
  return 'other';
}

/**
 * Determines the next retry step based on classified failure and pool state.
 * @param {object} params
 * @param {'funds' | 'nonce' | 'rpc' | 'other'} params.kind
 * @param {number} params.nonceRetriesOnWallet
 * @param {number} params.walletsTried
 * @param {number} params.poolSize
 * @param {number} params.maxAttempts
 * @param {number} params.attempt
 * @returns {{ action: 'fail' | 'next_rpc_same_wallet' | 'next_wallet' | 'retry_same_wallet', nextNonceRetries: number }}
 */
export function faucetRetryDecision({
  kind,
  nonceRetriesOnWallet,
  walletsTried,
  poolSize: size,
  maxAttempts,
  attempt,
}) {
  if (attempt + 1 >= maxAttempts) {
    return { action: 'fail', nextNonceRetries: nonceRetriesOnWallet };
  }

  if (kind === 'rpc') {
    return { action: 'next_rpc_same_wallet', nextNonceRetries: nonceRetriesOnWallet };
  }

  if (kind === 'funds') {
    if (walletsTried >= size) {
      return { action: 'fail', nextNonceRetries: 0 };
    }
    return { action: 'next_wallet', nextNonceRetries: 0 };
  }

  if (kind === 'nonce') {
    if (nonceRetriesOnWallet + 1 < MAX_NONCE_RETRIES_PER_WALLET) {
      return {
        action: 'retry_same_wallet',
        nextNonceRetries: nonceRetriesOnWallet + 1,
      };
    }
    if (walletsTried >= size) {
      return { action: 'fail', nextNonceRetries: 0 };
    }
    return { action: 'next_wallet', nextNonceRetries: 0 };
  }

  return { action: 'fail', nextNonceRetries: nonceRetriesOnWallet };
}

/**
 * Applies wallet index transition based on retry action.
 * @param {string} action
 * @param {number} currentIndex
 * @param {number} size
 * @returns {number}
 */
export function applyNewWalletAction(action, currentIndex, size) {
  if (action === 'next_wallet') return nextIndex(currentIndex, size);
  return currentIndex;
}
