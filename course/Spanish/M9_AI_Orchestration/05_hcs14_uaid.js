/**
 * ============================================================================
 * Lab 05: HCS-14 UAID (Universal Agent ID)
 * [CONCEPTO] Identificadores Globales y Determinismo Criptográfico
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Identidad Agnóstica: Un UAID es un identificador resistente a colisiones
 * que se deriva matemáticamente de los datos canónicos del agente. A
 * diferencia de otros estándares, generar un UAID en formato AID
 * (Agnostic ID) requiere CERO transacciones en la red. Se genera localmente
 * mediante el SDK, garantizando que el ID sea único y esté vinculado
 * permanentemente a la infraestructura del agente. Esto permite que el
 * agente mantenga su identidad de forma consistente tanto en entornos Web2
 * como Web3 sin costo operativo.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El Universal Agent ID (HCS-14) ofrece un URI criptográfico para entidades de inteligencia artificial, resolviendo la llave pública del agente, sus topics de consenso y sus habilidades verificadas en enjambre.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-14/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M9 Lab 04: Perfiles de IA HCS-11 (Provisión de Agente de Suplantación)
 * - Siguiente: M9 Lab 06: Comunicación Humano-a-Agente HCS-10 (Pública)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: ninguna. Este lab corre por completo en tu máquina (sin llamadas a la red).
 * - Ejecuta antes: Lab 04 de M9 (este lab lee lo que guardó).
 * - Costo: gratis (no se envía ninguna transacción).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M9_AI_Orchestration/05_hcs14_uaid.js
 * ============================================================================
 */

import { HCS14Client } from '@hashgraphonline/standards-sdk'
import { getState, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Identidad Determinista (HCS-14) ---\n')

  // 1. Recuperar el ID del Agente de Auditoría (Creado en Lab 04)
  const agentId = getState('HCS11_AGENT_A_ID')

  if (!agentId) {
    console.error('[FALLO] Falta HCS11_AGENT_A_ID en el estado. Ejecuta primero el Lab 04 de M9.')
    process.exitCode = 1
    return
  }

  try {
    // 2. Inicialización del Cliente HCS14
    const hcs14 = new HCS14Client()

    console.log(`[PROCESO] Generando UAID Determinista para el Agente: ${agentId}`)

    // 3. Creación del UAID (Formato AID)
    // El UAID se construye a partir de metadatos fijos vinculados a la cuenta Hedera
    const uaid = await hcs14.createUaid(
      {
        registry: 'esports-tournament-auditor',
        name: 'Anti-Cheat Spoofer Agent',
        version: '1.0.0',
        protocol: 'hcs-10',
        nativeId: `hedera:testnet:${agentId}`, // Anclaje nativo a la red
        skills: [0]
      },
      { uid: 'auditor-sentinel-v1' }
    )

    console.log('\n --- [ÉXITO] UNIVERSAL AGENT ID (UAID) GENERADO ---')
    console.log(`[REGISTRO] ${agentId}`)
    console.log(`[REGISTRO] ${uaid}`)
    console.log('----------------------------------------------------------')

    // Persistir el UAID para referencia en logs de auditoría
    updateState('HCS14_UAID', uaid)

    console.log('\n CONCEPTO CLAVE:')
    console.log('¿Notaste la velocidad de respuesta? Al no realizar llamadas')
    console.log('a la red, la generación es instantánea y gratuita. Cualquier')
    console.log('sistema en el mundo con los mismos datos canónicos derivará')
    console.log('exactamente el mismo UAID, permitiendo una interoperabilidad')
    console.log('global sin fricciones.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La generación del UAID falló:', error.message)
    process.exitCode = 1
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
