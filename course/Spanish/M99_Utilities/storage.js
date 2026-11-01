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

/**
 * Persiste un par clave-valor en un archivo local state.json en el directorio del módulo.
 *
 * @param {string} key - La clave del estado.
 * @param {any} value - El valor a almacenar.
 */
export const updateState = (key, value) => {
  const moduleDir = path.dirname(process.argv[1])
  const statePath = path.join(moduleDir, 'state.json')

  let state = {}
  if (fs.existsSync(statePath)) {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  }

  state[key] = value
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')
  console.log(`\n✅ Estado Sincronizado: ${key}=${value}`)
}

/**
 * Recupera un valor del archivo local state.json o recurre a process.env.
 *
 * @param {string} key - La clave del estado.
 * @returns {any} El valor almacenado.
 */
export const getState = (key) => {
  const moduleDir = path.dirname(process.argv[1])
  const statePath = path.join(moduleDir, 'state.json')

  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    if (state[key]) return state[key]
  }

  return process.env[key]
}
