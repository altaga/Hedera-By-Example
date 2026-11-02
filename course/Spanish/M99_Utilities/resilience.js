/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import { AccountId, Hbar, PrivateKey, TransferTransaction } from '@hiero-ledger/sdk'
import { getMirrorNodeBaseUrl } from './config.js'
import { getState, updateState } from './storage.js'

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Límite de gas por transacción de Hedera. */
export const MAX_GAS = 15_000_000

const isInsufficientGas = (error) =>
  String(error?.status ?? '') === 'INSUFFICIENT_GAS' || /INSUFFICIENT_GAS/.test(String(error?.message ?? error))

/**
 * Ejecuta una operación de contrato y la reintenta con más gas cuando la red
 * responde INSUFFICIENT_GAS, así el lab sigue funcionando aunque cambie el costo del gas.
 * Hedera cobra al menos el 80% del límite de gas, por eso empezamos bajo y duplicamos.
 *
 * @param {(gas: number) => Promise<any>} run - Construye, ejecuta y espera el recibo/resultado usando `gas`.
 * @param {{ gas?: number, maxGas?: number }} [options]
 * @returns {Promise<any>} Lo que devuelva `run`.
 */
export const withGasRetry = async (run, { gas = 300_000, maxGas = MAX_GAS } = {}) => {
  let limit = Math.min(gas, maxGas)
  for (;;) {
    try {
      return await run(limit)
    } catch (error) {
      if (!isInsufficientGas(error) || limit >= maxGas) throw error
      limit = Math.min(limit * 2, maxGas)
      console.log(`[ℹ️ INFO] Gas insuficiente; reintentando con ${limit.toLocaleString('es-MX')} de gas...`)
    }
  }
}

/**
 * Ejecuta una transacción de contrato construida por `build(gas)` y espera su
 * recibo, reintentando con más gas ante INSUFFICIENT_GAS (ver withGasRetry).
 *
 * @param {(gas: number) => Promise<any>|any} build - Devuelve la transacción (congelada/firmada o no) para un límite de gas.
 * @param {import('@hiero-ledger/sdk').Client} client
 * @param {{ gas?: number, maxGas?: number }} [options]
 * @returns {Promise<import('@hiero-ledger/sdk').TransactionResponse>}
 */
export const executeWithGas = (build, client, options) =>
  withGasRetry(async (gas) => {
    const tx = await build(gas)
    const response = await tx.execute(client)
    await response.getReceipt(client)
    return response
  }, options)

/**
 * Consulta hasta que `check` devuelva un valor verdadero. El Mirror Node muestra
 * los datos nuevos unos segundos después del consenso, así que leer justo
 * después de escribir requiere esperar.
 *
 * @param {() => Promise<any>} check - Devuelve el valor cuando está listo, o un valor falso.
 * @param {{ timeoutMs?: number, intervalMs?: number }} [options]
 * @returns {Promise<any>} El primer valor verdadero, o null si se agota el tiempo.
 */
export const waitForMirror = async (check, { timeoutMs = 30_000, intervalMs = 2_000 } = {}) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check().catch(() => null)
    if (value) return value
    if (Date.now() >= deadline) return null
    await sleepMs(intervalMs)
  }
}

/**
 * La dirección EVM que la red usa para una cuenta: su alias si se creó desde una
 * dirección EVM, o si no la forma "long-zero" (0x0000…<num>). Derivarla de la
 * llave solo es correcto para cuentas creadas por alias.
 *
 * @param {string} accountId - p. ej. "0.0.1234"
 * @returns {Promise<string>} Dirección con prefijo 0x.
 */
export const getAccountEvmAddress = async (accountId) => {
  const data = await waitForMirror(async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
    return res.ok ? res.json() : null
  })
  if (data?.evm_address) return data.evm_address
  return '0x' + AccountId.fromString(accountId).toEvmAddress()
}

/**
 * Recarga `accountId` desde el operador del cliente cuando su saldo es menor que
 * `minHbar`, para que los labs que usan una cuenta secundaria como pagadora no
 * fallen con INSUFFICIENT_PAYER_BALANCE.
 *
 * @param {import('@hiero-ledger/sdk').Client} client - Cliente cuyo operador paga la recarga.
 * @param {string} accountId - Cuenta a fondear.
 * @param {number} minHbar - Saldo mínimo que necesita el lab.
 */
