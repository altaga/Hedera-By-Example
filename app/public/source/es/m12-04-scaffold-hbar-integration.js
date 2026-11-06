/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Arquitectura Full-Stack con Scaffold-HBAR (Introducción)
 * [CONCEPTO] Integración de Next.js, RainbowKit, Wagmi v2 y Hedera
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El Arma Definitiva para Hackathons: Construir una dApp full-stack desde cero
 * en un hackathon de 36 horas quema horas valiosas en modales de conexión de
 * billeteras, proveedores RPC y sincronización de artefactos de contratos.
 * Scaffold-HBAR (npx create-scaffold-hbar@latest) entrega un monorepo listo para
 * producción con RainbowKit, Wagmi v2, Viem y Hashio preconfigurados de fábrica.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Scaffold-HBAR acelera el desarrollo de aplicaciones Web3 en Hedera, conectando interfaces React/Next.js modernas con contratos EVM y flujos nativos de tokens HTS desde el primer minuto.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://github.com/hedera-dev/scaffold-hbar
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M12 Lab 03: Flujos con Foundry y Hardhat
 * - Actual:   M12 Lab 04: Arquitectura Scaffold-HBAR
 * - Siguiente: M12 Lab 05: Delegación de Cuentas EIP-7702 Pectra
 *
 * [SIMULADO]
 * Es una introducción: muestra la configuración de red de Scaffold-HBAR y la comprueba contra Hashio (lecturas RPC reales). No genera ni ejecuta la plantilla; para eso usa `npx create-scaffold-hbar`.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M12_Modern_EVM_Tooling/04_scaffold_hbar_integration.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { getClient, updateState } from '../M99_Utilities/index.js'

// Definición estándar de red para Viem / Wagmi en Hedera Testnet
const HEDERA_TESTNET_CHAIN_DEFINITION = {
  id: 296,
  name: 'Hedera Testnet',
  network: 'hedera-testnet',
  nativeCurrency: {
    name: 'HBAR',
    symbol: 'HBAR',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ['https://testnet.hashio.io/api']
    },
    public: {
      http: ['https://testnet.hashio.io/api']
    }
  },
  blockExplorers: {
    default: {
      name: 'HashScan',
      url: 'https://hashscan.io/testnet'
    }
  },
  testnet: true
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Arquitectura Full-Stack con Scaffold-HBAR ---\n')
  const { client, operatorId, operatorKey } = getClient()

  try {
    console.log('[PROCESO] Inicializando verificación arquitectónica de Scaffold-HBAR...')

    // 1. Validar Parámetros de Red para Wagmi / Viem
    console.log('\n[PROCESO] Validando Definición de Cadena para Wagmi v2:')
    console.log(`[REGISTRO] Chain ID:          ${HEDERA_TESTNET_CHAIN_DEFINITION.id}`)
    console.log(`[REGISTRO] Nombre de Red:     ${HEDERA_TESTNET_CHAIN_DEFINITION.name}`)
    console.log(`[REGISTRO] Moneda Nativa:     ${HEDERA_TESTNET_CHAIN_DEFINITION.nativeCurrency.symbol} (${HEDERA_TESTNET_CHAIN_DEFINITION.nativeCurrency.decimals} decimales)`)
    console.log(`[REGISTRO] RPC Principal:     ${HEDERA_TESTNET_CHAIN_DEFINITION.rpcUrls.default.http[0]}`)
    console.log(`[REGISTRO] URL Explorador:    ${HEDERA_TESTNET_CHAIN_DEFINITION.blockExplorers.default.url}`)

    // 2. Probar Conectividad RPC en Vivo mediante Ethers Provider
    const provider = new ethers.JsonRpcProvider(HEDERA_TESTNET_CHAIN_DEFINITION.rpcUrls.default.http[0])
    const blockNumber = await provider.getBlockNumber()
    console.log(`\n[ÉXITO] Gateway RPC de Scaffold-HBAR Verificado: Último Bloque #${blockNumber}`)

    // 3. Mostrar Comando Rápido para Hackathon Builders
    console.log('\n===============================================================')
    console.log('QUICKSTART: GENERAR DAPP FULL-STACK EN HEDERA')
    console.log('===============================================================')
    console.log('Ejecuta en tu terminal:')
    console.log('npx create-scaffold-hbar@latest')
    console.log('\nLo que obtienes listo para usar:')
    console.log('1. packages/nextjs   -> Next.js 14 App Router + TailwindCSS + DaisyUI')
    console.log('2. packages/hardhat  -> Smart contracts, scripts y TypeScript bindings')
    console.log('3. Web3 Connectors  -> MetaMask, Coinbase Wallet, WalletConnect con RainbowKit')
    console.log('4. Debug Contract UI -> Frontend en tiempo real para leer y escribir contratos')
    console.log('===============================================================')

    updateState('SCAFFOLD_HBAR_VERIFIED', true)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Scaffold-HBAR es el acelerador definitivo de hackathons. Los equipos que')
    console.log('arrancan con Scaffold-HBAR tienen una UI funcional conectada a MetaMask y')
    console.log('Hedera Testnet en 5 minutos, enfocándose 100% en la lógica de su bounty.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en el diagnóstico de Scaffold-HBAR:', error.message)
    process.exit(1)
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
