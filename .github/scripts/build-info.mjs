import { writeFileSync } from 'node:fs'

writeFileSync('dist/build-info.json', JSON.stringify({
  revision: process.env.GITHUB_SHA ?? null,
  branch: process.env.GITHUB_REF_NAME ?? null,
  variant: process.env.APP_VARIANT ?? 'main',
  localBeta: process.env.VITE_BETA_SANDBOX === 'true',
}, null, 2))
