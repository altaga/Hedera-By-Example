/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * Genera una URL de HashScan formateada correctamente para una transacción.
 *
 * @param {Object|string} txResponse - El objeto TransactionResponse o el string del TransactionID.
 * @returns {string} URL de HashScan.
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
