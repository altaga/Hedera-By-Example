# 🌐 Official Hedera Resources & Technical Specifications Directory
### Hedera by Example (HBE) — Master Documentation Suite

> **Notice:** This directory catalogs official Hedera network documentation, developer portals, consensus node infrastructure, Mirror Node REST APIs, and core Hedera Improvement Proposals (HIPs). All entries are continuously verified against active Hedera Testnet and Mainnet endpoints.

---

## 📚 Master Index of Official Resources

| Resource Name | Category | Official URL | Purpose / Coverage | Last Verified Update |
| :--- | :--- | :--- | :--- | :---: |
| **Hedera Developer Documentation** | Core Docs | [docs.hedera.com](https://docs.hedera.com) | Official architecture, service guides (HCS, HTS, HSCS, HFS) and getting started tutorials. | `2026-11-01` |
| **Hiero JavaScript SDK (JS/TS)** | SDK | [github.com/hiero-ledger/hiero-sdk-js](https://github.com/hiero-ledger/hiero-sdk-js) | Official Node.js and in-browser TypeScript/JavaScript client library (`@hiero-ledger/sdk`). | `2026-10-30` |
| **Hiero Java SDK** | SDK | [github.com/hiero-ledger/hiero-sdk-java](https://github.com/hiero-ledger/hiero-sdk-java) | Official enterprise Java client for Android and backend high-throughput integrations. | `2026-10-25` |
| **Hiero Go SDK** | SDK | [github.com/hiero-ledger/hiero-sdk-go](https://github.com/hiero-ledger/hiero-sdk-go) | High-performance Go client for infrastructure daemons and telemetry pipelines. | `2026-10-18` |
| **Hiero Rust SDK** | SDK | [github.com/hiero-ledger/hiero-sdk-rust](https://github.com/hiero-ledger/hiero-sdk-rust) | Low-level embedded systems and WebAssembly client library for zero-trust environments. | `2026-10-22` |
| **Hedera Developer Portal & Faucets** | Tooling | [portal.hedera.com](https://portal.hedera.com) | Testnet account registration, web testnet faucet (100 HBAR per rolling 24 h, no portal account needed; Faucet API with the same quota), and API key management. | `2026-11-01` |
| **HashScan Testnet Explorer** | Explorer | [hashscan.io/testnet](https://hashscan.io/testnet) | Real-time consensus block and transaction explorer for accounts, tokens, and topics. | `2026-11-01` |
| **HashScan Mainnet Explorer** | Explorer | [hashscan.io/mainnet](https://hashscan.io/mainnet) | Production Hedera explorer verifying live consensus finality, staking, and treasury assets. | `2026-11-01` |
| **Mirror Node REST API (Testnet)** | API / REST | [testnet.mirrornode.hedera.com/api/v1/docs](https://testnet.mirrornode.hedera.com/api/v1/docs/) | Open-access OpenAPI spec for account balances, token metadata, transactions, and contracts. | `2026-11-01` |
| **Mirror Node REST API (Mainnet)** | API / REST | [mainnet-public.mirrornode.hedera.com/api/v1/docs](https://mainnet-public.mirrornode.hedera.com/api/v1/docs/) | Public production mirror node endpoint for institutional and enterprise data indexing. | `2026-10-28` |
| **Hedera JSON-RPC Relay** | EVM Interop | [github.com/hashgraph/hedera-json-rpc-relay](https://github.com/hiero-ledger/hiero-json-rpc-relay) | Web3/Ethers.js/Hardhat/Foundry compatible JSON-RPC proxy translating EVM calls to Hedera. | `2026-10-29` |
| **Hedera Improvement Proposals (HIPs)** | Governance | [hips.hedera.com](https://hips.hedera.com) | Central repository for network architectural changes, token standards, and precompiles. | `2026-11-01` |
| **HIP-412 (NFT Metadata Standard)** | Standard | [hips.hedera.com/hip/hip-412](https://hips.hedera.com/hip/hip-412) | Official JSON schema standard for HTS non-fungible token metadata and off-chain storage. | `2026-10-15` |
| **HIP-583 (EVM Alias & Addresses)** | Protocol | [hips.hedera.com/hip/hip-583](https://hips.hedera.com/hip/hip-583) | Deterministic Ethereum address derivation (ECDSA `0x...`) directly bound to native accounts. | `2026-10-12` |
| **HIP-719 (Token Dissociation / Burn)**| Protocol | [hips.hedera.com/hip/hip-719](https://hips.hedera.com/hip/hip-719) | Decreased friction for automated and explicit token dissociation and treasury wipes. | `2026-09-20` |
| **HIP-1068 (Gasless Fee Allowance)** | DeFi / UX | [hips.hedera.com/hip/hip-1068](https://hips.hedera.com/hip/hip-1068) | Sponsored transactions enabling account payers to subsidize gas on behalf of end users. | `2026-10-24` |
| **HIP-1261 (Simple Dynamic Fees)** | Economic | [hips.hedera.com/hip/hip-1261](https://hips.hedera.com/hip/hip-1261) | USD-pegged deterministic fee estimation engine across consensus and smart contract calls. | `2026-10-31` |
| **HIP-1334 (Encrypted HCS Mailbox)** | Messaging | [hips.hedera.com/hip/hip-1334](https://hips.hedera.com/hip/hip-1334) | Asymmetric Diffie-Hellman encrypted messaging protocol running directly over HCS topics. | `2026-10-30` |
| **Hashgraph Online Standards SDK** | Standards | [github.com/hashgraph-online/standards-sdk](https://github.com/hashgraph-online/standards-sdk) | Reference implementation for HCS-10, HCS-11 (AI Agents), HCS-20 (Points), and HCS-21. | `2026-10-31` |
| **Hedera Consensus Service (HCS) Whitepaper** | Research | [hedera.com/consensus-service](https://hedera.com/consensus-service) | Mathematical proof of asynchronous Byzantine Fault Tolerance (aBFT) and Hashgraph consensus. | `2026-10-10` |
| **Hedera Token Service (HTS) Specs** | Tokenomics | [hedera.com/token-service](https://hedera.com/token-service) | Native tokenization architecture bypassing EVM smart contracts for sub-cent 10,000 TPS. | `2026-10-14` |
| **Smart Contract Service (HSCS) Docs** | Smart Contracts | [docs.hedera.com/hedera/core-concepts/smart-contracts](https://docs.hedera.com/hedera/core-concepts/smart-contracts) | Besu EVM execution engine running over hashgraph with native HTS/HCS system precompiles. | `2026-10-26` |
| **Hedera Status Dashboard** | Monitoring | [status.hedera.com](https://status.hedera.com) | Real-time consensus node uptime, mirror node latencies, and scheduled maintenance alerts. | `2026-11-01` |
