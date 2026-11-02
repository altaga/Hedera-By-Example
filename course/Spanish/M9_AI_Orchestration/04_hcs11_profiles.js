/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Perfiles de IA HCS-11 (Provisión de Agente de Suplantación)
 * [ CONCEPTO ] Escalado de Identidades Estructuradas y Auditoría
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Agentes Especializados: La provisión de agentes con perfiles HCS-11 permite
 * crear arquitecturas de "Control y Balance". Un agente puede estar
 * optimizado para la auditoría de logs, mientras que otro (como este
 * "Spoofer Agent") se diseña para simular tráfico malicioso o ataques de
 * suplantación. Contar con identidades estructuradas y verificables en el
 * ledger es el primer paso para construir una infraestructura de IA
 * resiliente capaz de defenderse contra la manipulación de datos en
 * entornos de alta competición.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * HCS-11 establece perfiles de identidad verificables para agentes. Sin metadatos on-chain verificados, actores maliciosos pueden suplantar agentes de trading y engañar a contrapartes descentralizadas.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-11/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M9 Lab 03: Búsqueda y Resolución HCS-2
 * - Actual:   M9 Lab 04: Perfiles de Usuario (HCS-11)
 * - Siguiente: M9 Lab 05: Identidad Única Agéntica (HCS-14)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: ~8 ℏ (comisiones de red y las cuentas que crea).
 *
 * [ CÓMO EJECUTAR ]
 * node 04_hcs11_profiles.js
 * ============================================================================
 */

import { PrivateKey } from '@hiero-ledger/sdk'
import {
  AgentBuilder,
  AIAgentCapability,
  HCS10Client,
  InboundTopicType
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState, exitIfStuck, ensureFunded } from '../M99_Utilities/index.js'

const { client: operatorClient } = getClient()

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Provisión de Agentes Especializados (HCS-11) ---\n')

  const accountId = process.env.ACCOUNT_1_ID
  const privateKeyDer = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!accountId || !privateKeyDer) {
    console.error('[❌ FALLO] Falta ACCOUNT_1_ID o su llave privada. Verifica el Lab 00.')
    process.exitCode = 1
    return
  }

  const PRIVATE_KEY_DER = PrivateKey.fromString(privateKeyDer)

  // La Cuenta 1 paga los tres agentes (2 HBAR c/u + tópicos y perfiles): se recarga si hace falta.
  await ensureFunded(operatorClient, accountId, 10)

  // Configuración de Agentes a crear (Sincronizado con versión inglesa)
  const agentsToCreate = [
    {
      prefix: 'AGENT_A',
      name: 'Juez Anti-Trampas de Esports v2',
      bio: 'Árbitro autónomo para las Grandes Finales de $1 millón.',
      alias: 'fairplay-judge'
    },
    {
      prefix: 'AGENT_B',
      name: 'Centinela de Juego Limpio v1',
      bio: 'Auditor secundario que monitorea la telemetría del juego en tiempo real.',
      alias: 'integrity-sentinel'
    },
    {
      prefix: 'AGENT_C',
      name: 'Agente Spoofer de Esports',
      bio: 'Agente especializado utilizado para simular telemetría adversaria en auditorías de seguridad.',
      alias: 'spoofer'
    }
  ]

  try {
    const client = new HCS10Client({
      network: 'testnet',
      operatorId: accountId,
      operatorPrivateKey: PRIVATE_KEY_DER.toStringRaw()
    })

    for (const config of agentsToCreate) {
      console.log(`\n[⚙️ PROCESO] Iniciando provisión para: ${config.name}...`)

      const agentBuilder = new AgentBuilder()
        .setName(config.name)
        .setBio(config.bio)
        .setCapabilities([
          AIAgentCapability.DATA_INTEGRATION,
          AIAgentCapability.TEXT_GENERATION
        ])
        .setType('autonomous')
        .addProperty('alias', config.alias)
        .setNetwork('testnet')
        .setInboundTopicType(InboundTopicType.PUBLIC)

      const agent = await client.createAndRegisterAgent(agentBuilder, {
        initialBalance: 2, // 2 HBAR alcanzan de sobra para los mensajes HCS-10 de los Labs 06-11
        progressCallback: (event) => console.log(`   ⏳ [ℹ️ INFO] ${config.alias}: ${event.message}`)
      })

      if (agent.success) {
        console.log(`\n[✅ ÉXITO] ${config.name.toUpperCase()} PROVISIONADO`)
        console.log(`[📊 REGISTRO] ID Cuenta: ${agent.metadata.accountId}`)
        console.log(`[📊 REGISTRO] ID Inbox:  ${agent.metadata.inboundTopicId}`)

        // Persistencia de estado dinámico
        updateState(`HCS11_${config.prefix}_ID`, agent.metadata.accountId)
        updateState(`HCS11_${config.prefix}_KEY`, agent.metadata.privateKey)
        updateState(`HCS11_${config.prefix}_INBOUND`, agent.metadata.inboundTopicId)
        updateState(`HCS11_${config.prefix}_OUTBOUND`, agent.metadata.outboundTopicId)
      } else {
        console.error(`[❌ FALLO] No se pudo aprovisionar ${config.name}: ${agent.error || 'unknown error'}`)
        process.exitCode = 1
        break
      }

      // Cooldown de red
      await new Promise(r => setTimeout(r, 2000))
    }

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Has provisionado un agente especializado para pruebas de seguridad.')
    console.log('En los próximos laboratorios, este "Agente C" intentará realizar')
    console.log('ataques de suplantación, permitiéndote verificar la robustez de')
    console.log('tus defensas bajo el estándar HCS-10.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La provisión del agente HCS-11 falló:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
