import React from 'react'
import { INDEX, FIRST_SLUG, getBody, moduleLabel, type Lang, type ModuleMeta } from '../lib/content'
import { difficultyLabel, labRequirements } from '../lib/labPrep'
import type { Strings } from '../lib/i18n'
import { McpCard } from './McpCard'

interface Props {
  t: Strings
  lang: Lang
  modules: ModuleMeta[]
  done: string[]
  onSelect: (slug: string) => void
}

export function CourseIndex ({ t, lang, modules, done, onSelect }: Props) {
  const finished = new Set(done)
  return (
    <div className='page index-page'>
      <header className='index-hero'>
        <h1>{t.indexTitle}</h1>
        <a
          href='https://effisend.xyz'
          target='_blank'
          rel='noopener noreferrer'
          className='hero-brand-byline'
          aria-label={lang === 'es' ? 'Desarrollado por Effisend' : 'Built by Effisend'}
          title={lang === 'es' ? 'Desarrollado por Effisend' : 'Built by Effisend'}
        >
          <span className='hero-byline-credit'>{lang === 'es' ? 'por' : 'by'}</span>
          <span className='hero-byline-name'>Effisend</span>
        </a>
        <p className='lead'>{t.indexLead(INDEX.labCount, INDEX.modules.length, INDEX.sdk)}</p>
        <a
          className='btn btn-primary'
          href={`#${FIRST_SLUG}`}
          onClick={(e) => { e.preventDefault(); onSelect(FIRST_SLUG) }}
        >
          {t.startHere}
        </a>
      </header>

      <section className='how' aria-labelledby='how-title'>
        <h2 id='how-title' className='section-title'>{t.howTitle}</h2>
        <ol className='how-list'>
          <li><strong>{t.how1t}.</strong> {t.how1}</li>
          <li><strong>{t.how2t}.</strong> {t.how2}</li>
          <li><strong>{t.how3t}.</strong> {t.how3}</li>
        </ol>
      </section>

      <div className='index-modules'>
        {modules.map((mod) => {
          const doneCount = mod.labs.filter((lab) => finished.has(lab.slug)).length
          return (
          <section key={mod.id} className='index-module' aria-labelledby={`mod-${mod.id}`}>
            <div className='index-module-head'>
              <span className='index-module-num'>{t.module} {moduleLabel(mod)}</span>
              <span className='index-module-count'>{t.labsCount(mod.labs.length)}{doneCount ? ` · ${doneCount}` : ''}</span>
            </div>
            <h2 id={`mod-${mod.id}`}>{mod[lang].title}</h2>
            {(mod[lang].objective || mod[lang].subtitle) && (
              <p className='index-module-desc'>{mod[lang].objective || mod[lang].subtitle}</p>
            )}
            <ol className='index-labs'>
              {mod.labs.map((lab) => {
                const req = labRequirements(getBody(lang, lab.slug).before)
                return (
                <li key={lab.slug}>
                  <a href={`#${lab.slug}`} onClick={(e) => { e.preventDefault(); onSelect(lab.slug) }}>
                    <span className='toc-num'>{Number(lab.n)}</span>
                    <span>{lab[lang].title}</span>
                    <span className={`tag tag-diff tag-${req.difficulty}`}>{difficultyLabel(req.difficulty, req.firstHbar, lang)}</span>
                    {finished.has(lab.slug) && <span className='toc-done' aria-label={lang === 'es' ? 'Completado' : 'Completed'}>✓</span>}
                  </a>
                </li>
                )
              })}
            </ol>
          </section>
          )
        })}
      </div>

      <McpCard lang={lang} />
    </div>
  )
}
