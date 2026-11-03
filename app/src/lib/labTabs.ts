/**
 * @file labTabs.ts
 * Multi-file code tab orchestration for Hedera by Example.
 * Decomposes monolithic exercises into modular, accessible tabs:
 * Main runner, auxiliary Solidity contracts (.sol), extracted classes/engines,
 * assets (.json, .csv), and M99 utilities.
 */

import type { LabBody, LabEntry, Lang } from './content'
import { M99_UTILITIES_SOURCE } from './m99Content'

export interface ExtractedClass {
  name: string
  code: string
  start: number
  end: number
}

export interface LabCodeFile {
  id: string
  name: string
  kind: 'main' | 'class' | 'contract' | 'util' | 'asset'
  badge: string
  description?: string
  code: string
  readOnly?: boolean
}

/**
 * Extracts class definitions from a monolithic script.
 */
export function extractClassesFromCode(source: string): {
  classes: ExtractedClass[]
  mainWithoutClasses: string
} {
  const re = /class\s+([A-Za-z0-9_]+)\s*\{/g
  let match: RegExpExecArray | null
  const classes: ExtractedClass[] = []

  while ((match = re.exec(source)) !== null) {
    const className = match[1]
    const startIndex = match.index
    let depth = 0
    let endIndex = -1

    for (let i = startIndex; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) {
          endIndex = i + 1
          break
        }
      }
    }

    if (endIndex > -1) {
      classes.push({
        name: className,
        code: source.slice(startIndex, endIndex),
        start: startIndex,
        end: endIndex,
      })
      re.lastIndex = endIndex
    }
  }

  if (classes.length === 0) {
    return { classes: [], mainWithoutClasses: source }
  }

  // Replace class regions in reverse order to keep offsets valid
  let mainWithoutClasses = source
  for (let i = classes.length - 1; i >= 0; i--) {
    const c = classes[i]
    const placeholder = `// ----------------------------------------------------------------------------\n// ⚡ [COMPANION TAB: ${c.name}.js]\n// Class logic extracted into companion tab for modular study and execution.\n// ----------------------------------------------------------------------------`
    mainWithoutClasses =
      mainWithoutClasses.slice(0, c.start) + placeholder + mainWithoutClasses.slice(c.end)
  }

  return { classes, mainWithoutClasses }
}

/**
 * Recombines class codes with main code for browser execution.
 */
export function recombineCode(
  mainCode: string,
  classMap: Record<string, string>,
  orderedClassNames: string[]
): string {
  if (orderedClassNames.length === 0) return mainCode

  // Check if mainCode already contains the class declarations
  const hasClassesAlready = orderedClassNames.some((name) =>
    new RegExp(`class\\s+${name}\\b`).test(mainCode)
  )
  if (hasClassesAlready) return mainCode

  // Prepend class definitions right before the first function/main execution
  const classesBlock = orderedClassNames
    .map((name) => classMap[name])
    .filter(Boolean)
    .join('\n\n')

  return `${classesBlock}\n\n${mainCode}`
}

/**
 * Constructs the full list of file tabs for a given lab.
 */
export function buildLabFileTabs({
  code,
  entry,
  body,
  lang,
  auxiliaryTexts,
}: {
  code: string
  entry: LabEntry
  body: LabBody
  lang: Lang
  auxiliaryTexts: Record<string, string>
}): {
  tabs: LabCodeFile[]
  classes: ExtractedClass[]
} {
  const tabs: LabCodeFile[] = []

  // 1. Check for extracted classes
  const { classes, mainWithoutClasses } = extractClassesFromCode(code)

  // 1. Main runner tab
  const mainName = entry.lab.file || 'main.js'
  tabs.push({
    id: 'main',
    name: mainName,
    kind: 'main',
    badge: 'JS',
    description:
      lang === 'es'
        ? 'Punto de entrada y flujo de ejecución en Hedera'
        : 'Entry point and transaction execution flow on Hedera',
    code: classes.length > 0 ? mainWithoutClasses : code,
    readOnly: false,
  })

  // 2. Extracted class tabs
  for (const c of classes) {
    tabs.push({
      id: `class:${c.name}`,
      name: `${c.name}.js`,
      kind: 'class',
      badge: 'CLASS',
      description:
        lang === 'es'
          ? `Módulo modular: ${c.name} (arquitectura desacoplada)`
          : `Modular class component: ${c.name} (decoupled architecture)`,
      code: c.code,
      readOnly: false,
    })
  }

  // 3. Auxiliary files (.sol, .csv, .json, .md)
  if (Array.isArray(body.files)) {
    for (const f of body.files) {
      const ext = f.name.split('.').pop()?.toLowerCase() || ''
      let kind: LabCodeFile['kind'] = 'asset'
      let badge = ext.toUpperCase()

      if (ext === 'sol') {
        kind = 'contract'
        badge = 'SOL'
      } else if (ext === 'json') {
        kind = 'asset'
        badge = 'JSON'
      } else if (ext === 'csv') {
        kind = 'asset'
        badge = 'CSV'
      } else if (ext === 'md') {
        kind = 'asset'
        badge = 'MD'
      }

      const fileContent = auxiliaryTexts[f.name] || `// Loading ${f.name}...`

      tabs.push({
        id: `file:${f.name}`,
        name: f.name,
        kind,
        badge,
        description:
          ext === 'sol'
            ? lang === 'es'
              ? 'Smart Contract Solidity desplegado en el EVM de Hedera'
              : 'Solidity Smart Contract deployed to the Hedera EVM'
            : lang === 'es'
              ? `Archivo de datos utilizado por el laboratorio (${f.name})`
              : `Data asset utilized by the lab (${f.name})`,
        code: fileContent,
        readOnly: false,
      })
    }
  }

  // 4. M99 Utilities tab if imported
  if (code.includes('M99_Utilities') || code.includes('../M99_Utilities')) {
    tabs.push({
      id: 'util:m99',
      name: 'M99_Utilities.js',
      kind: 'util',
      badge: 'UTIL',
      description:
        lang === 'es'
          ? 'Utilidades de resiliencia, estimación de gas y reuso de contratos/tokens en Testnet'
          : 'Resilience helpers, gas estimation loops, and testnet asset recycling utilities',
      code: M99_UTILITIES_SOURCE,
      readOnly: true,
    })
  }

  return { tabs, classes }
}
