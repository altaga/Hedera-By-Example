import { createHash } from 'crypto'
import { AccountCreateTransaction, AccountId, ContractCreateFlow, ContractCreateTransaction, ContractExecuteTransaction, ContractId, Hbar, PrivateKey, TokenId, TopicId, TransferTransaction } from '@hiero-ledger/sdk'
import { getMirrorNodeBaseUrl, parsePrivateKey } from './config.js'
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
      console.log(`[INFO] Gas insuficiente; reintentando con ${limit.toLocaleString('es-MX')} de gas...`)
    }
  }
}

/**
 * Pide al Mirror Node simular un despliegue o una llamada a contrato
 * (POST /api/v1/contracts/call con estimate: true). Es gratis y no toca el
 * ledger. Devuelve { gas } si funciona, { revert } si la simulación revierte,
 * o null cuando la transacción no se puede simular (por ejemplo, bytecode
 * guardado en un archivo).
 *
 * @param {any} tx - ContractCreateTransaction, ContractCreateFlow o ContractExecuteTransaction.
 * @param {import('@hiero-ledger/sdk').Client} client - Su operador es el remitente simulado.
 * @returns {Promise<{ gas?: number, revert?: string } | null>}
 */
const hexOf = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value.replace(/^0x/i, '')
  if (typeof value._build === 'function') return Buffer.from(value._build()).toString('hex')
  return Buffer.from(value).toString('hex')
}

export const estimateGas = async (tx, client) => {
  let body
  if (tx instanceof ContractCreateTransaction || tx instanceof ContractCreateFlow) {
    if (!tx.bytecode || !tx.bytecode.length) return null
    body = { data: '0x' + hexOf(tx.bytecode) + hexOf(tx.constructorParameters) }
  } else if (tx instanceof ContractExecuteTransaction && tx.contractId) {
    body = { to: '0x' + tx.contractId.toEvmAddress(), data: '0x' + hexOf(tx.functionParameters) }
    const value = tx.payableAmount ? Number(tx.payableAmount.toTinybars()) : 0
    if (value) body.value = value
  } else {
    return null
  }
  try {
    body.from = await getAccountEvmAddress(client.operatorAccountId.toString())
    body.estimate = true
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.result) return { gas: parseInt(data.result, 16) }
    const message = data?._status?.messages?.[0]?.message
    return message && /REVERT/i.test(message) ? { revert: message } : null
  } catch (_) {
    return null
  }
}

/**
 * Ejecuta una transacción de contrato construida por `build(gas)` y espera su
 * recibo. El límite de gas sale de una simulación gratuita en el Mirror Node
 * más 25% (Hedera cobra al menos el 80% del límite, así que ese margen no
 * cuesta nada); si aun así la red responde INSUFFICIENT_GAS, reintenta con más.
 *
 * @param {(gas: number) => Promise<any>|any} build - Devuelve la transacción (congelada/firmada o no) para un límite de gas.
 * @param {import('@hiero-ledger/sdk').Client} client
 * @param {{ gas?: number, maxGas?: number }} [options] - gas: el límite inicial cuando la simulación no está disponible.
 */
export const executeWithGas = async (build, client, options = {}) => {
  let start = options.gas
  const probe = await build(options.gas ?? 300_000)
  const est = await estimateGas(probe, client).catch(() => null)
  // Calls to system contracts (HTS, HSS, ...) can simulate far above what they use: a
  // failed call attempt costs little, so above 3M gas the lab's limit and the retry decide.
  const isCall = probe instanceof ContractExecuteTransaction
  if (est?.gas && isCall && est.gas > 3_000_000) {
    console.log(`[INFO] La simulación pidió ${est.gas.toLocaleString('es-MX')} de gas, poco realista para una llamada (los contratos del sistema son difíciles de simular): se parte del límite del lab.`)
  } else if (est?.gas) {
    start = Math.min(options.maxGas ?? MAX_GAS, Math.ceil(est.gas * 1.25) + 5_000)
    console.log(`[INFO] Gas estimado por simulación: ${est.gas.toLocaleString('es-MX')} → límite ${start.toLocaleString('es-MX')} (+25%).`)
  } else if (est?.revert) {
    console.log(`[INFO] La simulación revirtió (${est.revert}). Corre sobre el estado del Mirror Node, que puede ir unos segundos atrás, así que la transacción se envía de todos modos con el límite de gas del lab.`)
  }
  return withGasRetry(async (gas) => {
    const tx = await build(gas)
    const response = await tx.execute(client)
    await response.getReceipt(client)
    return response
  }, { ...options, gas: start })
}

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
  const topUp = Math.ceil(minHbar - current)
  console.log(`[INFO] ${accountId} tiene ${current.toFixed(2)} ℏ; recargando ${topUp} ℏ desde el operador...`)
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
export const getJsonRpcSigner = async (client, operatorKey, { minHbar = 5 } = {}) => {
  const operatorId = client.operatorAccountId.toString()
  const opKey = parsePrivateKey(operatorKey)
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
    console.log(`[INFO] ${operatorId} no tiene alias EVM, así que el relay JSON-RPC no puede asociarle su llave.`)
    console.log(`[PROCESO] Creando una cuenta ECDSA con alias para llamadas JSON-RPC (${evmAddress})...`)
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
    console.error(`[FALLO] Se agotó el tiempo (${Math.round(ms / 1000)} s) esperando ${reason}.`)
    process.exit(1)
  }, ms).unref()
}

