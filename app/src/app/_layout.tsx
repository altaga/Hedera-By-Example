import '../lib/hashGuard'
import '../global.css'
import { Slot } from 'expo-router'
import Head from 'expo-router/head'
import { SITE_TITLE } from '../lib/uiState.mjs'

export default function RootLayout () {
  // No custom +html.tsx — Expo's default document injects CSS/JS.
  // Discovery hints via expo-router/head only (does not replace the HTML shell).
  return (
    <>
      <Head>
        <title>{SITE_TITLE}</title>
        <meta
          name='description'
          content='Learn Hedera by reading and running 131 small, complete @hiero-ledger/sdk programs: annotated walkthroughs, exact source files and a browser runner for testnet. MCP server at https://hbe.expo.app/api/mcp.'
        />
        <meta name='mcp' content='https://hbe.expo.app/api/mcp' />
        <link rel='alternate' type='text/plain' title='llms.txt' href='/llms.txt' />
        <link rel='alternate' type='text/plain' title='llms-full.txt' href='/llms-full.txt' />
        <link rel='alternate' type='application/json' title='MCP manifest' href='/mcp/manifest.json' />
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        <link rel='preconnect' href='https://fonts.gstatic.com' crossOrigin='anonymous' />
        <link
          rel='stylesheet'
          href='https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap'
        />
      </Head>
      <Slot />
    </>
  )
}
