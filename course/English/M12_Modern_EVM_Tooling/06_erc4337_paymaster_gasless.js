/**
 * ============================================================================
 * Lab 06: ERC-4337 Paymaster Architecture & Gasless UserOperations
 * [CONCEPT] Verifying Paymaster Gas Sponsorship on Hedera JSON-RPC Relay
 * ============================================================================
 * [ KEY CONCEPT ]
 * In mainstream web3 onboarding and autonomous AI agent operations, end users
 * and software agents do not have native cryptocurrency (HBAR or ETH) in their
 * newly generated wallets. Forcing users to purchase crypto before their first
 * interaction is one of the biggest onboarding barriers.
 *
 * ERC-4337 Account Abstraction solves this via Paymaster Gas Sponsorship:
 * 1. UserOperation Struct: The user or agent signs a pseudo-transaction struct
 *    containing execution payload, call limits, and sender nonce.
 * 2. Enterprise Paymaster: An institutional sponsor (or promotional dApp)
 *    evaluates the UserOperation against sponsorship policies (e.g. KYC, daily quotas).
 * 3. Paymaster Signature: The Paymaster signs the UserOperation and appends its
 *    address and authorization data to `paymasterAndData`.
 * 4. Zero-Gas Onboarding: The Bundler submits the UserOperation to the EntryPoint
 *    contract on Hedera. The Paymaster pays the gas fees while the user/agent
 *    enjoys completely gasless, seamless onboarding.
 *
 * [ LEARNABLE MOMENT ]
 * Hedera's fees are fixed in USD, so a Paymaster can budget its sponsorship
 * exactly instead of absorbing gas-price spikes. The signatures are what make the
 * scheme safe: the EntryPoint only spends the Paymaster's deposit for a
 * UserOperation the Paymaster itself signed.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://eips.ethereum.org/EIPS/eip-4337
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 *
 * [ LEARNING PATH ]
 * - Previous: M12 Lab 05: EIP-7702 Pectra Account Delegation on Hedera JSON-RPC Relay
 * - Next:     M12 Lab 07: BLS12-381 Aggregate Signatures with the Pectra Precompiles
 *
 * [ SEQUENCE ]
 * User -> Lab: Signs a UserOperation for their smart account (it holds 0 HBAR)
 * Paymaster signer -> Lab: Signs the sponsorship (paymasterAndData)
 * Bundler (you) -> EntryPoint: handleOps([userOp], beneficiary)
 * EntryPoint -> Account: validateUserOp (owner signature)
 * EntryPoint -> Paymaster: validatePaymasterUserOp (sponsor signature)
 * EntryPoint -> Account: increment(); gas is charged to the paymaster's deposit
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it deploys the contracts, funds the paymaster and acts as the bundler).
 * - Practice wallets: ACCOUNT_1 (the user who signs the UserOperation; it pays nothing).
 * - Cost: ~35 ℏ the first time (two contracts, about 2 USD, plus a 5 ℏ paymaster deposit you can withdraw); ~1 ℏ when you run it again (bundler gas, partly refunded from the deposit).
 *
 * [ HOW TO RUN ]
 * node English/M12_Modern_EVM_Tooling/06_erc4337_paymaster_gasless.js
 * ============================================================================
 */

import fs from 'node:fs'
import { ethers } from 'ethers'
import { AccountId, ContractCreateTransaction, ContractExecuteTransaction, ContractId, Hbar, PrivateKey } from '@hiero-ledger/sdk'
import solc from 'solc'
import { getClient, updateState, requireEnv, getJsonRpcUrl, executeWithGas, reuseContract, getHashscanUrl, waitForMirror } from '../M99_Utilities/index.js'

const ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' // ERC-4337 EntryPoint v0.6, on Hedera testnet
const USER_OP = 'tuple(address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature)'
const entryPointAbi = new ethers.Interface([
  `function handleOps(${USER_OP}[] ops, address beneficiary)`,
  `function getUserOpHash(${USER_OP} userOp) view returns (bytes32)`,
  'function getNonce(address sender, uint192 key) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
])
const accountAbi = new ethers.Interface(['function increment()', 'function counter() view returns (uint256)'])
const paymasterAbi = new ethers.Interface([`function getHash(${USER_OP} userOp) view returns (bytes32)`])

