import fs from 'fs'
import path from 'path'

// Los valores cuyo nombre indica que son secretos no se imprimen completos (se guardan tal cual).
const isSecretName = (key) => /PRIVATE|SECRET|MNEMONIC|PASSWORD|_KEY$/i.test(key)
const shown = (key, value) => (isSecretName(key) ? `${String(value).slice(0, 6)}… (oculto)` : value)

/**
 * Persiste un par clave-valor en el archivo .env.
 * @deprecated Use updateState para IDs específicos del laboratorio.
 *
 * @param {string} key - Nombre de la variable de entorno.
 * @param {string} value - Valor de la variable.
 */
export const updateEnv = (key, value) => {
  const __dirname = path.dirname(import.meta.filename)
  const envPath = path.resolve(__dirname, '../../.env')

  let envContent = ''
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8')
  }

  const regex = new RegExp(`^${key}=.*$`, 'm')
  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `${key}="${value}"`)
  } else {
    const prefix = (envContent.length > 0 && !envContent.endsWith('\n')) ? '\n' : ''
    envContent += `${prefix}${key}="${value}"`
  }

  fs.writeFileSync(envPath, envContent, 'utf8')
  console.log(`\n .env Sincronizado: ${key}=${shown(key, value)}`)
}

// Un solo archivo de estado para todo el curso (course/state.json), para que un lab
// pueda leer lo que creó un lab anterior de cualquier módulo (p. ej. M4 usa el token
// de M3), sin importar desde qué carpeta lo ejecutes. Las ejecuciones antiguas
// guardaban un state.json dentro de cada módulo: getState todavía lo lee como respaldo.
const STATE_PATH = path.resolve(path.dirname(import.meta.filename), '../../state.json')
const legacyModuleStatePath = () => path.join(path.dirname(process.argv[1] || '.'), 'state.json')

const readJson = (file) => {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  } catch (_) {
    return {} // un archivo a medio escribir o editado a mano no debe romper el lab
  }
}

// Escribe en un archivo temporal y lo renombra: nadie lee un archivo a medias.
const writeJsonAtomic = (file, data) => {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * Guarda un par clave-valor en course/state.json, para que los labs siguientes de cualquier módulo lo lean.
 *
 * @param {string} key - La clave de estado.
 * @param {any} value - El valor a guardar.
 */
export const updateState = (key, value) => {
  const state = readJson(STATE_PATH)
  state[key] = value
  writeJsonAtomic(STATE_PATH, state)
  console.log(`\n Estado Sincronizado: ${key}=${shown(key, value)}`)
}

/**
 * Lee un valor de course/state.json, luego de un state.json antiguo del módulo
 * y luego de process.env.
 *
 * @param {string} key - La clave de estado.
 * @returns {any} El valor guardado.
 */
export const getState = (key) => {
  for (const file of [STATE_PATH, legacyModuleStatePath()]) {
    const value = readJson(file)[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return process.env[key]
}
