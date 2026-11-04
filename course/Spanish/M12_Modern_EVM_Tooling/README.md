# Módulo 12: Tooling EVM Moderno sobre Hedera
## Scaffold-HBAR, Foundry, Hardhat y Fachadas Directas HTS

> [!IMPORTANT]
> **OBJETIVO:** Construir, probar y desplegar contratos inteligentes de Solidity en Hedera usando el stack estándar de desarrollo de Ethereum: Foundry, Hardhat, Ethers.js, Scaffold-HBAR y fachadas directas ERC-20 de HTS sin precompilados artesanales.

---

## Mapa del Módulo

En este módulo cerramos la brecha para los desarrolladores nativos de Ethereum. Aprenderás a apuntar el tooling habitual de la EVM hacia el JSON-RPC Relay de Hedera y a manipular activos nativos de Hedera Token Service (HTS) directamente como si fueran contratos ERC-20.

| Lab | Tema | Descripción |
| :--- | :--- | :--- |
| **01** | **Fachada Directa HTS ERC-20** | Consumo de tokens HTS nativos desde Solidity como `IERC20` sin precompilados obsoletos (HIP-719). |
| **02** | **JSON-RPC Relay con Ethers.js** | Consulta de estado y ejecución de transacciones estándar de Ethereum usando Ethers.js v6 en Hashio. |
| **03** | **Flujos con Foundry y Hardhat** | Configuración de `foundry.toml` y `hardhat.config.ts` para compilación y despliegue automatizado. |
| **04** | **Arquitectura Scaffold-HBAR** | Integración de dApps full-stack con Next.js, RainbowKit, Wagmi v2, Viem y Hedera Testnet. |
| **05** | **Delegación EIP-7702 Pectra** | Delegación de cuentas Pectra en el Relay JSON-RPC de Hedera para capacidades de cuenta inteligente sin costo. |
| **06** | **Paymaster ERC-4337 Sin Gas** | Arquitectura de patrocinio de gas, firma de UserOperation y verificación de EntryPoint para dApps sin gas. |

---

## El Puente del Ecosistema EVM de Hedera

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#ffffff',
    'primaryTextColor': '#000000',
    'primaryBorderColor': '#000000',
    'lineColor': '#000000',
    'secondaryColor': '#FF4500',
    'tertiaryColor': '#ffffff',
    'mainBkg': '#ffffff',
    'nodeBorder': '#000000',
    'clusterBkg': '#F9F9F6',
    'clusterBorder': '#000000',
    'fontSize': '14px',
    'fontFamily': 'Inter, system-ui, -apple-system, sans-serif',
    'nodeRadius': '0px'
  }
}}%%
graph LR
    subgraph ETH_DEV_STACK [STACK ESTÁNDAR DE ETHEREUM]
        FOUNDRY[<b>FOUNDRY (FORGE)</b><br/>Contratos y Tests]
        HARDHAT[<b>HARDHAT</b><br/>Scripts de Despliegue]
        DAPP[<b>SCAFFOLD-HBAR</b><br/>Next.js + Wagmi + Viem]
    end

    subgraph RELAY_LAYER [HEDERA JSON-RPC RELAY (CHAIN ID 296)]
        HASHIO[<b>HASHIO RPC</b><br/>https://testnet.hashio.io]
    end

    subgraph HASHGRAPH_EXECUTION [CAPA DE CONSENSO Y SISTEMA]
        HSCS[<b>SMART CONTRACT SERVICE</b><br/>Ejecución EVM]
        HTS[<b>HEDERA TOKEN SERVICE</b><br/>Fachadas Directas HIP-719]
    end

    FOUNDRY --> HASHIO
    HARDHAT --> HASHIO
    DAPP --> HASHIO
    HASHIO --> HSCS
    HSCS --> HTS

    classDef default fill:#ffffff,stroke:#000000,stroke-width:2px;
    classDef accent fill:#FF4500,stroke:#000000,stroke-width:2px,color:#ffffff;
    class HASHIO accent;
```

---

## Conceptos Clave

### 1. La Arquitectura del JSON-RPC Relay
Hedera no ejecuta una mempool secuencial tradicional de la EVM. En su lugar, el **JSON-RPC Relay** de código abierto traduce las llamadas RPC estándar de Ethereum (`eth_getBalance`, `eth_sendRawTransaction`, `eth_call`) a transacciones nativas de Hedera, enrutándolas directamente por las capas de consenso de Hashgraph y mirror nodes.

### 2. Fachadas Directas HTS ERC-20 (HIP-719 / HIP-514)
En tutoriales antiguos de Hedera, los contratos de Solidity debían importar interfaces complejas de contratos del sistema (`0x167`) para comunicarse con tokens HTS. Hoy, todo token HTS tiene una dirección EVM determinista (ej. `0.0.12345` $\rightarrow$ `0x0000000000000000000000000000000000003039`). Un contrato en Solidity puede simplemente instanciarlo como `IERC20(htsAddress)` y llamar a `transfer()`, `balanceOf()` y `transferFrom()` directamente.

### 3. Mecánica de Gas y Tarifas en la EVM de Hedera
Mientras que las transacciones en Ethereum queman montos impredecibles de ETH según la saturación de la red, en Hedera las tarifas de gas de la EVM están vinculadas a valores fijos en USD pagados en HBAR. Una transferencia simple por contrato cuesta aproximadamente \$0.001 USD, ya sea que la red procese 10 TPS o 10,000 TPS.

---

## Referencias Oficiales
- [Documentación del Hedera Smart Contract Service](https://docs.hedera.com/hedera/sdks-and-apis/smart-contracts)
- [Repositorio GitHub de Scaffold-HBAR](https://github.com/hedera-dev/scaffold-hbar)
- [Hedera JSON-RPC Relay](https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay)
- [HIP-719: Fachadas Directas HTS en Contratos del Sistema](https://hips.hedera.com/hip/hip-719)

---

 2026 **HEDERA PARA DUMMIES**. CÓDIGO SOLIDITY. VELOCIDAD HASHGRAPH. CERO FRICCIÓN.
