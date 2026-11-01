import '../global.css'
import { Slot } from 'expo-router'
import Head from 'expo-router/head'

export default function RootLayout () {
  return (
    <>
      <Head>
        <title>Hedera by Example — 131 Annotated @hiero-ledger/sdk Programs</title>
        <meta
          name="description"
          content="Hands-on introduction to Hedera Hashgraph using 131 annotated, runnable @hiero-ledger/sdk Node.js programs across 16 modules (HCS, HTS, HSCS EVM, x402, DePIN)."
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <Slot />
    </>
  )
}
