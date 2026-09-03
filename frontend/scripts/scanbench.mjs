// scanbench: runs one real investigation against the local backend and
// reports the pipeline phase durations measured by the progress tracker.
//
// Usage: node scripts/scanbench.mjs [--prompt "..."] [--base http://127.0.0.1:5173]
// The backend must already be running on :8080 (scripts/scanbench.ps1
// restarts it and calls this).
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

const prompt = getArg('prompt', 'the latest AI news')
const base = getArg('base', 'http://127.0.0.1:5173')
const outDir = '.scanbench'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto(base)

// Dev servers show the landing experience first; walk through it. The
// ambient animations never settle, so clicks are forced - this is a bench
// driver, not a UX test.
const enterButton = page.getByTestId('landing-enter-button')
if (await enterButton.isVisible().catch(() => false)) {
  await enterButton.click({ force: true })
}

await page.getByRole('button', { name: 'WEB' }).click({ force: true })
await page.getByPlaceholder(/enter a topic or url to crawl the web/i).fill(prompt)
const startedAt = Date.now()
await page.getByRole('button', { name: /^execute$/i }).click({ force: true })

// The pipeline drawer's last step is "Pipeline complete".
await page.getByText(/^Pipeline complete$/i).first().waitFor({ timeout: 15 * 60_000 })
await page.waitForTimeout(1500)

const steps = await page.$$eval('[data-testid="pipeline-progress-step"]', (rows) =>
  rows.map((row) => ({
    label: row.querySelector('strong')?.textContent?.trim() || '',
    detail: row.querySelector('p')?.textContent?.trim() || '',
    duration: row.querySelector('span')?.textContent?.trim() || '',
  })),
)
const total = await page.evaluate(
  () => document.querySelector('.forensic-pipeline-performance strong')?.textContent?.trim() || '',
)
await browser.close()

const wallSeconds = Math.round((Date.now() - startedAt) / 1000)
console.log('\n=== SCANBENCH RESULT ===')
console.log(`prompt: ${prompt}`)
for (const step of steps) {
  console.log(`${step.duration.padStart(9)}  ${step.label}`)
}
console.log(`tracker total: ${total} (wall ~${wallSeconds}s)`)
console.log('========================\n')

writeFileSync(
  `${outDir}/last.json`,
  JSON.stringify({ prompt, at: new Date().toISOString(), total, wallSeconds, steps }, null, 2),
)
