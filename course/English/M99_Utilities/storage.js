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

// course/state.json is shared by every module, so a lab can read what an earlier
// module created (e.g. M4 uses the token from M3). Each module keeps its own
// state.json too, which wins when both have the key.
const SHARED_STATE_PATH = path.resolve(path.dirname(import.meta.filename), '../../state.json')
const moduleStatePath = () => path.join(path.dirname(process.argv[1]), 'state.json')

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
 * Persists a key-value pair to the module's state.json and to the course-wide
 * state.json, so later labs in any module can read it.
 *
 * @param {string} key - The state key.
 * @param {any} value - The value to store.
 */
export const updateState = (key, value) => {
  for (const file of new Set([moduleStatePath(), SHARED_STATE_PATH])) {
    const state = readJson(file)
    state[key] = value
    writeJsonAtomic(file, state)
  }
  console.log(`\n✅ State Synchronized: ${key}=${value}`)
}

/**
 * Retrieves a value from the module's state.json, then the course-wide
 * state.json, then process.env.
 *
 * @param {string} key - The state key.
 * @returns {any} The stored value.
 */
export const getState = (key) => {
  for (const file of [moduleStatePath(), SHARED_STATE_PATH]) {
    const value = readJson(file)[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return process.env[key]
}