/**
 * Crear un token cuesta cerca de 1 USD en HBAR, el paso más caro de casi
 * todos los labs. Si el lab ya creó su token en una ejecución anterior, se
 * reutiliza mientras exista, no esté pausado y el operador actual siga siendo
 * su tesorería (y una colección NFT limitada esté acuñada menos de la mitad). Usa FRESH_TOKENS=1 para crear siempre uno nuevo.
 *
 * @param {string} stateKey - Dónde se guarda el ID del token (state.json).
 * @param {() => Promise<import('@hiero-ledger/sdk').TokenId|string>} create - Crea el token y devuelve su ID.
 * @param {{ check?: (token: any) => boolean, minBalance?: number, treasury?: string }} [options] - Condición extra sobre el registro del token en el Mirror Node, el saldo que la tesorería todavía debe tener para que el lab funcione y la cuenta tesorería cuando no es el operador.
 * @returns {Promise<TokenId>}
 */
export const reuseToken = async (stateKey, create, { check = () => true, minBalance = 0, treasury } = {}) => {
  const operator = process.env.OPERATOR_ID
  const [savedId, owner] = String(getState(stateKey) || '').split('@')
  if (process.env.FRESH_TOKENS !== '1' && savedId && owner === operator) {
    const token = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/tokens/${savedId}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
    if (token && !token.deleted && token.treasury_account_id === String(treasury ?? operator) && token.pause_status !== 'PAUSED' && !(token.type === 'NON_FUNGIBLE_UNIQUE' && token.supply_type === 'FINITE' && Number(token.total_supply) * 2 > Number(token.max_supply)) && check(token)) {
      const enough = minBalance <= 0 || await fetch(`${getMirrorNodeBaseUrl()}/api/v1/tokens/${savedId}/balances?account.id=${treasury ?? operator}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => Number(data?.balances?.[0]?.balance ?? 0) >= minBalance)
        .catch(() => false)
      if (enough) {
        console.log(`[INFO] Reutilizando el token ${savedId} de una ejecución anterior (crear uno cuesta cerca de 1 USD). Usa FRESH_TOKENS=1 para crear uno nuevo.`)
        return TokenId.fromString(savedId)
      }
    }
  }
  const tokenId = TokenId.fromString(String(await create()))
  updateState(stateKey, `${tokenId}@${operator}`)
  return tokenId
}

/**
 * Un serial de `tokenId` que `accountId` todavía tiene (el menor), o null.
 * Los labs que mueven un NFT lo usan en vez de un serial fijo, así siguen
 * funcionando aunque una ejecución anterior ya haya enviado el serial #1.
 *
 * @param {string} tokenId
 * @param {string} accountId
 * @returns {Promise<number|null>}
 */
export const findOwnedSerial = async (tokenId, accountId) => {
  const data = await waitForMirror(async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}/nfts?token.id=${tokenId}&order=asc&limit=1`)
    return res.ok ? res.json() : null
  }, { timeoutMs: 10_000 })
  return data?.nfts?.[0]?.serial_number ?? null
}

