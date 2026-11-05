import { useEffect } from 'react'
import { usePathname } from 'expo-router'
import Head from 'expo-router/head'

/**
 * Static-export 404. Shared links often drop the hash (`/m00-01-…` instead of
 * `/#m00-01-…`). Send those to the hash route the app actually renders.
 */
export default function NotFound () {
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const slug = decodeURIComponent((pathname || window.location.pathname).replace(/^\/+|\/+$/g, ''))
    if (!slug || slug.startsWith('api/') || slug.startsWith('_expo') || slug.startsWith('source/')) return
    window.location.replace(`${window.location.origin}/#${slug}`)
  }, [pathname])

  return (
    <>
      <Head>
        <title>Page not found · Hedera by Example</title>
      </Head>
      <main className='page' style={{ maxWidth: 640, margin: '12vh auto' }}>
        <p className='section-title'>Hedera by Example</p>
        <h1>This address is not a lab</h1>
        <p className='lead'>
          Labs open with a hash, for example <code>/#m00-01-generate-wallet</code>.
          A link without the <code>#</code> is forwarded there.
        </p>
        <p>
          <a className='btn btn-primary' href='/#index'>All labs</a>
        </p>
      </main>
    </>
  )
}
