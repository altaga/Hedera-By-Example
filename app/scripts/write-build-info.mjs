/**
 * Writes src/server/buildInfo.generated.json with the commit being built, so analytics can send
 * app_version as `<version>+<short sha>` (EAS Hosting has no VERCEL_GIT_COMMIT_SHA).
 * Runs in deploy:web right before `expo export`. The file is not committed; without it the app
 * still builds and app_version is the version alone. Never writes a commit it could not read.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const OUT = path.resolve(import.meta.dirname, '..', 'src', 'server', 'buildInfo.generated.json')

let commit = null
try {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  if (/^[0-9a-f]{40}$/.test(sha)) commit = sha
} catch { /* not a git checkout */ }

if (commit) {
  fs.writeFileSync(OUT, JSON.stringify({ commit }, null, 2) + '\n')
  console.log(`build info: commit ${commit.slice(0, 7)} → src/server/buildInfo.generated.json`)
} else {
  fs.rmSync(OUT, { force: true })
  console.log('build info: no git commit found; app_version will be the package version alone')
}
