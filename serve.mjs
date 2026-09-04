import { spawn } from 'node:child_process'

// Vite-App, kein statisches Verzeichnis — "serven" heißt den Vite-Dev-Server starten
// (übernimmt TS-Transform, HMR, etc.).
const vite = spawn('npx', ['vite'], { stdio: 'inherit', shell: true })

vite.on('exit', (code) => process.exit(code ?? 0))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => vite.kill(signal))
}
