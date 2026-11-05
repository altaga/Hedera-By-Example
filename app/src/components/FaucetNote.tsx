import type { Lang } from '../lib/content'

/** The only faucet learners should use. This app's operator is not a deposit address. */
export const OFFICIAL_FAUCET_URL = 'https://portal.hedera.com/faucet'

/**
 * Shown wherever a learner may not have enough testnet HBAR.
 * The link is the official portal; no operator or treasury id is named.
 */
export function FaucetNote ({ lang }: { lang: Lang }) {
  return (
    <p className='faucet-more' data-testid='faucet-more-note'>
      {lang === 'es'
        ? <>Si el drop de bienvenida no alcanza, pide más HBAR de testnet en el faucet oficial de Hedera:{' '}
            <a href={OFFICIAL_FAUCET_URL} target='_blank' rel='noopener noreferrer'>https://portal.hedera.com/faucet</a>
            {' '}(usa TU propio Account ID, por ejemplo 0.0.xxxx). No envíes fondos a la cuenta faucet/operadora de esta app: no es un lugar para depositar; solo fondea el drop de bienvenida.</>
        : <>If the Welcome Drop is not enough, request more testnet HBAR from the official Hedera faucet:{' '}
            <a href={OFFICIAL_FAUCET_URL} target='_blank' rel='noopener noreferrer'>https://portal.hedera.com/faucet</a>
            {' '}(use YOUR own account ID, e.g. 0.0.xxxx). Do not send funds to this app&apos;s faucet/operator account — it is not a place to deposit; it only funds the Welcome Drop.</>}
    </p>
  )
}
