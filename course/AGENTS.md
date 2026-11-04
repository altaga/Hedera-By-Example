# AGENTS.md — Autonomous Agent Operating Directives
### Hedera Hashgraph Developer Curriculum & Enterprise Reference Architecture

> **TARGET AUDIENCE:** Autonomous Coding Agents (Antigravity, Cursor, Claude Code, Trae, Codex, Copilot) and AI-Assisted Engineers contributing to, debugging, or extending this codebase.

---

## 1. Repository Identity & Mission

This repository (**Hedera for Dummies**) is an enterprise-grade, pedagogically standardized JavaScript curriculum covering the entire Hedera Hashgraph ecosystem across **16 modules** and **131 distinct production labs** (262 files total across mirrored English and Spanish trees).

### Core Architectural Axioms
1. **Pure Node.js (ESM):** Zero external Docker daemons, Python scripts, or compiled C++ binaries. Everything runs natively on `node:crypto`, `node:tls`, `node:https`, and `@hiero-ledger/sdk`.
2. **Deterministic Live Testnet Settlement:** Every lab interacts with live Hedera Testnet consensus nodes or provides mathematically deterministic cryptographic proofs.
3. **Strict Zero-Vibecoding Policy:** All code follows strict W3C, RFC, and HIP (Hedera Improvement Proposal) specifications with explicit error handling, anti-replay nonces, and mathematical balance invariants.

---

## 2. Environment & Prerequisites

### Runtime & Dependencies
- **Node.js:** `>= 20.0.0` (ESM mode: `"type": "module"` in `package.json`).
- **Core SDK:** `@hiero-ledger/sdk` (`^2.90.1`) and `@hashgraphonline/standards-sdk`.
- **Linter:** `standard` (JavaScript Standard Style).

### Environment Configuration (`.env`)
The root `.env` must provide the following keys:
```ini
NETWORK="testnet"OPERATOR_ID="0.0.xxxxxxx"OPERATOR_PRIVATE_KEY="3030020100300706052b8104000a04220420..."OPERATOR_EVM_ADDRESS="0x..."

# Secondary test accounts for multi-party flows (Atomic Swaps, CoW Intents, Allowances)
ACCOUNT_1_ID="0.0.xxxxxxx"ACCOUNT_1_PRIVATE_KEY="3030020100300706052b8104000a04220420..."ACCOUNT_1_EVM_ADDRESS="0x..."ACCOUNT_2_ID="0.0.xxxxxxx"ACCOUNT_2_PRIVATE_KEY="3030020100300706052b8104000a04220420..."ACCOUNT_2_EVM_ADDRESS="0x..."
```

---

## 3. Execution Commands & Directives

### Running Individual Labs
Any lab can be executed directly from the project root using Node:
```bash
# Execute English Lab
node English/M10_Agentic_Micropayments_x402/08_x402_direct_p2p_settlement.js

# Execute Spanish Mirror Lab
node Spanish/M10_Agentic_Micropayments_x402/08_x402_direct_p2p_settlement.js
```

### Running the Enterprise CI/CD Gatekeeper
Before proposing or completing any task, **YOU MUST RUN THE CI TEST RUNNER** to guarantee zero regressions:
```bash
# Run all 4 automated gatekeepers (Parity, Syntax, Standards, Linter)
npm test

# Or run individual verification stages:
npm run test:parity      # Stage 1: Verifies 100% 1:1 EN/ES file mirroring
npm run test:syntax      # Stage 2: Runs node --check across all 262+ JS files
npm run test:standards   # Stage 3: Verifies Key Concepts, Learnable Moments & References
npm run test:linter      # Stage 4: Verifies 0 errors under JavaScript Standard Style
npm run lint:fix         # Auto-formats JavaScript files to StandardJS rules
```

---

## 4. Mandatory Rules for Adding or Modifying Code

Whenever you modify, refactor, or create files, **YOU MUST ADHERE TO THESE 5 RULES WITHOUT EXCEPTION**:

### Rule 1: Absolute Bilingual Parity (1:1 Mirroring)
- Every script in `English/<Module>/<file>.js` **MUST** have an exact counterpart in `Spanish/<Module>/<file>.js`.
- File names, state keys, and exported signatures **MUST BE IDENTICAL**.
- Pedagogical comments, console logs, and strings must be professionally translated.

### Rule 2: Mandatory Pedagogical Markers
Every lab file header **MUST** contain the standardized header block:
```javascript
/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab XX: <Lab Title>
 * [CONCEPT] <Concept Subtitle>
 * ============================================================================
 * [ KEY CONCEPT ]
 * <Detailed theoretical explanation of the underlying distributed ledger mechanism>
 *
 * [ LEARNABLE MOMENT ]
 * <Concise engineering insight highlighting why this pattern matters in production>
 *
 * [ OFFICIAL REFERENCES ]
 * - <Direct URL to official Hedera Docs / HIP / RFC specification>
 *
 * [ LEARNING PATH ]
 * - Previous: M<X> Lab <Y>: <Previous Title>
 * - Next:     M<X> Lab <Z>: <Next Title>
 *
 * [ HOW TO RUN ]
 * node English/<Module>/<file>.js
 * ============================================================================
 */
```
For Spanish files, the markers are translated to:
`[ CONCEPTO CLAVE ]`, `[ MOMENTO DE APRENDIZAJE ]`, `[ REFERENCIAS OFICIALES ]`, `[ RUTA DE APRENDIZAJE ]`, `[ CÓMO EJECUTAR ]`.

