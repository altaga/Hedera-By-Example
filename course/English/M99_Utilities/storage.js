/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import fs from 'fs'
import path from 'path'

/**
 * Persists a key-value pair to the .env file.
 * @deprecated Use updateState for lab-specific IDs.
 *
 * @param {string} key - Environment variable name.
 * @param {string} value - Variable value.
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
  console.log(`\n✅ .env Synchronized: ${key}=${value}`)
}

/**
 * Persists a key-value pair to a local state.json file in the module directory.
 *
 * @param {string} key - The state key.
 * @param {any} value - The value to store.
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
  console.log(`\n✅ State Synchronized: ${key}=${value}`)
}

/**
 * Retrieves a value from the local state.json or fallback to process.env.
 *
 * @param {string} key - The state key.
 * @returns {any} The stored value.
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
