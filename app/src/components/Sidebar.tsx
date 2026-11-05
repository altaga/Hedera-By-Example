import React, { useEffect, useRef } from 'react'
import { Icon } from './Icon'
import { getBody, moduleLabel, type Lang, type ModuleMeta } from '../lib/content'
import { difficultyLabel, labRequirements } from '../lib/labPrep'
import type { Strings } from '../lib/i18n'

interface Props {
  t: Strings
  lang: Lang
  modules: ModuleMeta[]
  done: string[]
  query: string
  onQuery: (q: string) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  currentSlug: string | null
  currentModId: string | null
  openMods: Record<string, boolean>
  onToggleMod: (id: string) => void
  onSelect: (slug: string) => void
  onIndex: () => void
  isIndex: boolean
  open: boolean
  onClose: () => void
}

export function Sidebar (props: Props) {
  const { t, lang, modules, done, query, onQuery, searchRef, currentSlug, currentModId, openMods, onToggleMod, onSelect, onIndex, isIndex, open, onClose } = props
  const finished = new Set(done)
  const currentRef = useRef<HTMLAnchorElement | null>(null)

  // Keep the current lab visible in the list when navigating.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentSlug])

  const searching = !!query.trim()

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'is-open' : ''}`} onClick={onClose} aria-hidden='true' />
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label={t.contents}>
        <div className='sidebar-head'>
          <div className='search'>
            <Icon name='search' size={15} />
            <input
              ref={searchRef}
              type='search'
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchLabel}
            />
            <kbd aria-hidden='true'>/</kbd>
          </div>
          <button type='button' className='icon-btn sidebar-close' onClick={onClose} aria-label={t.closeMenu}>
            <Icon name='close' size={18} />
          </button>
        </div>

        <nav className='toc'>
          <a
            href='#index'
            className='toc-index'
            aria-current={isIndex ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); onIndex() }}
          >
            {t.allLabs}
          </a>

          {modules.length === 0 && <p className='toc-empty'>{t.noResults}</p>}

          <ol className='toc-modules'>
            {modules.map((mod) => {
              const expanded = searching || (openMods[mod.id] ?? mod.id === currentModId)
              return (
                <li key={mod.id} className='toc-module'>
                  <button
                    type='button'
                    className='toc-module-btn'
                    aria-expanded={expanded}
                    data-current={mod.id === currentModId}
                    onClick={() => onToggleMod(mod.id)}
                  >
                    <span className='toc-num'>{moduleLabel(mod)}</span>
                    <span className='toc-module-title'>{mod[lang].title}</span>
                    <span className='toc-chevron'><Icon name='chevron' size={14} /></span>
                  </button>
                  {expanded && (
                    <ol className='toc-labs'>
                      {mod.labs.map((lab) => {
                        const isCurrent = lab.slug === currentSlug
                        const req = labRequirements(getBody(lang, lab.slug).before)
                        const level = difficultyLabel(req.difficulty, req.firstHbar, lang)
                        return (
                          <li key={lab.slug}>
                            <a
                              href={`#${lab.slug}`}
                              ref={isCurrent ? currentRef : undefined}
                              aria-current={isCurrent ? 'page' : undefined}
                              title={level}
                              onClick={(e) => { e.preventDefault(); onSelect(lab.slug) }}
                            >
                              <span className='toc-num'>{Number(lab.n)}</span>
                              <span>{lab[lang].title}</span>
                              {finished.has(lab.slug) && <span className='toc-done' aria-label={lang === 'es' ? 'Completado' : 'Completed'}>✓</span>}
                            </a>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>

        <p className='sidebar-foot'>{t.shortcuts}</p>
      </aside>
    </>
  )
}
