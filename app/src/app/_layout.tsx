import '../global.css'
import { Slot } from 'expo-router'
import Head from 'expo-router/head'
import { SITE_TITLE } from '../lib/uiState.mjs'

export default function RootLayout () {
  // Pageviews are recorded only in index.tsx (hash-route navigation). Do not
  // also fire from usePathname here — that double-counted every load as view=router.
  return (
    <>
      <Head>
        <title>{SITE_TITLE}</title>
        <meta
          name='description'
          content='Learn Hedera by reading and running 131 small, complete @hiero-ledger/sdk programs: annotated walkthroughs, exact source files and a browser runner for testnet. MCP server at /api/mcp.'
        />
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
