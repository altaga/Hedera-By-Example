/**
 * @file labTabs.ts
 * Multi-file code tab orchestration for Hedera by Example.
 * Decomposes monolithic exercises into modular, accessible tabs:
 * Main runner, auxiliary Solidity contracts (.sol), extracted classes/engines,
 * standalone helper utilities, assets (.json, .csv), and M99 utilities.
 */

import type { LabBody, LabEntry, Lang } from './content'
import { M99_UTILITIES_SOURCE } from './m99Content'

export interface ExtractedCompanionModule {
  id: string
  name: string
  kind: 'class' | 'util'
  badge: 'CLASS' | 'UTIL'
  description?: string
  code: string
  start: number
  end: number
  startLine: number
  endLine: number
  segments: Array<{ doc: string[]; code: string; start: number }>
}

export interface LabWalkthroughSegment {
  doc: string[]
  code?: string
  start?: number
  companionModule?: ExtractedCompanionModule
}

export interface LabCodeFile {
  id: string
  name: string
  kind: 'main' | 'class' | 'contract' | 'util' | 'asset'
  badge: string
  description?: string
  code: string
  readOnly?: boolean
  segments?: LabWalkthroughSegment[]
}

/**
 * Extracts class and standalone helper function definitions outside/before main().
 */
export function extractCompanionModulesFromCode(source: string, lang: Lang): {
  modules: ExtractedCompanionModule[]
  mainWithoutModules: string
} {
  const mainMatch = /(?:async\s+function\s+main|const\s+main\s*=|function\s+main\b)/.exec(source)
  const mainPos = mainMatch ? mainMatch.index : source.length
  const preMain = source.slice(0, mainPos)

  const modules: ExtractedCompanionModule[] = []

  // 1. Classes: class ClassName { ... }
  const classRe = /class\s+([A-Za-z0-9_]+)\s*\{/g
  let match: RegExpExecArray | null

  while ((match = classRe.exec(preMain)) !== null) {
    const className = match[1]
    const startIndex = match.index
    let depth = 0
    let endIndex = -1

    for (let i = startIndex; i < preMain.length; i++) {
      if (preMain[i] === '{') depth++
      else if (preMain[i] === '}') {
        depth--
        if (depth === 0) {
          endIndex = i + 1
          break
        }
      }
    }

    if (endIndex > -1) {
      const code = preMain.slice(startIndex, endIndex)
      const startLine = preMain.slice(0, startIndex).split('\n').length
      const endLine = startLine + code.split('\n').length - 1
      modules.push({
        id: `class:${className}`,
        name: className,
        kind: 'class',
        badge: 'CLASS',
        description:
          lang === 'es'
            ? `Definición de clase: ${className}`
            : `Class definition: ${className}`,
        code,
        start: startIndex,
        end: endIndex,
        startLine,
        endLine,
        segments: [],
      })
      classRe.lastIndex = endIndex
    }
  }

  // 2. Standalone top-level helper functions before main (>= 8 lines of logic)
  const fnRe =
    /(?:const|let|var|function)\s+([A-Za-z0-9_]+)\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\([^)]*\)\s*\{)/g

  while ((match = fnRe.exec(preMain)) !== null) {
    const fnName = match[1]
    if (fnName === 'main' || (fnName.startsWith('get') && fnName.endsWith('Client'))) continue
    const startIndex = match.index
    // Avoid re-extracting methods inside already extracted classes
    if (modules.some((mod) => startIndex >= mod.start && startIndex < mod.end)) continue

    const braceIdx = preMain.indexOf('{', startIndex)
    if (braceIdx > -1) {
      let depth = 0
      let endIndex = -1

      for (let i = braceIdx; i < preMain.length; i++) {
        if (preMain[i] === '{') depth++
        else if (preMain[i] === '}') {
          depth--
          if (depth === 0) {
            endIndex = i + 1
            break
          }
        }
      }

      if (endIndex > -1) {
        const code = preMain.slice(startIndex, endIndex)
        const lineCount = code.split('\n').length
        if (lineCount >= 8) {
          const startLine = preMain.slice(0, startIndex).split('\n').length
          const endLine = startLine + lineCount - 1
          modules.push({
            id: `util:${fnName}`,
            name: fnName,
            kind: 'util',
            badge: 'UTIL',
            description:
              lang === 'es'
                ? `Función auxiliar: ${fnName}`
                : `Utility helper function: ${fnName}`,
            code,
            start: startIndex,
            end: endIndex,
            startLine,
            endLine,
            segments: [],
          })
          fnRe.lastIndex = endIndex
        }
      }
    }
  }

  // Sort modules by start position
  modules.sort((a, b) => a.start - b.start)

  if (modules.length === 0) {
    return { modules: [], mainWithoutModules: source }
  }

  // Replace module regions in reverse order to keep character offsets valid
  let mainWithoutModules = source
  const reverseModules = [...modules].sort((a, b) => b.start - a.start)
  for (const m of reverseModules) {
    const placeholder = `// ----------------------------------------------------------------------------\n// [Module: ${m.name}.js]\n// ${m.description || 'Definition in companion tab.'}\n// ----------------------------------------------------------------------------`
    mainWithoutModules =
      mainWithoutModules.slice(0, m.start) + placeholder + mainWithoutModules.slice(m.end)
  }

  return { modules, mainWithoutModules }
}

