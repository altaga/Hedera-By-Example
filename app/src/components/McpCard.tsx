import React, { useState } from 'react'
import { Icon } from './Icon'
import { REPO_URL, type Lang } from '../lib/content'

const PATH = '/ABSOLUTE/PATH/TO/Hedera-By-Example/mcp/index.js'
const JSON_BLOCK = (args: string, key = 'mcpServers', extra = '') => `{
  "${key}": {
    "hedera-by-example": {${extra}
      "command": "node",
      "args": ["${args}"]
    }
  }
}`

const CLIENTS = [
  { id: 'claude-code', name: 'Claude Code', file: '', code: `claude mcp add hedera-by-example -- node ${PATH}` },
  { id: 'claude-desktop', name: 'Claude Desktop', file: 'claude_desktop_config.json', code: JSON_BLOCK(PATH) },
  { id: 'cursor', name: 'Cursor', file: '.cursor/mcp.json', code: JSON_BLOCK(PATH) },
  { id: 'vscode', name: 'VS Code', file: '.vscode/mcp.json', code: JSON_BLOCK('${workspaceFolder}/mcp/index.js', 'servers', '\n      "type": "stdio",') },
  { id: 'windsurf', name: 'Windsurf', file: '~/.codeium/windsurf/mcp_config.json', code: JSON_BLOCK(PATH) }
]

const TEXT = {
  en: {
    tag: 'MCP server',
    title: 'Use the course from your AI assistant',
    lead: 'The repository includes a Model Context Protocol server. Connect it to Claude Code, Claude Desktop, Cursor, VS Code or Windsurf, and your assistant answers from these 131 labs instead of guessing.',
    features: [
      ['Search every lab', 'in English or Spanish, by idea, SDK class or standard (HIP-991, HCS-10), with what each lab needs and costs.'],
      ['Read the full lab', 'concept, labs to run first, official references and the complete runnable code.'],
      ['Verified guardrails', 'tinybars, Hbar math, fixed USD fees, gas, key types, EVM addresses, size limits: checked against the SDK and testnet.'],
      ['Live network data', 'free Mirror Node reads and HBAR cost estimates at the current exchange rate.']
    ],
    step1: '1. Get the repository (no npm install needed: Node.js 20+ only)',
    step2: '2. Add the server to your assistant',
    pathNote: 'Replace the path with where you cloned the repository.',
    file: 'File',
    tryTitle: 'Then ask, for example',
    prompts: ['How do I airdrop a token to accounts that are not associated yet?', 'Show me the HIP-991 paid topic lab and explain what it costs.', 'How much HBAR do one token and 10 NFT mints cost today?', 'Review this code for Hedera mistakes.'],
    more: 'Full guide: tools, resources, prompts and HTTP transport',
    copy: 'Copy',
    copied: 'Copied'
  },
  es: {
    tag: 'Servidor MCP',
    title: 'Usa el curso desde tu asistente de IA',
    lead: 'El repositorio incluye un servidor Model Context Protocol. Conéctalo a Claude Code, Claude Desktop, Cursor, VS Code o Windsurf, y tu asistente responde con estos 131 labs en vez de adivinar.',
    features: [
      ['Busca en todos los labs', 'en inglés o español, por idea, clase del SDK o estándar (HIP-991, HCS-10), con lo que cada lab necesita y cuesta.'],
      ['Lee el lab completo', 'concepto, labs previos, referencias oficiales y el código ejecutable completo.'],
      ['Guardrails verificados', 'tinybars, aritmética de Hbar, comisiones fijas en USD, gas, tipos de llave, direcciones EVM, límites de tamaño: comprobados con el SDK y testnet.'],
      ['Datos de la red en vivo', 'lecturas gratis del Mirror Node y estimaciones del costo en HBAR al tipo de cambio actual.']
    ],
    step1: '1. Obtén el repositorio (sin npm install: solo Node.js 20+)',
    step2: '2. Agrega el servidor a tu asistente',
    pathNote: 'Cambia la ruta por donde clonaste el repositorio.',
    file: 'Archivo',
    tryTitle: 'Luego pregunta, por ejemplo',
    prompts: ['¿Cómo hago un airdrop de un token a cuentas que aún no lo tienen asociado?', 'Muéstrame el lab del tópico de pago HIP-991 y explica cuánto cuesta.', '¿Cuánto HBAR cuestan hoy un token y 10 mints de NFT?', 'Revisa este código buscando errores de Hedera.'],
    more: 'Guía completa: herramientas, resources, prompts y transporte HTTP',
    copy: 'Copiar',
    copied: 'Copiado'
  }
}

function Cmd ({ code, label }: { code: string; label: { copy: string; copied: string } }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className='cmd'>
      <pre><code>{code}</code></pre>
      <button type='button' className='btn btn-ghost btn-sm' onClick={() => { try { navigator.clipboard?.writeText(code) } catch (_) {} setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
        <Icon name={copied ? 'check' : 'copy'} size={14} /><span>{copied ? label.copied : label.copy}</span>
      </button>
    </div>
  )
}

export function McpCard ({ lang }: { lang: Lang }) {
  const t = TEXT[lang]
  const [client, setClient] = useState(CLIENTS[0].id)
  const c = CLIENTS.find((x) => x.id === client) || CLIENTS[0]
  return (
    <section className='mcp-card' aria-labelledby='mcp-title' data-testid='mcp-card'>
      <span className='mcp-tag'>{t.tag}</span>
      <h2 id='mcp-title'>{t.title}</h2>
      <p className='lead'>{t.lead}</p>
      <ul className='mcp-features'>
        {t.features.map(([title, text]) => <li key={title}><strong>{title}:</strong> {text}</li>)}
      </ul>
      <div className='mcp-steps'>
        <h3>{t.step1}</h3>
        <Cmd code={`git clone ${REPO_URL}.git`} label={t} />
        <h3>{t.step2}</h3>
        <div className='seg mcp-clients' role='tablist' aria-label={t.step2}>
          {CLIENTS.map((x) => (
            <button key={x.id} type='button' role='tab' aria-selected={client === x.id} onClick={() => setClient(x.id)} data-testid={`mcp-client-${x.id}`}>{x.name}</button>
          ))}
        </div>
        {c.file && <p className='muted mcp-file'>{t.file}: <code>{c.file}</code></p>}
        <Cmd code={c.code} label={t} />
        {c.id !== 'vscode' && <p className='muted mcp-file'>{t.pathNote}</p>}
      </div>
      <h3 className='mcp-try'>{t.tryTitle}</h3>
      <ul className='mcp-prompts'>{t.prompts.map((p) => <li key={p}>“{p}”</li>)}</ul>
      <a className='mcp-more' href={`${REPO_URL}/tree/master/mcp#readme`} target='_blank' rel='noopener noreferrer'>{t.more} <Icon name='external' size={12} /></a>
    </section>
  )
}
