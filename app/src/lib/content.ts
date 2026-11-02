import rawIndex from '../content/index.json'
import rawEn from '../content/en.json'
import rawEs from '../content/es.json'

export type Lang = 'en' | 'es'

export interface LabMeta {
  slug: string
  n: string
  file: string
  sdk: string[]
  en: { title: string; kicker: string }
  es: { title: string; kicker: string }
}

export interface ModuleMeta {
  id: string
  n: number
  dir: string
  en: { title: string; subtitle: string; objective: string }
  es: { title: string; subtitle: string; objective: string }
  labs: LabMeta[]
}

export interface Segment {
  doc: string[]
  code: string
  start: number
}

export interface LabBody {
  title: string
  kicker: string
  concept: string[]
  moment: string
  refs: string[]
  sdk: string[]
  segments: Segment[]
  lines: number
  /** Non-code files the lab reads (course assets, .sol sources). */
  files: { name: string; url: string }[]
  /** Parties and messages, from the lab's [ SEQUENCE ] header section. */
  sequence: { actors: string[]; steps: any[] } | null
  /** What this lab simulates and what is real on testnet. */
  simulated: string
  /** Imported modules the web runner cannot provide; the lab runs in Node.js only. */
  nodeOnly: string[]
}

export interface LabEntry {
  mod: ModuleMeta
  lab: LabMeta
  idx: number
}

export const INDEX = rawIndex as { modules: ModuleMeta[]; sdk: string; labCount: number }
export const BODIES: Record<Lang, Record<string, LabBody>> = {
  en: rawEn as Record<string, LabBody>,
  es: rawEs as Record<string, LabBody>
}

export const REPO_URL = 'https://github.com/altaga/Hedera-By-Example'
export const REPO_BRANCH = 'master'

export const FLAT_LABS: LabEntry[] = INDEX.modules.flatMap((mod) => mod.labs.map((lab) => ({ mod, lab, idx: 0 })))
FLAT_LABS.forEach((e, i) => { e.idx = i })

export const LAB_BY_SLUG = new Map(FLAT_LABS.map((e) => [e.lab.slug, e]))
export const FIRST_SLUG = FLAT_LABS[0].lab.slug

export const getBody = (lang: Lang, slug: string): LabBody => BODIES[lang][slug] || BODIES.en[slug]

const LANG_FOLDER: Record<Lang, string> = { en: 'English', es: 'Spanish' }

/** Path of the lab inside the course/ folder, e.g. English/M5_.../01_x.js */
export const coursePath = (lang: Lang, entry: LabEntry) => `${LANG_FOLDER[lang]}/${entry.mod.dir}/${entry.lab.file}`

export const githubUrl = (lang: Lang, entry: LabEntry) =>
  `${REPO_URL}/blob/${REPO_BRANCH}/course/${coursePath(lang, entry)}`

/** Exact lab file, published by scripts/build-content.mjs into public/source. */
export const sourceUrl = (lang: Lang, slug: string) => `/source/${lang}/${slug}.js`

/** The code that runs in the browser: the lab without its comments. */
export const runnableCode = (body: LabBody) => body.segments.map((s) => s.code).filter(Boolean).join('\n\n')

export const moduleLabel = (mod: ModuleMeta) => String(mod.n).padStart(2, '0')

export function searchModules (query: string, lang: Lang): ModuleMeta[] {
  const q = query.trim().toLowerCase()
  if (!q) return INDEX.modules
  return INDEX.modules
    .map((mod) => {
      const modMatch = mod[lang].title.toLowerCase().includes(q) || mod[lang].subtitle.toLowerCase().includes(q)
      const labs = mod.labs.filter((lab) => {
        if (modMatch) return true
        const body = BODIES[lang][lab.slug]
        return (
          lab.file.toLowerCase().includes(q) ||
          lab[lang].title.toLowerCase().includes(q) ||
          lab[lang].kicker.toLowerCase().includes(q) ||
          lab.sdk.some((s) => s.toLowerCase().includes(q)) ||
          !!body?.concept.some((p) => p.toLowerCase().includes(q))
        )
      })
      return { ...mod, labs }
    })
    .filter((m) => m.labs.length > 0)
}
