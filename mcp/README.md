# Hedera by Example — MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives your AI coding assistant the whole Hedera by Example course: **131 runnable labs in English and Spanish**, guardrails checked against the SDK and testnet, live Mirror Node reads and fee estimates in HBAR.

Ask your assistant things like *"how do I airdrop tokens to accounts that are not associated?"*, *"show me the HIP-991 paid topic lab"*, *"how much HBAR does creating a token and minting 10 NFTs cost today?"* or *"review this code for Hedera mistakes"*, and it answers from the course instead of guessing.

- No npm dependencies: Node.js 20 or newer.
- Transports: stdio, Streamable HTTP and the older HTTP+SSE.
- MCP protocol versions 2025-06-18, 2025-03-26 and 2024-11-05.

## Install

```bash
git clone https://github.com/altaga/Hedera-By-Example.git
```

The server reads the course from the repository (`app/src/content`, built and committed), so nothing else needs installing. Use the absolute path of `mcp/index.js` in the configurations below.

### Claude Code

```bash
claude mcp add hedera-by-example -- node /ABSOLUTE/PATH/TO/Hedera-By-Example/mcp/index.js
```

Check it with `claude mcp list`: it should say `Connected`.

### Claude Desktop

Settings → Developer → Edit Config (`claude_desktop_config.json`), see [`client_configs/claude-desktop.json`](client_configs/claude-desktop.json):

```json
{
  "mcpServers": {
    "hedera-by-example": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/Hedera-By-Example/mcp/index.js"]
    }
  }
}
```

### Cursor

`.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for all projects), see [`client_configs/cursor.json`](client_configs/cursor.json). Same `mcpServers` block as Claude Desktop.

### VS Code (GitHub Copilot agent mode)

`.vscode/mcp.json`, see [`client_configs/vscode.json`](client_configs/vscode.json):

```json
{
  "servers": {
    "hedera-by-example": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/mcp/index.js"]
    }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`, see [`client_configs/windsurf.json`](client_configs/windsurf.json). Same `mcpServers` block as Claude Desktop.

### Over HTTP

```bash
node mcp/index.js --http 3001
```

- Streamable HTTP: `POST http://127.0.0.1:3001/mcp`.
- Legacy HTTP+SSE: `GET http://127.0.0.1:3001/sse`, then `POST /messages?sessionId=…`.
- `GET /health` and `GET /tools`.

It binds `127.0.0.1`. Use `--host 0.0.0.0` to expose it. Browser origins other than localhost are refused unless you list them with `--allow-origin https://your.app` (or `*`).

## Tools

| Tool | What it does |
| :--- | :--- |
| `search_labs` | Ranked search over all labs (English or Spanish). It accepts free text, SDK classes (`TokenAirdropTransaction`) and standards (HIP-991, HCS-10). Each result says what to run first, the wallets needed and the HBAR cost. |
| `get_lab` | One lab in full: concept, learnable moment, *before you run* (wallets, labs to run first, cost), official references, links to run it in the browser and to the source, and the complete code. |
| `list_labs` | The course map: 16 modules, 131 labs and their slugs. |
| `query_curriculum` | Search and return the best labs with their code in one call. |
| `anti_hallucination_rules` | 17 verified guardrails: tinybars and Hbar math, weibars on JSON-RPC, USD-fixed fees, gas charged at ≥80% of the limit, ambiguous raw keys, long-zero vs alias EVM addresses, associations and HIP-904, 100-byte metadata, HCS and HFS size limits, Mirror Node lag and rate limits, receipts vs records, schedules. |
| `architecture_decision_tree` | When to use HCS, HTS or smart contracts (optionally only one section with `focus`). |
| `mirror_node_query` | Live, free reads from the Mirror Node (testnet, mainnet, previewnet). It covers accounts and their tokens, NFTs, allowances and rewards; tokens with NFTs and balances; topics with messages decoded; transactions, contracts with results and state, and schedules; plus the exchange rate, gas prices, supply, nodes and blocks. IDs are validated. |
| `estimate_cost` | Prices a list of operations in USD and in HBAR at the live exchange rate (and gas at the live gas price): token creation, mints, associations, airdrops, topics, messages, schedules, files, contracts… |
| `query_knowledge` | Map of the Hedera ecosystem (AI agents, RWA/ATS, stablecoins, DePIN, identity, privacy) with official links. |
| `official_resources` | Official documentation, repositories and specifications. |

## Resources and prompts

- **Resources:**
  - Every lab is a resource in both languages, `hbe://lab/{en|es}/{slug}` (262), also offered as a template.
  - The course maps `hbe://labs/en` and `hbe://labs/es`.
  - The guides `hbe://guide/guardrails`, `…/architecture`, `…/official-resources` and `…/hackathon`.
- **Prompts:**
  - `build_on_hedera` (a goal): guardrails plus the labs that match, then plan, price and code.
  - `explain_lab` (a slug): a step-by-step walkthrough for a learner.
  - `review_hedera_code` (code): a review against every guardrail.

## Tests

```bash
node tests/05_mcp_server.test.mjs
```

The test covers stdio and HTTP:
- version negotiation;
- notifications (no reply) and batches;
- multi-word search, `get_lab`, ID validation, resources and prompts;
- Streamable HTTP (202 for notifications, 405 for GET, 403 for foreign origins) and the SSE round trip.
