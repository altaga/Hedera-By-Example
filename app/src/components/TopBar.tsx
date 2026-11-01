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
}

export function TopBar ({ t, lang, theme, wallet, onHome, onMenu, onLang, onTheme, onAccount }: Props) {
  const hasAccount = !!wallet.accountId
  return (
    <header className='topbar'>
      <button type='button' className='icon-btn topbar-menu' onClick={onMenu} aria-label={t.menu}>
        <Icon name='menu' size={20} />
      </button>

      <a
        href='#index'
        className='wordmark'
        onClick={(e) => { e.preventDefault(); onHome() }}
      >
        <span className='wordmark-mark' aria-hidden='true'>ℏ</span>
        <span>{t.siteName}</span>
      </a>

      <div className='topbar-actions'>
        <button
          type='button'
          className='account-btn'
          data-testid='account-button'
          onClick={onAccount}
          title={t.account}
        >
          <span className={`account-dot ${hasAccount ? 'is-on' : ''}`} aria-hidden='true' />
          <span className='account-btn-label'>
            {hasAccount ? wallet.accountId : t.account}
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
