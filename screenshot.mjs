import puppeteer from 'puppeteer'
import { mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const [, , url, label] = process.argv
if (!url) {
  console.error('Usage: node screenshot.mjs <url> [label]')
  process.exit(1)
}

const dir = './temporary screenshots'
if (!existsSync(dir)) await mkdir(dir, { recursive: true })

const existing = await readdir(dir)
const numbers = existing
  .map((f) => f.match(/^screenshot-(\d+)/))
  .filter(Boolean)
  .map((m) => Number(m[1]))
const next = numbers.length ? Math.max(...numbers) + 1 : 1
const filename = `screenshot-${next}${label ? `-${label}` : ''}.png`
const filepath = `${dir}/${filename}`

const browser = await puppeteer.launch()
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })
await page.goto(url, { waitUntil: 'networkidle0' })
await page.screenshot({ path: filepath, fullPage: true })
await browser.close()

console.log(`Saved ${filepath}`)
