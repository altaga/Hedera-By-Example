import React, { useState } from 'react'
import { Icon } from './Icon'
import { REPO_URL, type Lang } from '../lib/content'

const REMOTE_URL = 'https://hbe.expo.app/api/mcp'
const LOCAL_PATH = '/ABSOLUTE/PATH/TO/Hedera-By-Example/mcp/index.js'

const JSON_BLOCK = (args: string, key = 'mcpServers', extra = '') => `{
  "${key}": {
    "hedera-by-example": {${extra}
      "command": "node",
      "args": ["${args}"]
    }
  }
}`

const REMOTE_CLIENTS = [
  {
    id: 'cursor-remote',
    name: 'Cursor',
    file: '.cursor/mcp.json',
    code: `{\n  "mcpServers": {\n    "hedera-by-example": {\n      "url": "${REMOTE_URL}"\n    }\n  }\n}`
  },
  {
    id: 'windsurf-remote',
    name: 'Windsurf',
    file: '~/.codeium/windsurf/mcp_config.json',
    code: `{\n  "mcpServers": {\n    "hedera-by-example": {\n      "serverUrl": "${REMOTE_URL}"\n    }\n  }\n}`
  },
  {
    id: 'claude-desktop-remote',
    name: 'Claude Desktop',
    file: 'claude_desktop_config.json',
    code: `{\n  "mcpServers": {\n    "hedera-by-example": {\n      "command": "npx",\n      "args": ["-y", "mcp-remote", "${REMOTE_URL}"]\n    }\n  }\n}`
  },
  {
    id: 'url-direct',
    name: 'Universal URL',
    file: '',
    code: REMOTE_URL
  }
]

const LOCAL_CLIENTS = [
  { id: 'claude-code', name: 'Claude Code', file: '', code: `claude mcp add hedera-by-example -- node ${LOCAL_PATH}` },
  { id: 'cursor-local', name: 'Cursor', file: '.cursor/mcp.json', code: JSON_BLOCK(LOCAL_PATH) },
  { id: 'vscode-local', name: 'VS Code', file: '.vscode/mcp.json', code: JSON_BLOCK('${workspaceFolder}/mcp/index.js', 'servers', '\n      "type": "stdio",') },
  { id: 'claude-desktop-local', name: 'Claude Desktop', file: 'claude_desktop_config.json', code: JSON_BLOCK(LOCAL_PATH) },
  { id: 'windsurf-local', name: 'Windsurf', file: '~/.codeium/windsurf/mcp_config.json', code: JSON_BLOCK(LOCAL_PATH) }
]