/**
 * Desplegar un contrato cuesta cerca de 1 USD en HBAR más el gas. Si el lab ya
 * desplegó el mismo contrato (mismo bytecode y argumentos del constructor, en
 * `identity`) en una ejecución anterior, se reutiliza mientras exista y lo haya
 * desplegado el operador actual. Usa FRESH_CONTRACTS=1 para desplegar siempre uno nuevo.
 *
 * @param {string} stateKey - Dónde se guarda el ID del contrato (state.json).
 * @param {string} identity - El bytecode más lo que haga único este despliegue.
 * @param {() => Promise<import('@hiero-ledger/sdk').ContractId|string>} deploy - Despliega y devuelve el ID del contrato.
 * @returns {Promise<ContractId>}
 */
export const reuseContract = async (stateKey, identity, deploy) => {
  const operator = process.env.OPERATOR_ID
  // Solidity agrega un hash de metadatos que cambia con comentarios/espacios del código fuente: se ignora.
  const code = String(identity).replace(/a264697066735822[0-9a-f]{68}64736f6c6343[0-9a-f]{6}0033/gi, '')
  const codeHash = createHash('sha256').update(code).digest('hex').slice(0, 16)
  const [savedId, owner, savedHash] = String(getState(stateKey) || '').split('@')
  if (process.env.FRESH_CONTRACTS !== '1' && savedId && owner === operator && savedHash === codeHash) {
    const contract = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/${savedId}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
    if (contract && !contract.deleted) {
      console.log(`[INFO] Reutilizando el contrato ${savedId} de una ejecución anterior (mismo bytecode; desplegar cuesta cerca de 1 USD más gas). Usa FRESH_CONTRACTS=1 para desplegar uno nuevo.`)
      return ContractId.fromString(savedId)
    }
  }
  const contractId = ContractId.fromString(String(await deploy()))
  updateState(stateKey, `${contractId}@${operator}@${codeHash}`)
  return contractId
}

/**
 * Crear un tópico con comisiones personalizadas (HIP-991) cuesta cerca de 2 USD
 * en HBAR. Si el lab ya creó su tópico en una ejecución anterior, se reutiliza
 * mientras exista, lo haya creado el operador actual y pase `check`. Usa
 * FRESH_TOPICS=1 para crear siempre uno nuevo.
 *
 * @param {string} stateKey - Dónde se guarda el ID del tópico (state.json).
 * @param {() => Promise<import('@hiero-ledger/sdk').TopicId|string>} create - Crea el tópico y devuelve su ID.
 * @param {{ check?: (topic: any) => boolean }} [options] - Condición extra sobre el registro del tópico en el Mirror Node.
 * @returns {Promise<TopicId>}
 */
export const reuseTopic = async (stateKey, create, { check = () => true } = {}) => {
  const operator = process.env.OPERATOR_ID
  const [savedId, owner] = String(getState(stateKey) || '').split('@')
  if (process.env.FRESH_TOPICS !== '1' && savedId && owner === operator) {
    const topic = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/topics/${savedId}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
    if (topic && !topic.deleted && check(topic)) {
      console.log(`[INFO] Reutilizando el tópico ${savedId} de una ejecución anterior. Usa FRESH_TOPICS=1 para crear uno nuevo.`)
      return TopicId.fromString(savedId)
    }
  }
  const topicId = TopicId.fromString(String(await create()))
  updateState(stateKey, `${topicId}@${operator}`)
  return topicId
}

/**
 * Crea una cuenta desechable de testnet financiada por el operador (montos mínimos),
 * para labs que necesitan partes distintas. Las cuentas ECDSA reciben alias EVM.
 *
 * @returns {Promise<{accountId: AccountId, privateKey: PrivateKey}>}
 */
export const createLabAccount = async (client, { hbar = 0.1, ecdsa = false, autoAssociations = -1 } = {}) => {
  const privateKey = ecdsa ? PrivateKey.generateECDSA() : PrivateKey.generateED25519()
  const tx = new AccountCreateTransaction()
    .setInitialBalance(new Hbar(hbar))
    .setMaxAutomaticTokenAssociations(autoAssociations)
  if (ecdsa) tx.setECDSAKeyWithAlias(privateKey)
  else tx.setKeyWithoutAlias(privateKey.publicKey)
  const receipt = await (await tx.execute(client)).getReceipt(client)
  return { accountId: receipt.accountId, privateKey }
}

/** Lee el saldo HBAR de una cuenta (tinybars) desde el Mirror Node. */
export const getMirrorHbarTinybars = async (accountId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
  if (!res.ok) throw new Error(`Mirror Node devolvió ${res.status} para ${accountId}`)
  return Number((await res.json()).balance.balance)
}