export const ensureFunded = async (client, accountId, minHbar) => {
  // Los nodos de consenso ya no atienden AccountBalanceQuery; se lee el Mirror Node.
  const account = await waitForMirror(async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
    return res.ok ? res.json() : null
  })
  const current = (account?.balance?.balance ?? 0) / 1e8
  if (current >= minHbar) return
  const topUp = Math.ceil(minHbar - current + 1)
  console.log(`[ℹ️ INFO] ${accountId} tiene ${current.toFixed(2)} ℏ; recargando ${topUp} ℏ desde el operador...`)
  const tx = await new TransferTransaction()
    .addHbarTransfer(client.operatorAccountId, new Hbar(-topUp))
    .addHbarTransfer(accountId, new Hbar(topUp))
    .execute(client)
  await tx.getReceipt(client)
}

/**
 * Devuelve una llave que puede firmar a través del relay JSON-RPC (ethers, Hardhat, …).
 * El relay asocia el firmante a una cuenta por su dirección EVM, así que solo
 * funciona con cuentas ECDSA creadas desde su dirección EVM (alias). Si el
 * operador no es una de ellas, crea una sola vez, la fondea desde el operador
 * y la recuerda en state.json (JSON_RPC_SIGNER_KEY).
 *
 * @param {import('@hiero-ledger/sdk').Client} client - Cliente del operador (paga el fondeo).
 * @param {string} operatorKey - Llave privada del operador (DER/hex).
 * @param {{ minHbar?: number }} [options]
 * @returns {Promise<{ privateKey: PrivateKey, accountId: string, evmAddress: string }>}
 */
export const getJsonRpcSigner = async (client, operatorKey, { minHbar = 10 } = {}) => {
  const operatorId = client.operatorAccountId.toString()
  const opKey = PrivateKey.fromStringDer(operatorKey)
  if (opKey.type === 'secp256k1') {
    const derived = '0x' + opKey.publicKey.toEvmAddress()
    if ((await getAccountEvmAddress(operatorId)).toLowerCase() === derived.toLowerCase()) {
      return { privateKey: opKey, accountId: operatorId, evmAddress: derived }
    }
  }

  const stored = getState('JSON_RPC_SIGNER_KEY')
  const key = stored ? PrivateKey.fromStringDer(stored) : PrivateKey.generateECDSA()
  const evmAddress = '0x' + key.publicKey.toEvmAddress()
  if (!stored) {
    console.log(`[ℹ️ INFO] ${operatorId} no tiene alias EVM, así que el relay JSON-RPC no puede asociarle su llave.`)
    console.log(`[⚙️ PROCESO] Creando una cuenta ECDSA con alias para llamadas JSON-RPC (${evmAddress})...`)
    const tx = await new TransferTransaction()
      .addHbarTransfer(client.operatorAccountId, new Hbar(-minHbar))
      .addHbarTransfer(AccountId.fromEvmAddress(0, 0, evmAddress), new Hbar(minHbar))
      .execute(client)
    await tx.getReceipt(client)
    updateState('JSON_RPC_SIGNER_KEY', key.toStringDer())
  }
  // El relay resuelve las cuentas a través del Mirror Node; esperamos a que la conozca.
  const account = await waitForMirror(async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${evmAddress}`)
    return res.ok ? (await res.json()).account : null
  }, { timeoutMs: 60_000 })
  if (!account) throw new Error(`El Mirror Node todavía no muestra ${evmAddress}; intenta de nuevo en un minuto.`)
  await ensureFunded(client, account, minHbar / 2)
  return { privateKey: key, accountId: account, evmAddress }
}

/**
 * Red de seguridad para labs que esperan suscripciones o servidores: si el
 * proceso sigue vivo después de `ms` (p. ej. una suscripción nunca entregó
 * mensajes), explica el motivo y termina con código 1. El temporizador usa
 * unref(), así que un lab que termina bien sale de inmediato sin esperarlo.
 *
 * @param {number} ms - Tiempo máximo de ejecución en milisegundos.
 * @param {string} [reason] - Qué estaba esperando el lab.
 */
export const exitIfStuck = (ms, reason = 'los eventos de red esperados') => {
  setTimeout(() => {
    console.error(`[❌ FALLO] Se agotó el tiempo (${Math.round(ms / 1000)} s) esperando ${reason}.`)
    process.exit(1)
  }, ms).unref()
}
