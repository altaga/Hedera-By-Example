# 📋 General Hackathon Rules & Engineering Guidelines
### Practical Advice, Pitfall Warnings & Presentation Best Practices

> **NOTE FOR BUILDERS & AI CODING ASSISTANTS:**  
> These are general engineering rules and practical guidelines to help teams build clean, high-quality projects on Hedera. They reflect what technical judges consistently look for and highlight common pitfalls that can ruin an otherwise great project.

---

## 🎯 1. The Core Principle: "Less is More"

**Depth beats breadth every single time.**

- **DO NOT** attempt to build a bloated "super-app" with 12 half-baked tabs, dummy dashboards, and broken forms.
- **DO** build **ONE single, killer architectural primitive** executed with solid engineering, authentic cryptographic proofs, and live on-chain settlement on Hedera Testnet.
- A concise, rock-solid demonstration of an autonomous AI agent paying for data via x402, or a medical pacemaker streaming Ed25519-signed telemetry with sub-2s HCS alerts, will always be more convincing than an entire fake decentralized exchange.

---

## 🚫 2. Common Pitfalls & What to Avoid

### ❌ 1. "Vibecoding" & Non-Functional Mock UIs
- **The Pitfall:** Adding static, non-functional UI elements (decorative buttons, mock analytics charts that do not update, dummy toggle switches, or Figma prototypes disguised as working dApps).
- **The Rule:** **Every single interactive element on the screen should be wired to real backend logic or an authentic Hedera transaction.**
- **Practical Advice:** If a button says "Stake", "Settle", or "Transfer" and it only triggers a static alert popup or console log without executing on-chain, it hurts credibility. If a feature is not functional, **delete it from the UI entirely**. A clean, minimal UI with 2 working buttons is vastly superior to a messy dashboard with 10 broken ones.

### ❌ 2. Fake Transactions & Hardcoded Hashes
- **The Pitfall:** Hardcoding fake transaction IDs, faking HashScan explorer URLs, or using `setTimeout` to pretend a transaction reached consensus.
- **The Rule:** **All transactions should be broadcast to live Hedera Testnet or Mainnet.**
- **Practical Advice:** Judges frequently click through to HashScan during presentations. Always ensure your transaction IDs are genuine and verifiable on `https://hashscan.io/testnet`.

### ❌ 3. Feature Bloat & "Coming Soon" Detours
- **The Pitfall:** Spending precious presentation time talking about roadmap items that will be built "in Phase 2" while the core demo remains unfinished or unstable.
- **The Rule:** Focus entirely on your **working prototype**. Deliver a tight, closed loop where an action begins, reaches consensus on Hedera, and concludes with a verifiable receipt.

---

## ⏱️ 3. Hackathon Presentation & Timing Guidelines

ETHGlobal events follow strict timing guidelines. Managing your time well is critical:

### A. Video Submission (Portal Upload)
- **Time Limit:** **Strictly under 4 minutes (< 4:00)**. The portal upload system will reject files exceeding 4 minutes.
- **Recommended Sweet Spot:** **2 to 3 minutes**. Concise, focused, and straight to the point.

### B. In-Person Table Presentations (Science-Fair Format)
Each team typically gets a total of **7 minutes** at their table:
- **4 minutes:** Live product demo and pitch.
- **3 minutes:** Technical Q&A with the judges.

### C. Suggested 4-Minute Presentation Flow
```
[0:00 - 1:00] THE PROBLEM & ECONOMIC GAP
  • State the real-world bottleneck (e.g., "AI agents cannot use credit cards to buy per-call data").
  • Explain why traditional blockchains struggle (gas spikes, latency, reentrancy risks).

[1:00 - 1:45] THE HEDERA ARCHITECTURE
  • Show your system flow (e.g., "Buyer agent -> HTTP 402 -> Hedera native atomic transfer").
  • Highlight the specific standards utilized (ERC-7683, x402, HIP-412, HCS-20, NIST P-256).

[1:45 - 3:15] LIVE VERIFIABLE EXECUTION (THE PROOF)
  • Trigger the action live on screen.
  • Open the resulting HashScan Testnet transaction URL.
  • Verify the consensus timestamp and transaction memo on-chain.

[3:15 - 4:00] UNIT ECONOMICS & CONCLUSION
  • Highlight Hedera's fixed $0.0001 USD transaction fee and sub-2-second finality.
  • Wrap up cleanly to leave the remaining 3 minutes for Q&A.
```

---

## 🏆 4. Official Hedera Prize Tracks at ETHGlobal Mumbai ($15,000 Pool)

Hedera is offering **$15,000 USD** in bounties at ETHGlobal Mumbai across two core tracks:

