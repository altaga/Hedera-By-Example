/**
 * ============================================================================
 * Laboratorio 09: Smart Hashinals HCS-7 (Estado EVM + Inscripciones Dinámicas WASM)
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
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M6 Lab 08: Reconstrucción de NFT HCS-1
 * - Siguiente: M6 Lab 10: Bóveda Cifrada Zero-Trust
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M6_Mass_Storage_Hashinals/09_hcs7_smart_hashinals.js
 * ============================================================================
 */

import {
  PrivateKey,
  TopicInfoQuery
} from '@hiero-ledger/sdk'
import {
  buildHcs7CreateRegistryTx,
  buildHcs7EvmMessageTx,
  buildHcs7WasmMessageTx,
  buildHcs7SubmitMessageTx,
  hcs7MessageSchema
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Smart Hashinals HCS-7 (Inscripciones Dinámicas EVM + WASM) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const submitKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Desplegar un Tópico Oficial de Registro HCS-7 (`hcs-7:indexed:86400`)
    console.log('[PROCESO] Paso 1: Desplegando Tópico de Registro HCS-7 vía HOL Standards SDK...')
    const registryTx = buildHcs7CreateRegistryTx({
      ttl: 86400,
      submitKey: submitKey.publicKey,
      adminKey: submitKey.publicKey
    }).setAutoRenewAccountId(operatorId.toString())

    const signedRegistryTx = await (await registryTx.freezeWith(client)).sign(submitKey)
    const registryRes = await signedRegistryTx.execute(client)
    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const registryTopicId = (await registryRes.getReceipt(client)).topicId.toString()

    const topicInfo = await new TopicInfoQuery().setTopicId(registryTopicId).execute(client)
    console.log(`[ÉXITO] Tópico de Registro HCS-7 Creado: ${registryTopicId}`)
    console.log(`[REGISTRO] Memo Oficial HOL: "${topicInfo.topicMemo}"`)

    // 2. Inscribir Configuración Lectora de Estado EVM (`t: "evm"`) vía `buildHcs7EvmMessageTx`
    console.log('\n[PROCESO] Paso 2: Inscribiendo Lector de Estado EVM (Oráculo de Volatilidad HBAR)...')
    const evmConfigTx = buildHcs7EvmMessageTx({
      topicId: registryTopicId,
      config: {
        contractAddress: '0x0000000000000000000000000000000000849f9b',
        abi: {
          name: 'latestAnswer',
          inputs: [],
          outputs: [{ name: 'price', type: 'int256' }],
          stateMutability: 'view',
          type: 'function'
        },
        memo: 'Lee el precio en vivo HBAR/USD del oráculo para mutar el aura del Hashinal'
      },
      transactionMemo: 'hcs-7:op:0:0'
    })

    const signedEvmTx = await (await evmConfigTx.freezeWith(client)).sign(submitKey)
    const evmRes = await signedEvmTx.execute(client)
    const evmReceipt = await evmRes.getReceipt(client)
    console.log(`[ÉXITO] ¡Configuración EVM Inscrita en Secuencia #${evmReceipt.topicSequenceNumber}!`)

    // 3. Inscribir Configuración de Enrutador WASM (`t: "wasm"`) vía `buildHcs7WasmMessageTx`
    console.log('\n[PROCESO] Paso 3: Inscribiendo Configuración de Renderizado Dinámico WASM...')
    const wasmConfigTx = buildHcs7WasmMessageTx({
      topicId: registryTopicId,
      config: {
        wasmTopicId: registryTopicId,
        inputType: {
          stateData: {
            price: 'int256',
            holderBalance: 'uint256'
          }
        },
        outputType: {
          type: 'string',
          format: 'topic-id'
        },
        memo: 'Enruta precio >= $0.25 hacia SVG Dragón Solar; < $0.25 hacia SVG Dragón Obsidiana'
      },
      transactionMemo: 'hcs-7:op:0:1'
    })

    const signedWasmTx = await (await wasmConfigTx.freezeWith(client)).sign(submitKey)
    const wasmRes = await signedWasmTx.execute(client)
    const wasmReceipt = await wasmRes.getReceipt(client)
    console.log(`[ÉXITO] ¡Enrutador WASM Inscrito en Secuencia #${wasmReceipt.topicSequenceNumber}!`)

    // 4. Vincular Variantes de Metadatos (`op: register`) con `buildHcs7SubmitMessageTx`
    console.log('\n[PROCESO] Paso 4: Vinculando Reglas de Metadatos Gobernados por Estado (`op: register`)...')
    const registerMetadataPayload = {
      p: 'hcs-7',
      op: 'register',
      t: 'hcs-1',
      t_id: registryTopicId,
      d: {
        weight: 100,
        tags: ['tier:solar-apex', 'trigger:price_gte_25c', 'render:dynamic-svg']
      },
      m: 'Forma Solar Apex — Activada automáticamente cuando el Oráculo EVM >= $0.25'
    }

    // Validar contra el esquema oficial Zod de HOL antes de enviar
    hcs7MessageSchema.parse(registerMetadataPayload)

    const metaTx = buildHcs7SubmitMessageTx({
      topicId: registryTopicId,
      message: registerMetadataPayload,
      transactionMemo: 'hcs-7:op:1:2'
    })

    const signedMetaTx = await (await metaTx.freezeWith(client)).sign(submitKey)
    const metaRes = await signedMetaTx.execute(client)
    const metaReceipt = await metaRes.getReceipt(client)
    console.log(`[ÉXITO] ¡Vinculación Dinámica Anclada en Secuencia #${metaReceipt.topicSequenceNumber}!`)
    console.log(`[PUNTERO] URI del Smart Hashinal: hcs://7/${registryTopicId}`)

    updateState('HCS7_SMART_HASHINAL_TOPIC_ID', registryTopicId)
    updateState('HCS7_SMART_HASHINAL_URI', `hcs://7/${registryTopicId}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Los Smart Hashinals HCS-7 combinan lecturas de contratos EVM (`t: evm`) con')
    console.log('enrutamiento determinista WASM (`t: wasm`) sobre HCS, creando NFTs vivos que')
    console.log('evolucionan con el estado on-chain sin pagar gas por actualizar metadatos.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('En lugar de ejecutar tareas programadas para mutar NFTs con `TokenUpdateNftsTransaction`,')
    console.log('inscribe las reglas de la máquina de estados una vez vía HCS-7 y deja que el indexador calcule la vista.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en Smart Hashinal HCS-7:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
