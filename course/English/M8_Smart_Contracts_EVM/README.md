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
| **09** | **Zero-Knowledge Privacy Pool** | Real Groth16 circuit (circom + snarkjs), on-chain Poseidon Merkle tree and verifier: deposit, private withdrawal, forged-proof and double-spend rejection. |
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

## Before You Run

Every lab runs from the course web page or with `node`. Your testnet account signs and pays fees; some labs also use the practice wallets `ACCOUNT_1` and `ACCOUNT_2` (create them in the web Wallets panel, or set them in `.env`). A lab with an entry under **Run first** reads what that earlier lab saved in `state.json`, so run them in that order.

| Lab | Run first | Practice wallets | Cost |
| :--- | :--- | :--- | :--- |
| **01** | — | — | ~15 ℏ the first time (it creates a contract, about 1 USD); ~3 ℏ when you run it again (it reuses what it created) |
| **02** | M8 Lab 01 | — | <0.1 ℏ (network fees only) |
| **03** | M8 Lab 01 | — | <1 ℏ (network fees only) |
| **04** | M3 Lab 01 | — | ~15 ℏ the first time (it creates a contract, about 1 USD); <1 ℏ when you run it again (it reuses what it created) |
| **05** | M8 Lab 01 | — | <1 ℏ (network fees only) |
| **06** | — | Yes | ~2 ℏ (network fees only) |
| **07** | — | — | <1 ℏ (network fees only) |
| **08** | — | — | ~30 ℏ the first time (it creates a token and a contract, about 2 USD); <0.1 ℏ when you run it again (it reuses what it created) |
| **09** | — | — | ~50-60 ℏ the first time (3 contract deployments: ~15 ℏ create + ~6 ℏ per 4 KB bytecode append each, plus 2 ℏ to a depositor); ~3 ℏ when contracts are reused. A gas retry re-uploads the bytecode, so the hasher starts at 3M gas |
| **10** | — | — | ~15 ℏ the first time (it creates a contract, about 1 USD); <0.1 ℏ when you run it again (it reuses what it created) |
| **11** | — | — | ~16 ℏ the first time (it creates a contract, about 1 USD, and funds it with 1 ℏ for its scheduled calls); <1 ℏ when you run it again (it reuses what it created) |

---

## Official References
- [Hedera Smart Contract Service (HSCS)](https://docs.hedera.com/hedera/core-concepts/smart-contracts)
- [HIP-206: HTS System Contract](https://hips.hedera.com/hip/hip-206)
- [Besu EVM on Hedera](https://hedera.com/blog/hedera-evm-the-best-of-both-worlds)

---

 2026 **HEDERA FOR DUMMIES**. THE BRAIN OF THE NETWORK.