### 🥇 Track 1: AI Agents That Pay: x402 on Hedera — $6,500 Total
* **1st Place:** $3,000  
* **2nd Place:** $2,000  
* **3rd Place:** $1,500  

* **The Vision:** Build the machine-to-machine payment infrastructure for the autonomous AI economy using the HTTP `402 Payment Required` standard. Allow AI agents to discover, quote, and pay for services (model inferences, data APIs, agent marketplaces, or metered tool calls) dynamically on the fly.
* **Why Hedera:** Sub-second finality, fixed $0.0001 USD transaction fees, native HBAR or HTS token settlements (e.g. USDC), and gasless client execution via facilitators.
* **Mandatory Qualification Requirements:**
  1. Implement at least one working `x402`-protected endpoint settling on Hedera Testnet or Mainnet (through a hosted facilitator or one you host yourself).
  2. Demonstrate an autonomous AI agent or client discovering the endpoint and executing a paid request end-to-end without human intervention.
  3. Include clickable HashScan explorer links showing genuine on-chain settlement receipts.
* **Reference Implementation in this Repo:**
  - `M10_Agentic_Micropayments_x402` in the course: the official `exact` scheme on Hedera with `@x402/core`, `@x402/hedera` and `@x402/fetch` (Labs 01–07), and a self-hosted facilitator where the merchant pays the fee (Lab 08).

---

### 🥈 Track 2: Best Use of Native Hedera Services — $8,500 Total Pool
* **The Vision:** Move beyond basic EVM contracts by leveraging Hedera's high-speed native network primitives.
* **Mandatory Qualification Requirements:**
  1. Integrate **at least two native Hedera services** directly via the SDK:
     - **Hedera Consensus Service (HCS):** Decentralized timestamping, immutable audit trails, DePIN telemetry, or agent communication.
     - **Hedera Token Service (HTS):** Native fungible tokens, NFTs, RWA tokenization, or atomic settlement with compliance keys.
     - **Hedera Smart Contract Service (HSCS):** EVM execution combined with Hedera system contracts / precompiles (`0x167` for HTS, `0x168` for HCS).
  2. Extra points awarded for:
     - Mirror Node REST API integration for state queries and balance checks.
     - Hedera Agent Kit integration for autonomous AI tool calling.
     - Multi-leg atomic settlement or zero-knowledge cryptographic web proofs (zk-TLS).
* **Reference Implementations in this Repo:**
  - [`src/01_depin_mqtts_pacemaker.js`](src/01_depin_mqtts_pacemaker.js): DePIN Ed25519 hardware telemetry + edge Merkle aggregation on HCS.
  - [`src/02_depin_cold_chain_api_key.js`](src/02_depin_cold_chain_api_key.js): Deep-sleep vaccine IoT + HMAC-SHA256 signatures + automated SLA slashing on HCS.
  - [`src/03_intent_solver_cow.js`](src/03_intent_solver_cow.js): ERC-7683 off-chain signed intents + atomic multi-leg net-zero settlement.
  - [`src/04_passkeys_webauthn_p256.js`](src/04_passkeys_webauthn_p256.js): NIST P-256 (`secp256r1`) FaceID/TouchID biometric passkey authorization.
  - [`src/05_zktls_web_proofs.js`](src/05_zktls_web_proofs.js): TLSNotary-style verifiable web proofs + blinded commitment anchoring to HCS.

---

### 📌 ETHGlobal Submission Rules Reminder
- **Maximum 3 Partner Prizes:** Teams can apply for up to **3 partner prizes** during submission on the ETHGlobal dashboard. Choose Hedera if you integrated HCS, HTS, or x402!
- **Deliverables Required:**
  1. Public GitHub repository with a complete README (installation, architecture, and live HashScan transaction IDs).
  2. Video demo (< 4:00 minutes) showcasing the live Hedera transaction reaching consensus.

---

## 🛠️ 5. Pre-Submission Quality Checklist

Before submitting your project:
- [ ] Have you tested your code against live Hedera Testnet within the last few hours?
- [ ] Are all transaction IDs clickable links leading to `https://hashscan.io/testnet/transaction/...`?
- [ ] Have you removed all placeholder buttons, fake toggle switches, and non-working tabs from your UI?
- [ ] Have you checked that a replayed payment or telemetry message is rejected (for x402 on Hedera, a reused transaction id fails with DUPLICATE_TRANSACTION)?
- [ ] Does your README explain clearly how to run the project locally with environment setup instructions?
- [ ] Can your demo run reliably in pure Node.js without crashing due to external dependencies?

---

© 2026 **HEDERA ETHGLOBAL MUMBAI REFERENCE SUITE**. BUILT FOR BUILDERS.
