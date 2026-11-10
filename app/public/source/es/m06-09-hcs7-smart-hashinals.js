/**
 * ============================================================================
 * Lab 09: Smart Hashinals HCS-7 (Estado EVM + Inscripciones Dinámicas WASM)
 * [CONCEPTO] NFTs Dinámicos Programables Cero-Gas mediante Reglas en Consenso
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los Hashinals estándar (HCS-1 / HCS-5) son inscripciones estáticas. El estándar
 * HCS-7 (publicado en hol.org) introduce los "Smart Hashinals": artefactos
 * on-chain dinámicos y programables cuyo aspecto visual o metadatos cambian
 * automáticamente leyendo el estado en vivo de contratos EVM (`c_evm`) y lógica
 * WebAssembly (`c_wasm`) inscritos en un tópico de registro (`hcs-7:indexed:{ttl}`).
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los NFTs dinámicos tradicionales requieren un servidor u oráculo que pague gas
 * cada vez que cambia un atributo (ej. clima, balance de tokens o precio).
 * HCS-7 invierte el paradigma: inscribes el lector ABI del contrato EVM y el
 * enrutador WASM una sola vez en HCS. ¡Las billeteras e indexadores evalúan el
 * estado EVM en tiempo real al renderizar sin pagar gas recurrente!
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-7/
 * - https://hol.org/docs/standards/hcs-1/
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/system-smart-contracts
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M6 Lab 08: Reconstrucción de NFT HCS-1
 * - Siguiente: M6 Lab 10: Bóveda Cifrada Zero-Trust (Privacidad Corporativa en Consenso Público)
 *
 * [ SECUENCIA ]
 * Lab -> Hedera: Despliega HbarUsdFeed (lee el tipo de cambio de 0x168)
 * Lab -> Hedera: Inscribe el router WASM y dos variantes (HCS-1)
 * Lab -> Hedera: Registro HCS-7: config EVM, config WASM, dos mensajes register
 * Wallet -> Mirror Node: Lee el registro y llama a latestAnswer()
 * Wallet -> Wallet: Ejecuta el WASM con el precio y obtiene el tópico de la variante
 * Wallet -> Mirror Node: Reconstruye esa variante (HCS-1) y la muestra
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ la primera vez (despliega el contrato de precio, cerca de 1 USD); ~1 ℏ al volver a ejecutarlo (reutiliza el contrato y las inscripciones).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M6_Mass_Storage_Hashinals/09_hcs7_smart_hashinals.js
 * ============================================================================
 */

import fs from 'node:fs'
import { ContractCreateTransaction, PrivateKey, TopicInfoQuery } from '@hiero-ledger/sdk'
import {
  buildHcs7CreateRegistryTx,
  buildHcs7EvmMessageTx,
  buildHcs7WasmMessageTx,
  buildHcs7SubmitMessageTx,
  hcs7MessageSchema,
  EVMBridge,
  WasmBridge
} from '@hashgraphonline/standards-sdk'
import solc from 'solc'
import { getClient, getState, updateState, getMirrorNodeBaseUrl, executeWithGas, reuseContract, inscribeHcs1, readHcs1, waitForMirror } from '../M99_Utilities/index.js'

const ABI_LATEST_ANSWER = { name: 'latestAnswer', inputs: [], outputs: [{ name: 'price', type: 'int256' }], stateMutability: 'view', type: 'function' }

