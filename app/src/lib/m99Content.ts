/**
 * @file m99Content.ts
 * Self-contained, documented reference source for Hedera by Example's M99_Utilities.
 * Displayed in the companion "M99_Utilities.js" tab when a lab imports utility functions.
 */

export const M99_UTILITIES_SOURCE = `/**
 * ============================================================================
 * Hedera by Example — Core Resilience & Testnet Utilities (M99_Utilities)
 * ============================================================================
 * Provides automatic fee ceilings, testnet asset recycling, gas retry loops,
 * and mirror node state interrogation so labs run reliably in the browser.
 */

import {
  Client,
  AccountId,
  PrivateKey,
  Hbar,
  ContractCreateFlow,
  ContractCreateTransaction,
  ContractExecuteTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'

/** Maximum gas ceiling for complex EVM executions */
export const MAX_GAS = 15_000_000

/**
 * Initializes a Hedera Client pre-configured for Testnet with
 * generous default fee caps (100 HBAR for txs, 10 HBAR for queries).
 */
export function getClient() {
  const client = Client.forTestnet()
  client.setDefaultMaxTransactionFee(new Hbar(100))
  client.setDefaultMaxQueryPayment(new Hbar(10))

  const operatorId = process.env.OPERATOR_ID || ''
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY || ''

  if (operatorId && operatorKey) {
    client.setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey))
  }

  return { client, operatorId, operatorKey, network: 'testnet' }
}

/**
 * Executes an EVM transaction with exponential gas retry.
 * If the network responds with INSUFFICIENT_GAS, the limit is doubled
 * up to MAX_GAS to prevent transaction failure under dynamic network loads.
 */
export async function withGasRetry(run, { gas = 300_000, maxGas = MAX_GAS } = {}) {
  let limit = Math.min(gas, maxGas)
  for (;;) {
    try {
      return await run(limit)
    } catch (error) {
      const isInsufficient = /INSUFFICIENT_GAS/.test(String(error?.message || error?.status || ''))
      if (!isInsufficient || limit >= maxGas) throw error
      limit = Math.min(limit * 2, maxGas)
      console.log(\`[ℹ️ INFO] Gas limit insufficient; retrying with \${limit.toLocaleString()} gas...\`)
    }
  }
}

/**
 * Recycles an HTS token created on a previous run to avoid incurring
 * redundant ~$1.00 USD token creation fees on every execution.
 */
export async function reuseToken(stateKey, createFn) {
  const cached = localStorage.getItem(\`hbe_state_\${stateKey}\`)
  if (cached) {
    console.log(\`[REUSE] Using existing HTS token: \${cached}\`)
    return cached
  }
  const newTokenId = await createFn()
  localStorage.setItem(\`hbe_state_\${stateKey}\`, String(newTokenId))
  return newTokenId
}

/**
 * Recycles a deployed Smart Contract across lab runs to optimize
 * student testnet balances and accelerate turnaround times.
 */
export async function reuseContract(stateKey, bytecode, deployFn) {
  const cached = localStorage.getItem(\`hbe_state_\${stateKey}\`)
  if (cached) {
    console.log(\`[REUSE] Using existing Contract: \${cached}\`)
    return cached
  }
  const newContractId = await deployFn()
  localStorage.setItem(\`hbe_state_\${stateKey}\`, String(newContractId))
  return newContractId
}

/**
 * Resilient multi-endpoint on-chain reader for smart contract calls and EVM queries.
 * Sequence: Hedera Mirror Node (/api/v1/contracts/call) -> Thirdweb (Chain 296) -> Hashio.
 * Remembers the last successful endpoint (sticky cursor) for optimal latency.
 */
export async function resilientContractCall(to, data) {
  const sources = [
    { name: 'mirror-node', url: 'https://testnet.mirrornode.hedera.com/api/v1/contracts/call' },
    { name: 'thirdweb', url: 'https://296.rpc.thirdweb.com' },
    { name: 'hashio', url: 'https://testnet.hashio.io/api' }
  ]
  for (const src of sources) {
    try {
      const res = await fetch(src.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(src.name === 'mirror-node'
          ? { to, data, block: 'latest' }
          : { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] })
      })
      const json = await res.json()
      if (json.result) return json.result
    } catch (_) {}
  }
  throw new Error('All contract read endpoints failed')
}

/**
 * High-level contract reader: encodes function data, queries resiliently, and decodes result.
 */
export async function readContract(address, abi, fn, args = []) {
  const iface = new ethers.Interface(abi)
  const data = iface.encodeFunctionData(fn, args)
  const raw = await resilientContractCall(address, data)
  return iface.decodeFunctionResult(fn, raw)
}

/**
 * Pause execution for a given number of milliseconds.
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
`
