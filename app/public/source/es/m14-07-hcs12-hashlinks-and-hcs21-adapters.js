/**
 * ============================================================================
 * Lab 07: HashLinks HCS-12 (Micro-Apps Interactivas) y Registro de Adaptadores HCS-21
 * [CONCEPTO] Ensamblajes UI On-Chain Componibles y Adaptadores Verificados
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Hashgraph Online (hol.org) introduce dos estándares clave que conectan a los
 * agentes autónomos de IA con interfaces de usuario seguras y datos externos:
 * 1. HCS-12 (HashLinks y Ensamblajes): La respuesta nativa en el consenso de
 *    Hedera a los "Blinks" de Solana. Permite componer micro-aplicaciones
 *    interactivas ("Assemblies") en HCS vinculando bloques visuales WebAssembly/HTML
 *    (`add-block`) con acciones transaccionales (`add-action`). ¡Cualquier
 *    billetera o chat de IA puede renderizar un URI `hcs://12/<topicId>` como
 *    una mini-dApp ejecutable en un clic!
 * 2. HCS-21 (Adapter Registry): Un registro de seguridad contra ataques a la
 *    cadena de suministro donde oráculos, puentes MCP y adaptadores DeFi publican
 *    declaraciones deterministas con huellas SHA-256 (`sha256-...`) para que los
 *    agentes jamás ejecuten código adulterado.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los enlaces de phishing y los paquetes npm envenenados son vectores de ataque
 * comunes contra usuarios cripto y agentes de IA. Al combinar interfaces on-chain
 * HCS-12 con verificación de huella SHA-256 en HCS-21 (la base de HOL Guard),
 * tanto el widget visual como el adaptador se pueden contrastar con lo publicado on-chain.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-12/
 * - https://hol.org/docs/standards/hcs-21/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 06: Enjambres Botánicos de Agentes (HCS-15 Pétalos, HCS-18 Descubrimiento, HCS-16 Flora y HCS-17 State Hash)
 * - Siguiente: M14 Lab 08: Buzón de Mensajes Privado HIP-1334 en HCS
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/07_hcs12_hashlinks_and_hcs21_adapters.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  HCS21TopicType,
  HCS21_PROTOCOL,
  buildHcs12AddActionToAssemblyTx,
  buildHcs12AddBlockToAssemblyTx,
  buildHcs12CreateRegistryTopicTx,
  buildHcs12RegisterAssemblyTx,
  buildHcs21CreateRegistryTx,
  buildHcs21MessageTx
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: HashLinks HCS-12 y Registro de Adaptadores HCS-21 (hol.org) ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. HCS-21: Desplegar un Tópico Oficial de Registro de Adaptadores (`hcs-21:0:86400:0`)
    console.log('[PROCESO] Paso 1 [HCS-21]: Desplegando Tópico de Registro de Adaptadores Verificados...')
    const adapterRegistryTx = buildHcs21CreateRegistryTx({
      ttl: 86400,
      indexed: 0,
      type: HCS21TopicType.ADAPTER_REGISTRY,
      metaTopicId: '0.0.100'
    }).setAutoRenewAccountId(operatorId.toString())
    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const adapterTopicId = (await (await adapterRegistryTx.execute(client)).getReceipt(client)).topicId.toString()
    console.log(`[HCS-21] Tópico de Registro de Adaptadores Creado: ${adapterTopicId}`)

    // 2. HCS-21: Publicar una Declaración de Adaptador con Huella Criptográfica SHA-256
    console.log('\n[PROCESO] Paso 2 [HCS-21]: Registrando Adaptador de Oráculo Verificado...')
    // Calcula el hash: cualquiera puede recalcularlo para verificar los datos.
    const artifactDigest = crypto.createHash('sha256')
      .update('@hol-org/pyth-saucer-adapter@1.4.0:dist/index.mjs')
      .digest('hex')

    const adapterDeclaration = {
      p: HCS21_PROTOCOL,
      op: 'register',
      adapter_id: 'adapter:hedera:saucer-v2-quoter',
      version: '1.4.0',
      package: {
        registry: 'npm',
        name: '@hol-org/saucer-v2-adapter',
        version: '1.4.0',
        integrity: `sha256-${artifactDigest}`
      },
      manifest: `hcs://1/${adapterTopicId}`,
      config: {
        type: 'defi-liquidity-router',
        account: operatorId.toString(),
        threshold: 1
      }
    }

    const hcs21MsgTx = buildHcs21MessageTx({
      topicId: adapterTopicId,
      declaration: adapterDeclaration,
      transactionMemo: 'hcs-21:op:register'
    })
    const hcs21Receipt = await (await hcs21MsgTx.execute(client)).getReceipt(client)
    console.log(`[HCS-21] ¡Adaptador Registrado en Secuencia #${hcs21Receipt.topicSequenceNumber}!`)
    console.log(`[HUELLA] Integridad del Paquete: sha256-${artifactDigest.slice(0, 32)}...`)

    // 3. HCS-12: Crear un Tópico de Ensamblaje HashLinks y Componer una Micro-App Interactiva
    console.log('\n[PROCESO] Paso 3 [HCS-12]: Creando Tópico de Ensamblaje HashLinks (`hcs-12:0:86400:2`)...')
    const assemblyTopicTx = buildHcs12CreateRegistryTopicTx({
      registry: 'assembly',
      ttl: 86400
    }).setAutoRenewAccountId(operatorId.toString())
    const assemblyTopicId = (await (await assemblyTopicTx.execute(client)).getReceipt(client)).topicId.toString()
    console.log(`[HCS-12] Tópico de Ensamblaje HashLinks Creado: ${assemblyTopicId}`)

    // Registrar metadatos raíz del Ensamblaje
    console.log('[PROCESO] Paso 4 [HCS-12]: Componiendo Micro-App HashLink (Register ➔ Add Action ➔ Add UI Block)...')
    const registerAssemblyTx = buildHcs12RegisterAssemblyTx({
      assemblyTopicId,
      registration: {
        p: 'hcs-12',
        op: 'register',
        name: 'one-click-hbar-swap-blink',
        version: '1.0.0',
        description: 'Tarjeta Interactiva HashLink para Swap Atómico HBAR/USDC en 1 Clic',
        author: operatorId.toString(),
        tags: ['defi', 'swap', 'hashlink', 'hcs-12']
      }
    })
    await (await registerAssemblyTx.execute(client)).getReceipt(client)

    // Vincular Acción ejecutable (`add-action`) apuntando al adaptador verificado
    const addActionTx = buildHcs12AddActionToAssemblyTx({
      assemblyTopicId,
      operation: {
        p: 'hcs-12',
        op: 'add-action',
        t_id: adapterTopicId,
        alias: 'execute_atomic_swap',
        config: {
          adapterId: 'adapter:hedera:saucer-v2-quoter',
          slippageBps: 50
        }
      }
    })
    await (await addActionTx.execute(client)).getReceipt(client)

    // Vincular Bloque de Interfaz (`add-block`) para renderizar la tarjeta interactiva
    const addBlockTx = buildHcs12AddBlockToAssemblyTx({
      assemblyTopicId,
      operation: {
        p: 'hcs-12',
        op: 'add-block',
        block_t_id: assemblyTopicId,
        actions: {
          onSwapClick: 'execute_atomic_swap'
        },
        data: {
          title: 'Swap Instantáneo HBAR ➔ USDC',
          buttonLabel: 'Intercambiar 100 HBAR Ahora',
          theme: 'swiss-dark'
        }
      }
    })
    const blockReceipt = await (await addBlockTx.execute(client)).getReceipt(client)

    const hashLinkUri = `hcs://12/${assemblyTopicId}`
    console.log(`[HCS-12] ¡Micro-App HashLink Ensamblada en Secuencia #${blockReceipt.topicSequenceNumber}!`)
    console.log(`[HASHLINK] URI Interactivo Compartible: ${hashLinkUri}`)

    updateState('HCS21_ADAPTER_REGISTRY_TOPIC_ID', adapterTopicId)
    updateState('HCS21_PACKAGE_INTEGRITY', `sha256-${artifactDigest}`)
    updateState('HCS12_ASSEMBLY_TOPIC_ID', assemblyTopicId)
    updateState('HCS12_HASHLINK_URI', hashLinkUri)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Los HashLinks HCS-12 empaquetan bloques visuales y acciones ejecutables en un')
    console.log('único URI on-chain (`hcs://12/<topicId>`), mientras que HCS-21 garantiza que el')
    console.log('adaptador subyacente coincida con su huella criptográfica SHA-256 en consenso.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Cuando un agente de IA presenta una tarjeta de transacción interactiva vía HCS-12,')
    console.log('contrastar el adaptador con su huella en HCS-21 permite detectar una interfaz cambiada')
    console.log('o un paquete alterado antes de firmar nada.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en Ejecución HCS-12 / HCS-21:', error.message)
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
