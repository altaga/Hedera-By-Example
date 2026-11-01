# 🛠️ Module 12: Modern EVM Tooling on Hedera
## Scaffold-HBAR, Foundry, Hardhat, and Direct HTS Facades

> [!IMPORTANT]
> **OBJECTIVE:** Build, test, and deploy Solidity smart contracts on Hedera using the industry-standard Ethereum developer stack: Foundry, Hardhat, Ethers.js, Scaffold-HBAR, and direct HTS ERC-20 facades without custom precompile boilerplate.

---

## 🗺️ Module Map

In this module, we bridge the gap for Ethereum native developers. You will learn how to point standard EVM developer tooling at Hedera's JSON-RPC Relay and treat native Hedera Token Service (HTS) assets directly as ERC-20 smart contracts.

| Lab | Topic | Description |
| :--- | :--- | :--- |
| **01** | **Direct HTS ERC-20 Facade** | Calling native HTS tokens directly from Solidity as `IERC20` without legacy precompiles (HIP-719). |
| **02** | **JSON-RPC Relay via Ethers.js** | Querying state and executing standard Ethereum transactions using pure Ethers.js v6 on Hashio. |
| **03** | **Foundry & Hardhat Workflows** | Configuring `foundry.toml` and `hardhat.config.ts` for automated testnet compilation and deployment. |
| **04** | **Scaffold-HBAR Architecture** | Integrating full-stack Next.js dApps with RainbowKit, Wagmi v2, Viem, and Hedera Testnet. |
| **05** | **EIP-7702 Account Delegation** | Ethereum Pectra account delegation on Hedera JSON-RPC Relay for zero-cost smart account capabilities. |
| **06** | **ERC-4337 Paymaster Gasless** | Gas sponsorship architecture, UserOperation signing, and EntryPoint verification for zero-gas dApps. |

---

## 🏗️ The Hedera EVM Ecosystem Bridge

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
    subgraph ETH_DEV_STACK [STANDARD ETHEREUM TOOLING]
        FOUNDRY[<b>FOUNDRY (FORGE)</b><br/>Contracts & Tests]
        HARDHAT[<b>HARDHAT</b><br/>Deployment Scripts]
        DAPP[<b>SCAFFOLD-HBAR</b><br/>Next.js + Wagmi + Viem]
    end

    subgraph RELAY_LAYER [HEDERA JSON-RPC RELAY (CHAIN ID 296)]
        HASHIO[<b>HASHIO RPC</b><br/>https://testnet.hashio.io]
    end

    subgraph HASHGRAPH_EXECUTION [CONSENSUS & SYSTEM LAYER]
        HSCS[<b>SMART CONTRACT SERVICE</b><br/>EVM Execution]
        HTS[<b>HEDERA TOKEN SERVICE</b><br/>HIP-719 Direct Facades]
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

## 🔑 Key Concepts

### 1. The JSON-RPC Relay Architecture
Hedera does not run a traditional sequential EVM mempool. Instead, the open-source **JSON-RPC Relay** translates standard Ethereum RPC calls (`eth_getBalance`, `eth_sendRawTransaction`, `eth_call`) into native Hedera transactions, routing them directly through the Hashgraph consensus and mirror node layers.

### 2. Direct HTS ERC-20 Facades (HIP-719 / HIP-514)
In older tutorials, Solidity contracts had to import complex Hedera system contract interfaces (`0x167`) to talk to HTS tokens. Today, every HTS token has a deterministic EVM address (e.g. `0.0.12345` $\rightarrow$ `0x0000000000000000000000000000000000003039`). A Solidity contract can simply cast it to `IERC20(htsAddress)` and call `transfer()`, `balanceOf()`, and `transferFrom()` natively.

### 3. Gas and Fee Mechanics in Hedera's EVM
While standard Ethereum transactions burn unpredictable amounts of ETH depending on network congestion, Hedera EVM gas fees are pegged to fixed USD values paid in HBAR. A simple contract transfer costs roughly \$0.001 USD, whether the network is processing 10 TPS or 10,000 TPS.

---

## 📚 Official References
- [Hedera Smart Contract Service Documentation](https://docs.hedera.com/hedera/sdks-and-apis/smart-contracts)
- [Scaffold-HBAR GitHub Repository](https://github.com/hedera-dev/scaffold-hbar)
- [Hedera JSON-RPC Relay](https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay)
- [HIP-719: Direct HTS Token System Contract Facades](https://hips.hedera.com/hip/hip-719)

---

© 2026 **HEDERA FOR DUMMIES**. SOLIDITY CODE. HASHGRAPH SPEED. NO FRICTION.
