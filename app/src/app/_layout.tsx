import '../global.css'
import { Slot } from 'expo-router'
import Head from 'expo-router/head'

export default function RootLayout () {
  return (
    <>
      <Head>
        <title>Hedera by Example by Effisend</title>
        <meta
          name='description'
          content='Learn Hedera by reading and running 131 small, complete @hiero-ledger/sdk programs: annotated walkthroughs, exact source files and a browser runner for testnet.'
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
