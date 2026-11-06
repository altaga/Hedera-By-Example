/**
 * Generates a correctly formatted HashScan URL for a transaction.
 *
 * @param {Object|string} txResponse - The TransactionResponse object or TransactionID string.
 * @returns {string} HashScan URL.
 */
export const getHashscanUrl = (txResponse) => {
  const rawTxId = typeof txResponse === 'string'
    ? txResponse
    : txResponse.transactionId.toString()

  const network = process.env.NETWORK || 'testnet'
  const [accId, timestamp] = rawTxId.split('@')
  const txId = `${accId}-${timestamp.replace('.', '-')}`

  return `https://hashscan.io/${network.toLowerCase()}/transaction/${txId}`
}