const compileFeed = () => {
  const source = fs.readFileSync(new URL('./09_hbar_usd_feed.sol', import.meta.url), 'utf8')
  const input = { language: 'Solidity', sources: { 'HbarUsdFeed.sol': { content: source } }, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.bytecode.object'] } } } }
  const out = JSON.parse(solc.compile(JSON.stringify(input)))
  const fatal = (out.errors || []).filter((e) => e.severity === 'error')
  if (fatal.length) throw new Error(`Error de compilación de Solidity: ${fatal[0].formattedMessage}`)
  return out.contracts['HbarUsdFeed.sol'].HbarUsdFeed.evm.bytecode.object
}

// Reutiliza una inscripción HCS-1 de una ejecución anterior si todavía se lee bien.
const reuseInscription = async (stateKey, make) => {
  const [saved, owner] = String(getState(stateKey) || '').split('@')
  if (saved && owner === process.env.OPERATOR_ID) {
    try { await readHcs1(saved, { attempts: 1 }); return saved } catch (_) {}
  }
  const topicId = await make()
  updateState(stateKey, `${topicId}@${process.env.OPERATOR_ID}`)
  return topicId
}

const svg = (fill, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#111"/><circle cx="100" cy="100" r="70" fill="${fill}"/><text x="100" y="190" font-size="16" text-anchor="middle" fill="#eee">${label}</text></svg>`

// El EVMBridge de HOL envía la lectura con un gas price desde la cuenta 0.0.800, que el Mirror Node
// ahora rechaza (INSUFFICIENT_PAYER_BALANCE). Esta subclase envía el mismo eth_call sin gas price.
class MirrorEVMBridge extends EVMBridge {
  async readFromMirrorNode (command, _from, to) {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ block: 'latest', data: command, to: '0x' + String(to.toSolidityAddress?.() ?? to.toEvmAddress()).replace(/^0x/, '') })
    })
    if (!res.ok) console.log(`[INFO] La llamada de contrato al Mirror Node respondió ${res.status}: ${await res.text()}`)
    return res.ok ? res.json() : null
  }
}

