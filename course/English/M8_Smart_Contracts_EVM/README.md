# Module 8: Smart Contracts and EVM
## Ethereum Compatibility and Hedera Power

> [!IMPORTANT]
> **OBJECTIVE:** Deploy and manage smart contracts in Solidity, leveraging full EVM compatibility and Hedera's unique ability to interact with native services (HTS/HCS) through System Contracts.

---

## Module Map

| Lab | Topic | Description |
| :--- | :--- | :--- |
| **01** | **Contract Deployment** | Using the SDK to upload bytecode to the network. |
| **02** | **Hybrid Environment** | Interaction between the EVM and native Hedera accounts. |
| **03** | **Structural Changes** | Understanding gas and storage differences in Hedera's EVM. |
| **04** | **System Contracts (HIP-206)** | Calling native token services (HTS) directly from Solidity. |
| **05** | **Authorization Protocols** | Managing allowances and permissions in a decentralized environment. |
| **06** | **USDC Interaction (ERC-20)** | Using standard stablecoins within the EVM. |
| **07** | **USDC Association** | Automating token association from within a contract. |
| **08** | **Advanced HTS Precompiles** | Minting, burning, and transferring native HTS tokens inside Solidity (0x167). |
| **09** | **Zero-Knowledge Privacy Pool** | Cryptographic commitment nullifiers and confidential EVM settlement at sub-cent gas. |
| **10** | **System Contracts (0x168 & 0x16a)** | Native exchange rate oracle precompile (0x168) and Hedera Account Service signature authorization (0x16a). |
| **11** | **Solidity Autonomous Cron (0x16b)** | Self-scheduling smart contracts calling the 0x16b HSS system precompile without off-chain keepers. |

---

## System Contracts (The Master Bridge)

System Contracts allow a Solidity contract to "talk" to native Hedera services, combining the flexibility of the EVM with the speed of HTS.

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
    SC[SOLIDITY SMART CONTRACT] -->|1. CALL HIP-206| SY[SYSTEM CONTRACT]
    SY -->|2. EXECUTE OPERATION| HTS[HEDERA TOKEN SERVICE]
    HTS -->|3. RESULT| SY
    SY -->|4. RETURN DATA| SC
    
    %% Styling
    classDef default fill:#ffffff,stroke:#000000,stroke-width:2px;
    classDef accent fill:#FF4500,stroke:#000000,stroke-width:2px,color:#ffffff;
    
    class SY accent;
    class HTS accent;
```

---

## Key Concepts

### 1. Full EVM Compatibility
Hedera supports the same tools as Ethereum (Hardhat, Foundry, Remix, Ethers.js). You can migrate your Ethereum dApps to Hedera with minimal changes and enjoy fixed fees in dollars.

### 2. System Contracts (HIP-206)
Unlike other networks where tokens are heavy contracts, in Hedera tokens are native. System Contracts act as a Solidity API to perform high-speed HTS token transfers, minting, and burning.

### 3. Fixed Gas in USD
In Hedera, the gas price does not fluctuate with network demand. The execution cost is anchored to the US dollar, allowing businesses to accurately predict their operational costs.

---

## Official References
- [Hedera Smart Contract Service (HSCS)](https://docs.hedera.com/hedera/core-concepts/smart-contracts)
- [HIP-206: HTS System Contract](https://hips.hedera.com/hip/hip-206)
- [Besu EVM on Hedera](https://hedera.com/blog/hedera-evm-the-best-of-both-worlds)

---

 2026 **HEDERA FOR DUMMIES**. THE BRAIN OF THE NETWORK.
