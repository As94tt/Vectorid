// Drei getrennte Ticks pro Frame (siehe CLAUDE.md): Economy (Idle-/Ressourcenproduktion),
// Combat (Wellen/Gegner/Türme) und Render. Aktuell sind Economy/Combat noch Platzhalter —
// die Trennung existiert von Anfang an, damit später niemand die Logik ins Render-Loop mischt.

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
