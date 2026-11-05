import React from 'react'
import { Icon } from './Icon'
import { REPO_URL, type Lang } from '../lib/content'
import type { Strings } from '../lib/i18n'
import type { BrowserWallet } from '../lib/hederaBrowser'

interface Props {
  t: Strings
  lang: Lang
  theme: 'light' | 'dark'
  wallet: BrowserWallet
  onHome: () => void
  onMenu: () => void
  onLang: (lang: Lang) => void
  onTheme: () => void
  onAccount: () => void
  onResources: () => void
  isResources: boolean
}

export function TopBar ({ t, lang, theme, wallet, onHome, onMenu, onLang, onTheme, onAccount, onResources, isResources }: Props) {
  const hasAccount = !!wallet.accountId
  return (
    <header className='topbar'>
      <button type='button' className='icon-btn topbar-menu' onClick={onMenu} aria-label={t.menu}>
        <Icon name='menu' size={20} />
      </button>

      <div className='brand-cluster'>
        <a
          href='#index'
          className='brand-logo-link'
          tabIndex={-1}
          aria-hidden='true'
          onClick={(e) => { e.preventDefault(); onHome() }}
        >
          <img
            src='/brand-logo.png'
            alt=''
            className='brand-logo-img'
            width={34}
            height={38}
          />
        </a>

        <div className='brand-text-stack'>
          <a
            href='#index'
            className='brand-title-link'
            onClick={(e) => { e.preventDefault(); onHome() }}
            aria-label={`${t.siteName} - ${lang === 'es' ? 'Inicio' : 'Home'}`}
          >
            <span className='brand-title-l1'>HEDERA BY</span>
            <span className='brand-title-l2'>EXAMPLE</span>
          </a>
          <a
            href='https://effisend.xyz'
            target='_blank'
            rel='noopener noreferrer'
            className='brand-byline-link'
            aria-label={lang === 'es' ? 'Hedera by Example, por Effisend' : 'Hedera by Example, by Effisend'}
            title={lang === 'es' ? 'Desarrollado por Effisend' : 'Built by Effisend'}
          >
            <span className='brand-byline-lead'>{lang === 'es' ? 'por' : 'by'}</span>
            <span className='brand-byline-name'>Effisend</span>
          </a>
        </div>
      </div>

      <div className='topbar-actions'>
        <a
          href='#resources'
          className={`topbar-link ${isResources ? 'is-active' : ''}`}
          data-testid='resources-button'
          aria-current={isResources ? 'page' : undefined}
          onClick={(e) => { e.preventDefault(); onResources() }}
        >
          <Icon name='grid' size={16} />
          <span className='topbar-link-label'>{lang === 'es' ? 'Recursos' : 'Resources'}</span>
        </a>
        <button
          type='button'
          className='account-btn'
          data-testid='account-button'
          onClick={onAccount}
          title={t.wallets}
        >
          <span className={`account-dot ${hasAccount ? 'is-on' : ''}`} aria-hidden='true' />
          <span className='account-btn-label'>
            {hasAccount ? wallet.accountId : wallet.privateKey ? t.wallets : t.createWallet}
          </span>
          {hasAccount && wallet.balanceHbar != null && (
            <span className='account-btn-balance'>{wallet.balanceHbar.toFixed(2)} ℏ</span>
          )}
        </button>

        <div className='lang-switch' role='group' aria-label={t.language}>
          {(['en', 'es'] as Lang[]).map((l) => (
            <button
              key={l}
              type='button'
              aria-pressed={lang === l}
              onClick={() => onLang(l)}
              lang={l}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          type='button'
          className='icon-btn'
          onClick={onTheme}
          aria-label={theme === 'dark' ? t.toLight : t.toDark}
          title={theme === 'dark' ? t.toLight : t.toDark}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
        </button>

        <a className='icon-btn topbar-github' href={REPO_URL} target='_blank' rel='noopener noreferrer' aria-label='GitHub' title='GitHub'>
          <Icon name='github' size={18} />
        </a>
      </div>
    </header>
  )
}
