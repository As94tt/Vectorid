// Drei getrennte Ticks pro Frame (siehe CLAUDE.md): Economy (Licht-Simulation/Ressourcenproduktion,
// siehe main.ts economyTick()), Combat (Wellen/Gegner/Türme, siehe combatTick()) und Render. Die
// Trennung existiert von Anfang an, damit die Logik nicht ins Render-Loop einsickert.

export interface Ticker {
  economyTick(dt: number): void
  combatTick(dt: number): void
  render(dt: number): void
}

export function startGameLoop(ticker: Ticker): () => void {
  let rafId = 0
  let lastTime = performance.now()

  function frame(now: number) {
    const dt = Math.min((now - lastTime) / 1000, 0.25) // Delta in Sekunden, gekappt gegen Tab-Wechsel-Sprünge
    lastTime = now

    ticker.economyTick(dt)
    ticker.combatTick(dt)
    ticker.render(dt)

    rafId = requestAnimationFrame(frame)
  }

  rafId = requestAnimationFrame(frame)
  return () => cancelAnimationFrame(rafId)
}
