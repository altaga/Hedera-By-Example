import type { PropsWithChildren } from 'react'
import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html'

/**
 * Custom web document for Expo Router (SDK 58).
 * MUST render headNodes/bodyNodes from useServerDocumentContext so Expo can
 * inject CSS and JS bundles. Discovery tags for agents stay in the static head.
 */
export default function Root ({ children }: PropsWithChildren) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext()

  return (
    <html lang='en' {...htmlAttributes}>
      <head>
        <meta charSet='utf-8' />
        <meta httpEquiv='X-UA-Compatible' content='IE=edge' />
        <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no' />
        <meta
          name='description'
          content='Learn Hedera by reading and running 131 small, complete @hiero-ledger/sdk programs. MCP server at https://hbe.expo.app/api/mcp.'
        />
        <meta name='mcp' content='https://hbe.expo.app/api/mcp' />
        <link rel='alternate' type='text/plain' title='llms.txt' href='/llms.txt' />
        <link rel='alternate' type='text/plain' title='llms-full.txt' href='/llms-full.txt' />
        <link rel='alternate' type='application/json' title='MCP manifest' href='/mcp/manifest.json' />
        <link rel='icon' href='/favicon.ico' />
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  )
}
