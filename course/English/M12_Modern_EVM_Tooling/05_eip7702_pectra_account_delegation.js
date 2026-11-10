/**
 * ============================================================================
 * Lab 05: EIP-7702 Pectra Account Delegation on Hedera JSON-RPC Relay
 * [CONCEPT] Temporary Smart Contract Code Execution for Standard EOAs
 * ============================================================================
 * [ KEY CONCEPT ]
 * In the Ethereum Pectra hard fork (EIP-7702), standard Externally Owned Accounts
 * (EOAs) can temporarily set their execution bytecode to point to an existing smart
 * contract for the duration of a transaction or session.
 *
 * Historically on EVM chains, smart contract account abstraction (ERC-4337)
 * forced users to abandon their private key EOAs and deploy costly smart contract
 * wallets (Safe, Biconomy, Kernel).
 * Under EIP-7702 (whether a given Hedera network and relay version accept Type 4
 * transactions is something to check before relying on it; this lab sends none):
 * 1. An EOA signs an Authorization Tuple: `[chainId, contractAddress, nonce, yParity, r, s]`.
 * 2. When the transaction executes, the EOA temporarily behaves AS the designated
 *    smart contract module (e.g. BatchExecutor or SessionKeyValidator).
 * 3. The user retains their original 0.0.X and 0x EVM address with zero asset migration.
 * 4. Enables 1-click atomic multi-calls (e.g. approve + swap + associate) directly
 *    from standard web3 wallets.
 *
 * [ LEARNABLE MOMENT ]
 * EIP-7702 bridges the final gap between Web2 user experience and Web3 security.
 * Combined with Hedera's sub-cent fixed transaction fees, users get seamless
 * gas-sponsored atomic batching without deploying multi-dollar smart contract proxies.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://eips.ethereum.org/EIPS/eip-7702
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 * - https://hips.hedera.com/hip/hip-1340
 * - https://hips.hedera.com/hip/hip-1341
 *
 * [ LEARNING PATH ]
 * - Previous: M12 Lab 04: Scaffold-HBAR Full-Stack Architecture (Intro)
 * - Next:     M12 Lab 06: ERC-4337 Paymaster Architecture & Gasless UserOperations
 *
 * [ SIMULATED ]
 * Hedera does not accept EIP-7702 yet (HIP-1340 ships in Release 77 but is not enabled yet): the lab signs a real Type 4
 * transaction and sends it to the JSON-RPC relay, which answers "Unsupported transaction type". The
 * delegation target (Multicall3) and the batch are real, and the batch also runs today via eth_call.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M12_Modern_EVM_Tooling/05_eip7702_pectra_account_delegation.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { PrivateKey } from '@hiero-ledger/sdk'
import { getClient, updateState, getJsonRpcUrl, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

const CHAIN_ID = 296 // Hedera Testnet
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' // deployed on Hedera testnet (0.0.7205171)
const MULTICALL3_ABI = [
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
  'function getBlockNumber() view returns (uint256)',
  'function getEthBalance(address) view returns (uint256)'
]

const main = async () => {
  console.log('--- SESSION START: EIP-7702 Pectra Account Delegation (Hedera Relay) ---\n')
  const { client, operatorId, operatorKey } = getClient()

  try {
    const provider = new ethers.JsonRpcProvider(getJsonRpcUrl(), CHAIN_ID)
    const eoa = new ethers.Wallet('0x' + PrivateKey.fromStringDer(operatorKey).toStringRaw(), provider)
    const multicall = new ethers.Interface(MULTICALL3_ABI)

    // 1. The delegator (your ECDSA account) and the implementation it delegates to
    console.log('[PROCESS] Step 1: Delegator EOA and the implementation contract...')
    const account = await (await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${operatorId}`)).json()
    console.log(`[LOG] Delegator EOA (your key):     ${eoa.address}`)
    console.log(`[LOG] Your account's EVM address:   ${account.evm_address}${account.evm_address.toLowerCase() === eoa.address.toLowerCase() ? '' : ' (no alias: Ethereum-style transactions signed by your key come from the key address above, not from this account)'}`)
    console.log(`[LOG] Delegation target:            ${MULTICALL3} (Multicall3, on Hedera testnet)`)
    console.log(`[LOG] Target Network:               Hedera Testnet (Chain ID ${CHAIN_ID})`)

    // 2. The EIP-7702 authorization: a signature over keccak256(0x05 || rlp([chainId, address, nonce]))
    console.log('\n[PROCESS] Step 2: Signing the EIP-7702 authorization...')
    const nonce = await provider.getTransactionCount(eoa.address)
    // The authorization nonce is the account nonce after this transaction's own nonce is used.
    const authorization = await eoa.authorize({ address: MULTICALL3, nonce: nonce + 1, chainId: CHAIN_ID })
    const authHash = ethers.keccak256(ethers.concat(['0x05', ethers.encodeRlp([ethers.toBeHex(CHAIN_ID), MULTICALL3.toLowerCase(), ethers.toBeHex(nonce + 1)])]))
    const recovered = ethers.recoverAddress(authHash, authorization.signature)
    if (recovered !== eoa.address) throw new Error(`Authorization signer mismatch: ${recovered}`)
    console.log(`[SUCCESS] Authorization signed (nonce ${nonce + 1}); recovered signer ${recovered}`)

    // 3. The batch: two real calls, encoded for Multicall3.aggregate3
    const calls = [
      { target: MULTICALL3, allowFailure: false, callData: multicall.encodeFunctionData('getBlockNumber') },
      { target: MULTICALL3, allowFailure: false, callData: multicall.encodeFunctionData('getEthBalance', [account.evm_address]) }
    ]
    const batchData = multicall.encodeFunctionData('aggregate3', [calls])
    console.log('\n[PROCESS] Step 3: Batch built: aggregate3([getBlockNumber(), getEthBalance(your account)])')

    // The batch already works today as a normal call to Multicall3:
    const [results] = multicall.decodeFunctionResult('aggregate3', await provider.call({ to: MULTICALL3, data: batchData }))
    const block = multicall.decodeFunctionResult('getBlockNumber', results[0].returnData)[0]
    const balance = multicall.decodeFunctionResult('getEthBalance', results[1].returnData)[0]
    console.log(`[VERIFY] Batch via eth_call to Multicall3: block ${block}, account balance ${ethers.formatUnits(balance, 8)} HBAR (inside the EVM, balances are in tinybars)`)

    // 4. The Type 4 transaction: send it to the relay and show the network's answer
    console.log('\n[PROCESS] Step 4: Sending the signed EIP-7702 (Type 4) transaction to the relay...')
    const feeData = await provider.getFeeData()
    const signedTx = await eoa.signTransaction({
      type: 4,
      chainId: CHAIN_ID,
      nonce,
      to: eoa.address, // under 7702, a call to yourself runs the delegated code
      data: batchData,
      gasLimit: 200000,
      maxFeePerGas: feeData.gasPrice,
      maxPriorityFeePerGas: 0,
      authorizationList: [authorization]
    })
    console.log(`[LOG] Signed Type 4 transaction: ${signedTx.slice(0, 18)}... (${(signedTx.length - 2) / 2} bytes)`)
    let relayAnswer
    try {
      const hash = await provider.send('eth_sendRawTransaction', [signedTx])
      relayAnswer = `accepted (${hash})`
      console.log(`[SUCCESS] Relay accepted the Type 4 transaction: ${hash}`)
    } catch (error) {
      let body = {}
      try { body = JSON.parse(error?.info?.responseBody || '{}') } catch (_) {}
      relayAnswer = body?.error?.message || error?.error?.message || error?.shortMessage || error.message
      console.log(`[INFO] Relay answer: ${relayAnswer}`)
      console.log('[INFO] Hedera does not support EIP-7702 yet (HIP-1340 ships in Release 77 but is not enabled yet), so nothing was executed or charged.')
    }

    updateState('EIP7702_DELEGATION_CONTRACT', MULTICALL3)
    updateState('EIP7702_LAST_AUTH_HASH', authHash)
    updateState('EIP7702_LAST_RELAY_ANSWER', relayAnswer)

    console.log('\n KEY CONCEPT:')
    console.log('No per-user proxy: traditional smart accounts deploy a contract for every user. With EIP-7702')
    console.log('an EOA points to one already-deployed implementation, so each user only signs an authorization.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('The authorization is a plain signature over (chainId, contract, nonce): anyone can verify it, as')
    console.log('step 2 did. Executing it needs a network and relay that accept Type 4 transactions.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] EIP-7702 Execution Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