const TEXT = {
  en: {
    tag: 'MCP Server 2.0',
    title: 'Use the course from your AI assistant',
    lead: 'Hedera by Example exposes a live Model Context Protocol server. Connect it to Cursor, Claude Desktop, Windsurf, Claude Code or VS Code, and your assistant answers directly from these 135 runnable labs and verified guardrails.',
    features: [
      ['Search every lab', 'in English or Spanish, by idea, SDK class or standard (HIP-991, HCS-10), with what each lab needs and costs.'],
      ['Read the full lab', 'concept, labs to run first, official references and the complete runnable code.'],
      ['Verified guardrails', 'tinybars, Hbar math, fixed USD fees, gas, key types, EVM addresses, size limits: checked against the SDK and testnet.'],
      ['Live network data', 'free Mirror Node reads and live HBAR cost estimates at the current network exchange rate.']
    ],
    tabRemote: 'Remote URL (Cloud)',
    tabRemoteRecommended: 'Recommended',
    tabLocal: 'Local stdio (CLI)',
    remoteDesc: 'Zero setup required. Connect your IDE or web agent directly to our hosted endpoint without downloading or running anything locally.',
    directUrlLabel: 'Hosted Streamable HTTP Endpoint:',
    step1Local: '1. Get the repository (no npm install needed: Node.js 20+ only)',
    step2Local: '2. Add the local stdio subprocess to your assistant',
    pathNote: 'Replace the path with where you cloned the repository on your machine.',
    file: 'Configuration file',
    tryTitle: 'Then ask, for example',
    prompts: [
      'How do I airdrop a token to accounts that are not associated yet?',
      'Show me the HIP-991 paid topic lab and explain what it costs.',
      'How much HBAR do one token and 10 NFT mints cost today?',
      'Review this code for Hedera mistakes.'
    ],
    more: 'Full guide: tools, resources, prompts and HTTP transport',
    copy: 'Copy',
    copied: 'Copied'
  },
  es: {
    tag: 'Servidor MCP 2.0',
    title: 'Usa el curso desde tu asistente de IA',
    lead: 'Hedera by Example expone un servidor Model Context Protocol en vivo. Conéctalo a Cursor, Claude Desktop, Windsurf, Claude Code o VS Code, y tu asistente responde directamente con estos 135 labs ejecutables y guardrails verificados.',
    features: [
      ['Busca en todos los labs', 'en inglés o español, por idea, clase del SDK o estándar (HIP-991, HCS-10), con lo que cada lab necesita y cuesta.'],
      ['Lee el lab completo', 'concepto, labs previos, referencias oficiales y el código ejecutable completo.'],
      ['Guardrails verificados', 'tinybars, aritmética de Hbar, comisiones fijas en USD, gas, tipos de llave, direcciones EVM, límites de tamaño: comprobados con el SDK y testnet.'],
      ['Datos de la red en vivo', 'lecturas gratis del Mirror Node y estimaciones del costo en HBAR al tipo de cambio actual de la red.']
    ],
    tabRemote: 'URL Remota (Nube)',
    tabRemoteRecommended: 'Recomendada',
    tabLocal: 'Local stdio (CLI)',
    remoteDesc: 'Cero configuración. Conecta tu IDE o agente de IA directamente a nuestro endpoint en la nube sin clonar el repositorio ni correr procesos locales.',
    directUrlLabel: 'Endpoint Streamable HTTP en la Nube:',
    step1Local: '1. Obtén el repositorio (sin npm install: solo Node.js 20+)',
    step2Local: '2. Agrega el subproceso stdio local a tu asistente',
    pathNote: 'Cambia la ruta por donde clonaste el repositorio en tu máquina.',
    file: 'Archivo de configuración',
    tryTitle: 'Luego pregunta, por ejemplo',
    prompts: [
      '¿Cómo hago un airdrop de un token a cuentas que aún no lo tienen asociado?',
      'Muéstrame el lab del tópico de pago HIP-991 y explica cuánto cuesta.',
      '¿Cuánto HBAR cuestan hoy un token y 10 mints de NFT?',
      'Revisa este código buscando errores de Hedera.'
    ],
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
      <button
        type='button'
        className='btn btn-ghost btn-sm'
        onClick={() => {
          try { navigator.clipboard?.writeText(code) } catch (_) {}
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        aria-label={copied ? label.copied : label.copy}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
        <span>{copied ? label.copied : label.copy}</span>
      </button>
    </div>
  )
}

export function McpCard ({ lang }: { lang: Lang }) {
  const t = TEXT[lang]
  const [mode, setMode] = useState<'remote' | 'local'>('remote')
  const [remoteClient, setRemoteClient] = useState(REMOTE_CLIENTS[0].id)
  const [localClient, setLocalClient] = useState(LOCAL_CLIENTS[0].id)

  const rc = REMOTE_CLIENTS.find((x) => x.id === remoteClient) || REMOTE_CLIENTS[0]
  const lc = LOCAL_CLIENTS.find((x) => x.id === localClient) || LOCAL_CLIENTS[0]

  return (
    <section className='mcp-card' aria-labelledby='mcp-title' data-testid='mcp-card'>
      <div className='mcp-header-row'>
        <span className='mcp-tag'>{t.tag}</span>
      </div>
      <h2 id='mcp-title'>{t.title}</h2>
      <p className='lead'>{t.lead}</p>
      <ul className='mcp-features'>
        {t.features.map(([title, text]) => (
          <li key={title}>
            <strong>{title}:</strong> {text}
          </li>
        ))}
      </ul>

      {/* Mode Switcher: Remote URL vs Local stdio */}
      <div className='seg mcp-mode-switcher' role='tablist' aria-label={t.title}>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'remote'}
          onClick={() => setMode('remote')}
          className='mcp-mode-btn'
        >
          <span>{t.tabRemote}</span>
          <span className='mcp-mode-badge'>{t.tabRemoteRecommended}</span>
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'local'}
          onClick={() => setMode('local')}
          className='mcp-mode-btn'
        >
          <span>{t.tabLocal}</span>
        </button>
      </div>

      {mode === 'remote' ? (
        <div className='mcp-steps' data-testid='mcp-remote-panel'>
          <p className='mcp-desc-lead'>{t.remoteDesc}</p>
          <div className='mcp-direct-url-box'>
            <span className='mcp-direct-url-title'>{t.directUrlLabel}</span>
            <Cmd code={REMOTE_URL} label={t} />
          </div>

          <h3>{lang === 'es' ? 'Configuración por IDE / Asistente' : 'IDE / Assistant Configuration'}</h3>
          <div className='seg mcp-clients' role='tablist' aria-label='Remote clients'>
            {REMOTE_CLIENTS.map((x) => (
              <button
                key={x.id}
                type='button'
                role='tab'
                aria-selected={remoteClient === x.id}
                onClick={() => setRemoteClient(x.id)}
                data-testid={`mcp-client-${x.id}`}
              >
                {x.name}
              </button>
            ))}
          </div>
          {rc.file && <p className='muted mcp-file'>{t.file}: <code>{rc.file}</code></p>}
          <Cmd code={rc.code} label={t} />
        </div>
      ) : (
        <div className='mcp-steps' data-testid='mcp-local-panel'>
          <h3>{t.step1Local}</h3>
          <Cmd code={`git clone ${REPO_URL}.git`} label={t} />

          <h3>{t.step2Local}</h3>
          <div className='seg mcp-clients' role='tablist' aria-label={t.step2Local}>
            {LOCAL_CLIENTS.map((x) => (
              <button
                key={x.id}
                type='button'
                role='tab'
                aria-selected={localClient === x.id}
                onClick={() => setLocalClient(x.id)}
                data-testid={`mcp-client-${x.id}`}
              >
                {x.name}
              </button>
            ))}
          </div>
          {lc.file && <p className='muted mcp-file'>{t.file}: <code>{lc.file}</code></p>}
          <Cmd code={lc.code} label={t} />
          {lc.id !== 'vscode-local' && <p className='muted mcp-file'>{t.pathNote}</p>}
        </div>
      )}

      <h3 className='mcp-try'>{t.tryTitle}</h3>
      <ul className='mcp-prompts'>
        {t.prompts.map((p) => (
          <li key={p}>“{p}”</li>
        ))}
      </ul>
      <a
        className='mcp-more'
        href={`${REPO_URL}/tree/master/mcp#readme`}
        target='_blank'
        rel='noopener noreferrer'
      >
        {t.more} <Icon name='external' size={12} />
      </a>
    </section>
  )
}
