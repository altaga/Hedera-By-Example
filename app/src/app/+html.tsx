import type { PropsWithChildren } from 'react'
import { ScrollViewStyleReset } from 'expo-router/html'

/**
 * Custom web document. Static discovery hints for agents (llms.txt + MCP) live here
 * so they appear in the raw HTML without waiting for client hydration.
 */
export default function Root ({ children }: PropsWithChildren) {
  return (
    <html lang='en'>
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
      </head>
      <body>{children}</body>
    </html>
  )
}