/**
 * Recombines companion module codes with main code for browser sandbox execution.
 */
export function recombineCode(
  mainCode: string,
  moduleMap: Record<string, string>,
  orderedModuleNames: string[]
): string {
  if (orderedModuleNames.length === 0) return mainCode

  const missingBlocks: string[] = []

  for (const name of orderedModuleNames) {
    const code = moduleMap[name]
    if (!code) continue
    const regex = new RegExp(`(?:class|const|let|var|function)\\s+${name}\\b`)
    if (!regex.test(mainCode)) {
      missingBlocks.push(code)
    }
  }

  if (missingBlocks.length === 0) return mainCode

  const combinedHeader = missingBlocks.join('\n\n')
  return `${combinedHeader}\n\n${mainCode}`
}

/**
 * Constructs the full list of file tabs for a given lab, cleanly partitioning
 * walkthrough segments so monolithic exercises are displayed modularly.
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
  modules: ExtractedCompanionModule[]
} {
  const tabs: LabCodeFile[] = []

  // 1. Extract classes and helper functions
  const { modules, mainWithoutModules } = extractCompanionModulesFromCode(code, lang)

  // 2. Partition walkthrough segments between main and companion modules
  const rawSegments = body.segments || []
  const mainSegments: LabWalkthroughSegment[] = []
  const insertedCallouts = new Set<string>()

  for (const seg of rawSegments) {
    let matchedModule: ExtractedCompanionModule | null = null

    for (const mod of modules) {
      const trimmedCode = seg.code ? seg.code.trim() : ''
      if (!trimmedCode) continue
      const firstLine = trimmedCode.split('\n')[0].trim()
      if (
        mod.code.includes(trimmedCode) ||
        (firstLine.length > 5 && mod.code.includes(firstLine))
      ) {
        matchedModule = mod
        break
      }
    }

    if (matchedModule) {
      const mainRegex = /(?:\n|^)(?:const|async\s+function|function)\s+main\b/
      const mainMatch = mainRegex.exec(seg.code || '')

      if (mainMatch) {
        // Straddling segment: cleanly split between module and main to prevent any code bleed
        const modPartCode = seg.code.slice(0, mainMatch.index).trim()
        const mainPartCode = seg.code.slice(mainMatch.index).trim()

        if (modPartCode) {
          matchedModule.segments.push({ ...seg, code: modPartCode })
        }
        if (!insertedCallouts.has(matchedModule.id)) {
          insertedCallouts.add(matchedModule.id)
          mainSegments.push({
            doc: [
              lang === 'es'
                ? `**Módulo: ${matchedModule.name}.js**`
                : `**Module: ${matchedModule.name}.js**`,
              lang === 'es'
                ? `La definición de \`${matchedModule.name}\` se encuentra en la pestaña \`${matchedModule.name}.js\` de la barra superior.`
                : `The definition of \`${matchedModule.name}\` is located in the \`${matchedModule.name}.js\` tab above.`,
            ],
            code: `// [Module: ${matchedModule.name}.js]\n// ${lang === 'es' ? `Ver pestaña "${matchedModule.name}.js" arriba.` : `See "${matchedModule.name}.js" tab above.`}`,
            start: matchedModule.startLine,
            companionModule: matchedModule,
          })
        }
        if (mainPartCode) {
          mainSegments.push({
            doc: lang === 'es' ? ['Flujo principal de ejecución'] : ['Main execution flow'],
            code: mainPartCode,
            start: seg.start,
          })
        }
      } else {
        // Add segment to companion module walkthrough
        matchedModule.segments.push(seg)

        // Add a single companion callout row in main walkthrough at the insertion point
        if (!insertedCallouts.has(matchedModule.id)) {
          insertedCallouts.add(matchedModule.id)
          mainSegments.push({
            doc: [
              lang === 'es'
                ? `**Módulo: ${matchedModule.name}.js**`
                : `**Module: ${matchedModule.name}.js**`,
              lang === 'es'
                ? `La definición de \`${matchedModule.name}\` se encuentra en la pestaña \`${matchedModule.name}.js\` de la barra superior.`
                : `The definition of \`${matchedModule.name}\` is located in the \`${matchedModule.name}.js\` tab above.`,
            ],
            code: `// [Module: ${matchedModule.name}.js]\n// ${lang === 'es' ? `Ver pestaña "${matchedModule.name}.js" arriba.` : `See "${matchedModule.name}.js" tab above.`}`,
            start: matchedModule.startLine,
            companionModule: matchedModule,
          })
        }
      }
    } else {
      mainSegments.push(seg)
    }
  }

  // 3. Main runner tab
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
    code: modules.length > 0 ? mainWithoutModules : code,
    readOnly: false,
    segments: mainSegments,
  })

  // 4. Extracted companion module tabs
  for (const m of modules) {
    tabs.push({
      id: m.id,
      name: `${m.name}.js`,
      kind: m.kind,
      badge: m.badge,
      description: m.description,
      code: m.code,
      readOnly: false,
      segments: m.segments,
    })
  }

  // 5. Auxiliary files (.sol, .csv, .json, .md)
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

  // 6. M99 Utilities tab if imported
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

  return { tabs, modules }
}