const submit = async (client, submitKey, tx) => (await (await (await tx.freezeWith(client)).sign(submitKey)).execute(client)).getReceipt(client)

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Smart Hashinals HCS-7 (Inscripciones Dinámicas EVM + WASM) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const submitKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Un feed de precio real: un contrato cuyo latestAnswer() lee el tipo de cambio de 0x168
    console.log('[PROCESO] Paso 1: Desplegando el contrato de precio HBAR/USD (lee el tipo de cambio de 0x168)...')
    const bytecode = compileFeed()
    const feedId = await reuseContract('REUSE_M6_09_FEED', bytecode, async () => {
      const res = await executeWithGas((gas) => new ContractCreateTransaction().setBytecode(Buffer.from(bytecode, 'hex')).setGas(gas), client, { gas: 300000 })
      return (await res.getReceipt(client)).contractId
    })
    const feedAddress = '0x' + feedId.toEvmAddress()
    console.log(`[SUCCESS] HbarUsdFeed: ${feedId} (${feedAddress})`)

    // 2. Inscripciones HCS-1: el router WASM y las dos variantes (imagen + metadatos HIP-412 cada una)
    console.log('\n[PROCESO] Paso 2: Inscribiendo el router WASM y las dos variantes como archivos HCS-1...')
    const wasmBytes = fs.readFileSync(new URL('./assets/hcs7_aura_router.wasm', import.meta.url))
    const wasmTopicId = await reuseInscription('M6_09_WASM_TOPIC', () => inscribeHcs1(client, wasmBytes, 'application/wasm'))
    const variant = async (key, name, fill, rule) => reuseInscription(key, async () => {
      const imageTopicId = await inscribeHcs1(client, Buffer.from(svg(fill, name)), 'image/svg+xml')
      const metadata = { name, description: `Aura del dragón que se muestra cuando ${rule}.`, image: `hcs://1/${imageTopicId}`, type: 'image/svg+xml', format: 'HIP412@2.0.0' }
      return inscribeHcs1(client, Buffer.from(JSON.stringify(metadata)), 'application/json')
    })
    const solarTopicId = await variant('M6_09_SOLAR_TOPIC', 'Dragón Solar', '#f5b301', 'HBAR >= $0.10')
    const obsidianTopicId = await variant('M6_09_OBSIDIAN_TOPIC', 'Dragón Obsidiana', '#5b3fd1', 'HBAR < $0.10')
    console.log(`[ÉXITO] Router WASM: hcs://1/${wasmTopicId} (${wasmBytes.length} bytes)`)
    console.log(`[ÉXITO] Variantes: solar hcs://1/${solarTopicId} | obsidiana hcs://1/${obsidianTopicId}`)

    // 3. El registro HCS-7 y sus cuatro mensajes
    console.log('\n[PROCESO] Paso 3: Creando el tópico de registro HCS-7 y sus mensajes...')
    const registryTx = buildHcs7CreateRegistryTx({ ttl: 86400, submitKey: submitKey.publicKey }).setAutoRenewAccountId(operatorId.toString())
    const registryTopicId = (await submit(client, submitKey, registryTx)).topicId.toString()
    const topicInfo = await new TopicInfoQuery().setTopicId(registryTopicId).execute(client)
    console.log(`[ÉXITO] Tópico de registro HCS-7 creado: ${registryTopicId} (memo "${topicInfo.topicMemo}")`)

    await submit(client, submitKey, buildHcs7EvmMessageTx({ topicId: registryTopicId, config: { contractAddress: feedAddress, abi: ABI_LATEST_ANSWER, memo: 'Precio HBAR/USD de HbarUsdFeed.latestAnswer() (8 decimales)' } }))
    console.log('[ÉXITO] Config EVM inscrita (t: evm)')
    await submit(client, submitKey, buildHcs7WasmMessageTx({ topicId: registryTopicId, config: { wasmTopicId, inputType: { stateData: { latestAnswer: 'int256' } }, outputType: { type: 'string', format: 'topic-id' }, memo: 'HBAR >= $0.10 -> aura:solar, si no aura:obsidian' } }))
    console.log('[ÉXITO] Config WASM inscrita (t: wasm)')
    for (const [tId, tag, m] of [[solarTopicId, 'aura:solar', 'Dragón Solar'], [obsidianTopicId, 'aura:obsidian', 'Dragón Obsidiana']]) {
      const message = { p: 'hcs-7', op: 'register', t_id: tId, d: { weight: 1, tags: [tag] }, m }
      hcs7MessageSchema.parse(message) // validar contra el esquema de HOL antes de enviar
      await submit(client, submitKey, buildHcs7SubmitMessageTx({ topicId: registryTopicId, message }))
      console.log(`[ÉXITO] Variante registrada: ${m} -> ${tId} (${tag})`)
    }
    console.log(`[PUNTERO] URI del Smart Hashinal: hcs://7/${registryTopicId}`)

    // 4. Resolverlo como una wallet, con el EVMBridge y el WasmBridge de HOL
    console.log('\n[PROCESO] Paso 4: Resolviendo hcs://7 como una wallet (EVMBridge + WasmBridge de HOL)...')
    const messages = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/topics/${registryTopicId}/messages?limit=25`)
      const list = res.ok ? (await res.json()).messages.map((m) => JSON.parse(Buffer.from(m.message, 'base64').toString())) : []
      return list.length >= 4 ? list : null
    }, { timeoutMs: 60_000 })
    if (!messages) throw new Error('Los mensajes del registro no llegaron a tiempo al Mirror Node')
    const evmConfig = messages.find((m) => m.t === 'evm')
    const wasmConfig = messages.find((m) => m.t === 'wasm')
    const registered = messages.filter((m) => m.op === 'register')

    const evm = new MirrorEVMBridge('testnet')
    const { stateData } = await evm.executeCommands([evmConfig])
    const price = Number(stateData.latestAnswer?.values?.[0])
    if (!Number.isFinite(price) || price <= 0) throw new Error('latestAnswer() no devolvió un precio')
    console.log(`[VERIFY] latestAnswer() vía el Mirror Node: ${price} -> 1 HBAR = $${(price / 1e8).toFixed(4)}`)

    const router = new WasmBridge()
    router.setLogLevel('error')
    await router.initWasm((await readHcs1(wasmConfig.c.wasmTopicId)).bytes)
    console.log(`[LOG] WASM get_params(): ${router.getParams()}`)
    const chosen = router.executeWasm(router.createStateData(wasmConfig, stateData), registered)
    const chosenMeta = JSON.parse((await readHcs1(chosen)).bytes.toString())
    console.log(`[ÉXITO] El WASM eligió ${chosen}: "${chosenMeta.name}" (imagen ${chosenMeta.image})`)

    updateState('HCS7_SMART_HASHINAL_TOPIC_ID', registryTopicId)
    updateState('HCS7_SMART_HASHINAL_URI', `hcs://7/${registryTopicId}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Los Smart Hashinals HCS-7 combinan una lectura EVM (`t: evm`) con un router WASM (`t: wasm`).')
    console.log('Aquí el router leyó el precio real del HBAR y eligió la variante; si el HBAR cruza')
    console.log('$0.10, todas las wallets mostrarán la otra, sin ninguna transacción para actualizar el NFT.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('En lugar de correr cron jobs que modifiquen NFTs con `TokenUpdateNftsTransaction`,')
    console.log('inscribe una vez las reglas con HCS-7 y deja que los indexadores calculen la vista.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló el Smart Hashinal HCS-7:', error.message)
    process.exit(1)
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