const compile = () => {
  const source = fs.readFileSync(new URL('./06_erc4337_contracts.sol', import.meta.url), 'utf8')
  const input = { language: 'Solidity', sources: { 'Erc4337.sol': { content: source } }, settings: { evmVersion: 'prague', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.bytecode.object'] } } } } // Pectra (HIP-1341) is live since Release 77: compile solc >= 0.8.31 for prague
  const out = JSON.parse(solc.compile(JSON.stringify(input)))
  const fatal = (out.errors || []).filter((e) => e.severity === 'error')
  if (fatal.length) throw new Error(`Solidity compilation error: ${fatal[0].formattedMessage}`)
  return { account: out.contracts['Erc4337.sol'].HbeAccount.evm.bytecode.object, paymaster: out.contracts['Erc4337.sol'].HbePaymaster.evm.bytecode.object }
}

const main = async () => {
  console.log('--- SESSION START: ERC-4337 Paymaster & Gasless UserOperation (EntryPoint v0.6) ---\n')
  const { client, operatorId, operatorKey } = getClient()

  try {
    const provider = new ethers.JsonRpcProvider(getJsonRpcUrl(), 296)
    const call = async (to, iface, fn, args = []) => iface.decodeFunctionResult(fn, await provider.call({ to, data: iface.encodeFunctionData(fn, args) }))[0]
    const user = new ethers.Wallet('0x' + PrivateKey.fromStringDer(requireEnv('ACCOUNT_1_PRIVATE_KEY')).toStringRaw())
    const sponsor = new ethers.Wallet('0x' + PrivateKey.fromStringDer(operatorKey).toStringRaw())
    const entryPointId = ContractId.fromEvmAddress(0, 0, ENTRY_POINT)
    console.log(`[LOG] EntryPoint v0.6: ${ENTRY_POINT}`)
    console.log(`[LOG] User (account owner, ACCOUNT_1 key): ${user.address}`)
    console.log(`[LOG] Paymaster signer (your key):         ${sponsor.address}`)

    // 1. Deploy (or reuse) the smart account and the paymaster
    console.log('\n[PROCESS] Step 1: Deploying the smart account and the verifying paymaster...')
    const code = compile()
    // Inline initcode must already end with the ABI-encoded constructor arguments.
    const deploy = (stateKey, bytecode, owner) => {
      const initcode = bytecode + ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address'], [ENTRY_POINT, owner]).slice(2)
      return reuseContract(stateKey, initcode, async () => {
        const res = await executeWithGas((gas) => new ContractCreateTransaction().setBytecode(Buffer.from(initcode, 'hex')).setGas(gas), client, { gas: 400000 })
        return (await res.getReceipt(client)).contractId
      })
    }
    const accountId = await deploy('REUSE_M12_06_ACCOUNT', code.account, user.address)
    const paymasterId = await deploy('REUSE_M12_06_PAYMASTER', code.paymaster, sponsor.address)
    const sender = '0x' + accountId.toEvmAddress()
    const paymaster = '0x' + paymasterId.toEvmAddress()
    console.log(`[SUCCESS] Smart account ${accountId} (${sender})`)
    console.log(`[SUCCESS] Paymaster     ${paymasterId} (${paymaster})`)

    // 2. Fund the paymaster's deposit in the EntryPoint (the account itself holds nothing)
    let deposit = await call(ENTRY_POINT, entryPointAbi, 'balanceOf', [paymaster])
    if (deposit < 200_000_000n) {
      console.log('\n[PROCESS] Step 2: Depositing 5 ℏ for the paymaster in the EntryPoint...')
      const res = await new ContractExecuteTransaction().setContractId(paymasterId).setGas(120000).setPayableAmount(new Hbar(5)).setFunction('deposit').execute(client)
      await res.getReceipt(client)
      // The relay reads Mirror Node state, a few seconds behind consensus.
      deposit = await waitForMirror(async () => {
        const value = await call(ENTRY_POINT, entryPointAbi, 'balanceOf', [paymaster])
        return value >= 200_000_000n ? value : null
      }, { timeoutMs: 30_000 }) ?? await call(ENTRY_POINT, entryPointAbi, 'balanceOf', [paymaster])
    }
    const accountBalance = await provider.getBalance(sender)
    console.log(`[LOG] Paymaster deposit: ${ethers.formatUnits(deposit, 8)} HBAR | smart account balance: ${ethers.formatEther(accountBalance)} HBAR`)

    // 3. Build the UserOperation (v0.6) that calls increment() on the account
    console.log('\n[PROCESS] Step 3: Building and signing the UserOperation...')
    const gasPriceTinybars = (await provider.getFeeData()).gasPrice / 10_000_000_000n // relay quotes weibars; the EVM counts tinybars
    const userOp = {
      sender,
      nonce: await call(ENTRY_POINT, entryPointAbi, 'getNonce', [sender, 0]),
      initCode: '0x',
      callData: accountAbi.encodeFunctionData('increment'),
      callGasLimit: 100000n,
      verificationGasLimit: 150000n,
      preVerificationGas: 50000n,
      maxFeePerGas: gasPriceTinybars,
      maxPriorityFeePerGas: gasPriceTinybars,
      paymasterAndData: '0x',
      signature: '0x'
    }
    // The sponsor signs the operation (without paymasterAndData), then the user signs the full userOpHash.
    const sponsorHash = await call(paymaster, paymasterAbi, 'getHash', [userOp])
    userOp.paymasterAndData = ethers.concat([paymaster, await sponsor.signMessage(ethers.getBytes(sponsorHash))])
    const userOpHash = await call(ENTRY_POINT, entryPointAbi, 'getUserOpHash', [userOp])
    userOp.signature = await user.signMessage(ethers.getBytes(userOpHash))
    console.log(`[LOG] Nonce ${userOp.nonce} | userOpHash (from the EntryPoint): ${userOpHash}`)
    console.log(`[LOG] paymasterAndData: ${paymaster} + sponsor signature`)

    // 4. Bundle: you submit handleOps to the EntryPoint; the paymaster's deposit pays for the operation
    const counterBefore = await call(sender, accountAbi, 'counter')
    console.log('\n[PROCESS] Step 4: Bundler submits EntryPoint.handleOps([userOp], beneficiary)...')
    const beneficiary = '0x' + AccountId.fromString(operatorId.toString()).toEvmAddress()
    const handleOps = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(entryPointId)
      .setGas(gas)
      .setFunctionParameters(Buffer.from(entryPointAbi.encodeFunctionData('handleOps', [[userOp], beneficiary]).slice(2), 'hex')), client, { gas: 600000 })
    const record = await handleOps.getRecord(client)
    console.log(`[SUCCESS] handleOps status: ${record.receipt.status.toString()}`)
    console.log(`[EXPLORER] ${getHashscanUrl(handleOps)}`)

    // 5. Verify on-chain: the event, the counter, who paid
    const topic = entryPointAbi.getEvent('UserOperationEvent').topicHash
    const log = (record.contractFunctionResult?.logs || []).find((l) => '0x' + Buffer.from(l.topics[0]).toString('hex') === topic)
    if (!log) throw new Error('No UserOperationEvent in the handleOps record')
    const event = entryPointAbi.decodeEventLog('UserOperationEvent', '0x' + Buffer.from(log.data).toString('hex'), log.topics.map((t) => '0x' + Buffer.from(t).toString('hex')))
    if (!event.success) throw new Error('The EntryPoint ran the UserOperation but its call failed')
    const counterAfter = await waitForMirror(async () => {
      const value = await call(sender, accountAbi, 'counter')
      return value > counterBefore ? value : null
    }, { timeoutMs: 30_000 }) ?? await call(sender, accountAbi, 'counter')
    const depositAfter = await call(ENTRY_POINT, entryPointAbi, 'balanceOf', [paymaster])
    console.log(`[VERIFY] UserOperationEvent: success=${event.success}, paymaster=${event.paymaster}, gas used ${event.actualGasUsed}`)
    console.log(`[VERIFY] Account counter: ${counterBefore} -> ${counterAfter}`)
    console.log(`[VERIFY] Paymaster deposit: ${ethers.formatUnits(deposit, 8)} -> ${ethers.formatUnits(depositAfter, 8)} HBAR (it paid ${ethers.formatUnits(event.actualGasCost, 8)} HBAR to the bundler)`)
    console.log(`[VERIFY] Smart account balance: ${ethers.formatEther(await provider.getBalance(sender))} HBAR (the user paid nothing)`)

    updateState('ERC4337_ACCOUNT', sender)
    updateState('ERC4337_PAYMASTER', paymaster)
    updateState('ERC4337_LAST_USEROP_HASH', userOpHash)

    console.log('\n KEY CONCEPT:')
    console.log('Gasless Onboarding: the user only signed. The bundler sent the transaction, the')
    console.log('EntryPoint checked both signatures, ran the call, and charged the paymaster\'s deposit.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('The paymaster signs a hash that excludes its own signature field; the user signs the')
    console.log('full userOpHash computed by the EntryPoint. Either signature failing stops the operation.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] ERC-4337 Failure:', error.message)
    process.exitCode = 1
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
