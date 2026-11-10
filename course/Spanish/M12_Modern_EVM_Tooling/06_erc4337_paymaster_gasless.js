/**
 * ============================================================================
 * Lab 06: Arquitectura Paymaster ERC-4337 y Operaciones de Usuario Sin Gas
 * [CONCEPTO] Verificación de Patrocinio de Gas con Paymaster en el Relay JSON-RPC
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En la adopción masiva de Web3 y la operación de agentes de IA autónomos, los
 * usuarios finales y agentes de software no cuentan con criptomoneda nativa (HBAR o ETH)
 * en sus billeteras recién creadas. Forzar a los usuarios a comprar cripto antes de su
 * primera interacción es una de las mayores barreras de entrada.
 *
 * La abstracción de cuentas ERC-4337 resuelve esto mediante el patrocinio de Paymaster:
 * 1. Estructura UserOperation: El usuario o agente firma una estructura de pseudotransacción
 *    que contiene la carga útil de ejecución, límites de gas y nonce del emisor.
 * 2. Paymaster Empresarial: Un patrocinador institucional (o dApp promocional)
 *    evalúa la UserOperation frente a sus políticas de patrocinio (ej. KYC, cuotas diarias).
 * 3. Firma de Paymaster: El Paymaster firma la UserOperation y adjunta su dirección
 *    y datos de autorización en el campo `paymasterAndData`.
 * 4. Incorporación con Cero Gas: El Bundler envía la UserOperation al contrato EntryPoint
 *    (v0.6, 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789)
 *    en Hedera. El Paymaster asume el costo del gas mientras el usuario disfruta de
 *    una experiencia completamente sin gas.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las comisiones de Hedera están fijadas en USD, así que un Paymaster puede presupuestar su
 * patrocinio con exactitud en vez de absorber picos del precio del gas. Las firmas son lo que
 * hace seguro el esquema: el EntryPoint solo gasta el depósito del Paymaster en una
 * UserOperation que el propio Paymaster firmó.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://eips.ethereum.org/EIPS/eip-4337
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M12 Lab 05: Delegación de Cuentas EIP-7702 Pectra en el Relay JSON-RPC de Hedera
 * - Siguiente: M13 Lab 01: Protocolo Cross-Ledger (CLPR) y Pruebas Criptográficas de Estado (HIP-1535)
 *
 * [ SECUENCIA ]
 * Usuario -> Lab: Firma una UserOperation para su smart account (que tiene 0 HBAR)
 * Firmante del paymaster -> Lab: Firma el patrocinio (paymasterAndData)
 * Bundler (tú) -> EntryPoint: handleOps([userOp], beneficiario)
 * EntryPoint -> Cuenta: validateUserOp (firma del dueño)
 * EntryPoint -> Paymaster: validatePaymasterUserOp (firma del patrocinador)
 * EntryPoint -> Cuenta: increment(); el gas se cobra del depósito del paymaster
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (despliega los contratos, fondea el paymaster y actúa como bundler).
 * - Wallets de práctica: ACCOUNT_1 (el usuario que firma la UserOperation; no paga nada).
 * - Costo: ~35 ℏ la primera vez (dos contratos, cerca de 2 USD, más un depósito de 5 ℏ para el paymaster que puedes retirar); ~1 ℏ al volver a ejecutarlo (gas del bundler, en parte reembolsado del depósito).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M12_Modern_EVM_Tooling/06_erc4337_paymaster_gasless.js
 * ============================================================================
 */

import fs from 'node:fs'
import { ethers } from 'ethers'
import { AccountId, ContractCreateTransaction, ContractExecuteTransaction, ContractId, Hbar, PrivateKey } from '@hiero-ledger/sdk'
import solc from 'solc'
import { getClient, updateState, requireEnv, getJsonRpcUrl, executeWithGas, reuseContract, getHashscanUrl, waitForMirror } from '../M99_Utilities/index.js'

const ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' // EntryPoint v0.6 de ERC-4337, en Hedera testnet
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
  const input = { language: 'Solidity', sources: { 'Erc4337.sol': { content: source } }, settings: { evmVersion: 'cancun', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.bytecode.object'] } } } } // la EVM de Hedera soporta hasta Cancun
  const out = JSON.parse(solc.compile(JSON.stringify(input)))
  const fatal = (out.errors || []).filter((e) => e.severity === 'error')
  if (fatal.length) throw new Error(`Error de compilación de Solidity: ${fatal[0].formattedMessage}`)
  return { account: out.contracts['Erc4337.sol'].HbeAccount.evm.bytecode.object, paymaster: out.contracts['Erc4337.sol'].HbePaymaster.evm.bytecode.object }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Paymaster ERC-4337 y UserOperation sin Gas (EntryPoint v0.6) ---\n')
  const { client, operatorId, operatorKey } = getClient()

  try {
    const provider = new ethers.JsonRpcProvider(getJsonRpcUrl(), 296)
    const call = async (to, iface, fn, args = []) => iface.decodeFunctionResult(fn, await provider.call({ to, data: iface.encodeFunctionData(fn, args) }))[0]
    const user = new ethers.Wallet('0x' + PrivateKey.fromStringDer(requireEnv('ACCOUNT_1_PRIVATE_KEY')).toStringRaw())
    const sponsor = new ethers.Wallet('0x' + PrivateKey.fromStringDer(operatorKey).toStringRaw())
    const entryPointId = ContractId.fromEvmAddress(0, 0, ENTRY_POINT)
    console.log(`[REGISTRO] EntryPoint v0.6: ${ENTRY_POINT}`)
    console.log(`[REGISTRO] Usuario (dueño de la cuenta, llave de ACCOUNT_1): ${user.address}`)
    console.log(`[REGISTRO] Firmante del paymaster (tu llave):             ${sponsor.address}`)

    // 1. Desplegar (o reutilizar) la smart account y el paymaster
    console.log('\n[PROCESO] Paso 1: Desplegando la smart account y el paymaster verificador...')
    const code = compile()
    // El initcode en línea ya debe terminar con los argumentos del constructor codificados en ABI.
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
    console.log(`[ÉXITO] Smart account ${accountId} (${sender})`)
    console.log(`[ÉXITO] Paymaster     ${paymasterId} (${paymaster})`)

    // 2. Fondear el depósito del paymaster en el EntryPoint (la cuenta no tiene nada)
    let deposit = await call(ENTRY_POINT, entryPointAbi, 'balanceOf', [paymaster])
    if (deposit < 200_000_000n) {
      console.log('\n[PROCESO] Paso 2: Depositando 5 ℏ para el paymaster en el EntryPoint...')
      const res = await new ContractExecuteTransaction().setContractId(paymasterId).setGas(120000).setPayableAmount(new Hbar(5)).setFunction('deposit').execute(client)
      await res.getReceipt(client)
      // El relay lee el estado del Mirror Node, unos segundos detrás del consenso.
      deposit = await waitForMirror(async () => {
        const value = await call(ENTRY_POINT, entryPointAbi, 'balanceOf', [paymaster])
        return value >= 200_000_000n ? value : null
      }, { timeoutMs: 30_000 }) ?? await call(ENTRY_POINT, entryPointAbi, 'balanceOf', [paymaster])
    }
    const accountBalance = await provider.getBalance(sender)
    console.log(`[REGISTRO] Depósito del paymaster: ${ethers.formatUnits(deposit, 8)} HBAR | saldo de la smart account: ${ethers.formatEther(accountBalance)} HBAR`)

    // 3. Armar la UserOperation (v0.6) que llama a increment() en la cuenta
    console.log('\n[PROCESO] Paso 3: Armando y firmando la UserOperation...')
    const gasPriceTinybars = (await provider.getFeeData()).gasPrice / 10_000_000_000n // el relay cotiza en weibars; la EVM cuenta en tinybars
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
    // El patrocinador firma la operación (sin paymasterAndData) y luego el usuario firma el userOpHash completo.
    const sponsorHash = await call(paymaster, paymasterAbi, 'getHash', [userOp])
    userOp.paymasterAndData = ethers.concat([paymaster, await sponsor.signMessage(ethers.getBytes(sponsorHash))])
    const userOpHash = await call(ENTRY_POINT, entryPointAbi, 'getUserOpHash', [userOp])
    userOp.signature = await user.signMessage(ethers.getBytes(userOpHash))
    console.log(`[REGISTRO] Nonce ${userOp.nonce} | userOpHash (del EntryPoint): ${userOpHash}`)
    console.log(`[REGISTRO] paymasterAndData: ${paymaster} + firma del patrocinador`)

    // 4. Bundle: tú envías handleOps al EntryPoint; el depósito del paymaster paga la operación
    const counterBefore = await call(sender, accountAbi, 'counter')
    console.log('\n[PROCESO] Paso 4: El bundler envía EntryPoint.handleOps([userOp], beneficiario)...')
    const beneficiary = '0x' + AccountId.fromString(operatorId.toString()).toEvmAddress()
    const handleOps = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(entryPointId)
      .setGas(gas)
      .setFunctionParameters(Buffer.from(entryPointAbi.encodeFunctionData('handleOps', [[userOp], beneficiary]).slice(2), 'hex')), client, { gas: 600000 })
    const record = await handleOps.getRecord(client)
    console.log(`[ÉXITO] Estado de handleOps: ${record.receipt.status.toString()}`)
    console.log(`[EXPLORADOR] ${getHashscanUrl(handleOps)}`)

    // 5. Verificar on-chain: el evento, el contador, quién pagó
    const topic = entryPointAbi.getEvent('UserOperationEvent').topicHash
    const log = (record.contractFunctionResult?.logs || []).find((l) => '0x' + Buffer.from(l.topics[0]).toString('hex') === topic)
    if (!log) throw new Error('No hay UserOperationEvent en el registro de handleOps')
    const event = entryPointAbi.decodeEventLog('UserOperationEvent', '0x' + Buffer.from(log.data).toString('hex'), log.topics.map((t) => '0x' + Buffer.from(t).toString('hex')))
    if (!event.success) throw new Error('El EntryPoint ejecutó la UserOperation pero su llamada falló')
    const counterAfter = await waitForMirror(async () => {
      const value = await call(sender, accountAbi, 'counter')
      return value > counterBefore ? value : null
    }, { timeoutMs: 30_000 }) ?? await call(sender, accountAbi, 'counter')
    const depositAfter = await call(ENTRY_POINT, entryPointAbi, 'balanceOf', [paymaster])
    console.log(`[VERIFY] UserOperationEvent: success=${event.success}, paymaster=${event.paymaster}, gas usado ${event.actualGasUsed}`)
    console.log(`[VERIFY] Contador de la cuenta: ${counterBefore} -> ${counterAfter}`)
    console.log(`[VERIFY] Depósito del paymaster: ${ethers.formatUnits(deposit, 8)} -> ${ethers.formatUnits(depositAfter, 8)} HBAR (le pagó ${ethers.formatUnits(event.actualGasCost, 8)} HBAR al bundler)`)
    console.log(`[VERIFY] Saldo de la smart account: ${ethers.formatEther(await provider.getBalance(sender))} HBAR (el usuario no pagó nada)`)

    updateState('ERC4337_ACCOUNT', sender)
    updateState('ERC4337_PAYMASTER', paymaster)
    updateState('ERC4337_LAST_USEROP_HASH', userOpHash)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Incorporación sin gas: el usuario solo firmó. El bundler envió la transacción, el')
    console.log('EntryPoint comprobó ambas firmas, ejecutó la llamada y cobró del depósito del paymaster.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('El paymaster firma un hash que excluye su propio campo de firma; el usuario firma el')
    console.log('userOpHash completo que calcula el EntryPoint. Si falla cualquiera de las dos firmas, la operación se detiene.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló ERC-4337:', error.message)
    process.exitCode = 1
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de Ejecución:', error.message)
      process.exit(1)
    })
}
