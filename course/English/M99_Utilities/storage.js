/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import fs from 'fs'
import path from 'path'

// Values whose name says they are secret are not printed in full (they are saved as-is).
const isSecretName = (key) => /PRIVATE|SECRET|MNEMONIC|PASSWORD|_KEY$/i.test(key)
const shown = (key, value) => (isSecretName(key) ? `${String(value).slice(0, 6)}… (hidden)` : value)

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
  console.log(`\n .env Synchronized: ${key}=${shown(key, value)}`)
}

// One state file for the whole course (course/state.json), so a lab can read what
// an earlier lab created in any module (e.g. M4 uses the token from M3), whatever
// directory you run it from. Older runs kept a state.json inside each module
// folder: getState still reads it as a fallback.
const STATE_PATH = path.resolve(path.dirname(import.meta.filename), '../../state.json')
const legacyModuleStatePath = () => path.join(path.dirname(process.argv[1] || '.'), 'state.json')

const readJson = (file) => {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  } catch (_) {
    return {} // a half-written or hand-edited file must not crash a lab
  }
}

// Write to a temp file and rename it, so readers never see a partial file.
const writeJsonAtomic = (file, data) => {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * Saves a key-value pair in course/state.json, so later labs in any module can read it.
 *
 * @param {string} key - The state key.
 * @param {any} value - The value to store.
 */
export const updateState = (key, value) => {
  const state = readJson(STATE_PATH)
  state[key] = value
  writeJsonAtomic(STATE_PATH, state)
  console.log(`\n State Synchronized: ${key}=${shown(key, value)}`)
}

/**
 * Reads a value from course/state.json, then from an older per-module
 * state.json, then from process.env.
 *
 * @param {string} key - The state key.
 * @returns {any} The stored value.
 */
export const getState = (key) => {
  for (const file of [STATE_PATH, legacyModuleStatePath()]) {
    const value = readJson(file)[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return process.env[key]
}
