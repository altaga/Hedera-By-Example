/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import fs from 'fs'
import path from 'path'

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
  console.log(`\n✅ .env Sincronizado: ${key}=${value}`)
}

// course/state.json lo comparten todos los módulos, así un lab puede leer lo que
// creó un módulo anterior (p. ej. M4 usa el token de M3). Cada módulo conserva
// también su propio state.json, que tiene prioridad si ambos tienen la clave.
const SHARED_STATE_PATH = path.resolve(path.dirname(import.meta.filename), '../../state.json')
const moduleStatePath = () => path.join(path.dirname(process.argv[1]), 'state.json')

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
 * Persiste un par clave-valor en el state.json del módulo y en el state.json
 * del curso, para que los labs de cualquier módulo puedan leerlo después.
 *
 * @param {string} key - La clave del estado.
 * @param {any} value - El valor a almacenar.
 */
export const updateState = (key, value) => {
  for (const file of new Set([moduleStatePath(), SHARED_STATE_PATH])) {
    const state = readJson(file)
    state[key] = value
    writeJsonAtomic(file, state)
  }
  console.log(`\n✅ Estado Sincronizado: ${key}=${value}`)
}

/**
 * Obtiene un valor del state.json del módulo, luego del state.json del curso
 * y por último de process.env.
 *
 * @param {string} key - La clave del estado.
 * @returns {any} El valor almacenado.
 */
export const getState = (key) => {
  for (const file of [moduleStatePath(), SHARED_STATE_PATH]) {
    const value = readJson(file)[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return process.env[key]
}
