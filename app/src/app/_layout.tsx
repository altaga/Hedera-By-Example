import '../global.css'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { Slot, usePathname } from 'expo-router'
import Head from 'expo-router/head'
import { SITE_TITLE } from '../lib/uiState.mjs'
import { recordPageView } from '../lib/pageAnalytics'

export default function RootLayout () {
  const pathname = usePathname()

  // Web-only: fire on Expo Router pathname changes. Lab navigation uses hash
  // routes inside index.tsx, which also records pageviews there.
  useEffect(() => {
    if (Platform.OS !== 'web') return
    recordPageView({
      path: pathname || '/',
      view: 'router'
    })
  }, [pathname])

  return (
    <>
      <Head>
        <title>{SITE_TITLE}</title>
        <meta
          name='description'
          content='Learn Hedera by reading and running 131 small, complete @hiero-ledger/sdk programs: annotated walkthroughs, exact source files and a browser runner for testnet. MCP server at /api/mcp.'
        />
        <link rel='alternate' type='text/plain' title='llms.txt' href='/llms.txt' />
        <link rel='alternate' type='text/plain' title='llms-full.txt' href='/llms-full.txt' />
        <link rel='alternate' type='application/json' title='MCP manifest' href='/mcp/manifest.json' />
        <meta name='mcp' content='https://hbe.expo.app/api/mcp' />
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
