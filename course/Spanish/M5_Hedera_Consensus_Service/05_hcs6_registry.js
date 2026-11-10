/**
 * ============================================================================
 * Lab 05: Registro Descentralizado de Apps en HCS
 * [CONCEPTO] Descubrimiento de Servicios On-Chain
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Un registro en HCS es un tópico donde cada mensaje registra una entrada, y
 * cualquiera puede reconstruir la lista leyendo el tópico en orden. En lugar de
 * depender de una tienda de apps central, los desarrolladores publican el nombre,
 * sitio web y direcciones de su dApp en un tópico público, y los clientes lo
 * escuchan para descubrir servicios.
 * Este lab sigue HCS-2 (el estándar de registros de HOL): el memo del tópico es
 * "hcs-2:0:<ttl>" (un registro indexado, donde cuenta cada entrada), cada entrada
 * es un mensaje {"p":"hcs-2","op":"register","t_id":...}, y t_id apunta al
 * manifiesto de la app, un JSON inscrito con HCS-1. Cualquier lector de HCS-2
 * puede listar las apps.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Un tópico de registro le da a cada entrada un orden y una marca de tiempo de consenso que nadie puede reescribir. Acordar un esquema de mensaje común (como HCS-2) es lo que permite a otras apps leer tu registro sin pedirte permiso.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-2/
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M5 Lab 04: Benchmark de Latencia HCS (Protocolo Ping-Pong)
 * - Siguiente: M5 Lab 06: Tópicos Monetizados Generadores de Ingresos en HBAR y HTS (HIP-991)
 *
 * [ SECUENCIA ]
 * Desarrollador -> Hedera: Inscribe el manifiesto de la app (HCS-1)
 * Desarrollador -> Hedera: Crea un registro HCS-2 (memo hcs-2:0:86400)
 * Desarrollador -> Registro: register { t_id: tópico del manifiesto }
 * Cliente -> Registro: Se suscribe y lee las entradas register
 * Cliente -> Hedera: Reconstruye cada manifiesto (HCS-1) y lista la app
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M5_Hedera_Consensus_Service/05_hcs6_registry.js
 * ============================================================================
 */

import { PrivateKey, TopicMessageQuery } from '@hiero-ledger/sdk'
import { buildHcs2CreateRegistryTx, buildHcs2RegisterTx } from '@hashgraphonline/standards-sdk'
import { getClient, exitIfStuck, inscribeHcs1, readHcs1 } from '../M99_Utilities/index.js'

const main = async () => {
  // Nunca quedarse colgado: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'subscription messages')
  console.log('--- INICIO DE SESIÓN: Registro de Apps en HCS (HCS-2) ---\n')

  const { client, operatorKey } = getClient()
  const submitKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. El manifiesto de la app, inscrito como archivo HCS-1
    const manifest = {
      name: 'Hedera By Example',
      description: 'Labs prácticos de Hedera (entrada de demo del curso).',
      url: 'https://hbe.expo.app',
      tags: ['educacion', 'web3', 'hiero'],
      version: '1.0.0'
    }
    console.log('[PROCESO] Inscribiendo el manifiesto de la app como archivo HCS-1...')
    const manifestTopicId = await inscribeHcs1(client, Buffer.from(JSON.stringify(manifest)), 'application/json')
    console.log(`[ÉXITO] Manifiesto: hcs://1/${manifestTopicId}`)

    // 2. Un registro HCS-2 indexado (solo nuestra submit key puede escribir en él)
    console.log('\n[PROCESO] Creando un tópico de registro HCS-2 (indexado, TTL de 1 día)...')
    const createTx = await buildHcs2CreateRegistryTx({ registryType: 0, ttl: 86400, submitKey: submitKey.publicKey }).freezeWith(client)
    const topicId = (await (await (await createTx.sign(submitKey)).execute(client)).getReceipt(client)).topicId.toString()
    console.log(`[ÉXITO] Tópico del Registro creado: ${topicId}`)

    // 3. Registrar la app: t_id apunta al manifiesto
    console.log('\n[PROCESO] Enviando la entrada register de HCS-2...')
    const registerTx = await buildHcs2RegisterTx({ registryTopicId: topicId, targetTopicId: manifestTopicId, metadata: `hcs://1/${manifestTopicId}`, memo: 'App del curso Hedera By Example' }).freezeWith(client)
    const receipt = await (await (await registerTx.sign(submitKey)).execute(client)).getReceipt(client)
    console.log(`[ÉXITO] ¡App registrada on-chain! Número de secuencia: ${receipt.topicSequenceNumber.toString()}`)

    // 4. Un cliente descubre apps: se suscribe, toma las entradas register de HCS-2 y reconstruye cada manifiesto
    console.log('\n[PROCESO] Suscribiéndose al Registro para descubrir nuevos servicios...')
    await new Promise((resolve, reject) => {
      new TopicMessageQuery()
        .setTopicId(topicId)
        .setStartTime(0)
        .subscribe(
          client,
          (error) => reject(error),
          async (message) => {
            let entry
            try { entry = JSON.parse(Buffer.from(message.contents).toString('utf8')) } catch (_) { return console.log('[INFO] Mensaje no JSON ignorado.') }
            if (entry.p !== 'hcs-2' || entry.op !== 'register') return
            try {
              const app = JSON.parse((await readHcs1(entry.t_id)).bytes.toString())
              console.log('\n[DESCUBIERTO] ¡Nueva dApp registrada!')
              console.log(`- Nombre: ${app.name}`)
              console.log(`- Desc.: ${app.description}`)
              console.log(`- URL:  ${app.url}`)
              console.log(`- Manifiesto: hcs://1/${entry.t_id} (SHA-256 comprobado)`)
              console.log(`- Marca de tiempo: ${message.consensusTimestamp.toDate()}`)
              resolve()
            } catch (error) { reject(error) }
          }
        )
    })

    console.log('\n CONCEPTO CLAVE:')
    console.log('Un tópico de registro público permite listar o descubrir servicios sin un único')
    console.log('guardián. HCS-2 fija el formato de los mensajes, así que cualquier lector puede usarlo;')
    console.log('la submit key decide quién puede agregar entradas.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Error de Ejecución:', error.message)
    process.exitCode = 1
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