### Rule 3: Clean Lifecycle & Graceful Teardown
To prevent hanging gRPC channels or dangling event loops:
1. Always close the SDK client in a `finally` block:
   ```javascript
   } finally {
     client.close()
   }
   ```
2. Always implement the deterministic self-terminating CLI launcher at the bottom:
   ```javascript
   if (process.argv[1] && import.meta.filename === process.argv[1]) {
     main().then(() => {
       process.exit(0)
     }).catch((error) => {
       console.error('[ERROR] Execution Failure:', error.message)
       process.exit(1)
     })
   }
   ```

### Rule 4: StandardJS Code Style
- Single quotes `'string'` exclusively.
- No semicolons.
- 2-space indentation.
- Space before function parentheses: `async function main ()` or `const fn = async () =>`.
- Never leave unused imports or variables.

### Rule 5: Inter-Lab State Persistence
Labs communicate sequentially via state variables stored in `state.json`:
- Store state: `updateState('KEY_NAME', value)`
- Retrieve state: `getState('KEY_NAME')`
- Source: `import { getClient, getState, updateState, getHashscanUrl } from '../M99_Utilities/index.js'`

---

## 5. Key Architecture & Duality Directory

When designing or debugging modules, always recognize the dual operational patterns native to Hedera:

| Module | Core Duality / Pattern | Reference Implementation |
| :--- | :--- | :--- |
| **M01: Cryptography** | Explicit Account (`AccountCreateTransaction`) vs Lazy / Hollow Account (`HIP-583`) | `M1 Lab 05` |
| **M01 / M13: Fees** | Sponsored Fee Co-signing vs `HIP-336` Crypto Allowance vs `HIP-1068` Ledger Delegation | `M1 Lab 08`, `M13 Lab 02` |
| **M02: CQRS State** | Async REST Polling (`Mirrornode /api/v1`) vs Real-Time gRPC Consensus Streaming | `M2 Lab 02` vs `M2 Lab 04` |
| **M03 / M04: Tokens** | Classical Push (Pre-associated) vs `HIP-904` Native Airdrops with Claim/Reject | `M4 Lab 06`, `M4 Lab 07` |
| **M04 / M07: Swaps** | Synchronous Multi-Leg Atomic Swap vs Asynchronous Decoupled `ScheduleService` | `M4 Lab 04` vs `M7 Labs 03-04` |
| **M07: Timelocks** | Instant Quorum Trigger (`waitForExpiry: false`) vs Timelock Queue (`waitForExpiry: true`) | `M7 Lab 03` vs `M7 Lab 08` |
| **M08 / M12: EVM-HTS** | System Contract Precompile `0x167` vs Direct ERC-20 Facade on HTS Address | `M8 Lab 04` vs `M12 Lab 01` |
| **M10: x402 Micropayments** | Direct P2P (Buyer + Seller, 2 Actors) vs Sponsored Facilitator (3 Actors) | `M10 Lab 08` vs `M10 Labs 01-03` |
| **M11: Asset Studios** | Regulated Security Tokens (`ERC-3643`/`ERC-1400`) + ATS Mass Dividend Payout | `M11 Labs 01, 02, 08` |
| **M14: AI Consensus** | HCS-20 to HCS-28 (Inscriptions, Trust Scores, Skills) + Model Context Protocol (MCP) | `M14 Labs 01-10` |
| **M15: DePIN & Frontier** | High-Speed MQTTS (Ed25519 + Merkle) vs Low-Power REST (HMAC-SHA256 + SLA Slash) | `M15 Labs 01-05` |

---

## 6. Common Traps & Antipatterns (The "Never Do"List)

1. **NEVER use `.plus()` or `.negated()` on Hbar objects:** Hedera SDK `Hbar` objects are immutable value representations without BigNumber arithmetic methods. To compute dynamic balances, use native `BigInt` tinybars: `BigInt(hbar.toTinybars())`.
2. **NEVER exceed 100 bytes in NFT metadata on HTS:** `TokenMintTransaction` limits metadata bytes to 100 bytes per serial. Store standard IPFS URIs (`ipfs://.../<id>.json`), not raw stringified JSON payloads.
3. **NEVER omit single-use challenge nonces in payment receipts:** In x402 or IoT telemetry, always verify that the challenge nonce is explicitly bound in the transaction `memo` (`x402:direct:<nonce>`) or signature payload to prevent replay attacks.
4. **NEVER implement infinite polling loops:** When waiting for consensus receipts or mirror node updates, always use bounded retries with exponential backoff or native gRPC streaming.

---

 2026 **HEDERA FOR DUMMIES**. CODE IS CURRENCY. SETTLEMENT IS INSTANT.
