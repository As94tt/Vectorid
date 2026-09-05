import { COLORS } from '../constants/colors'
import { RESOURCES } from '../data/resources'
import { getBalance, type Inventory } from '../economy/inventory'

// Globale Kopfzeile: Spielername/Level, Lumen-/Prisma-Bestand, Einstellungen/Speichern (noch ohne
// Funktion) und ein Cheat-Button (+100 auf alles). Komplett Canvas-gezeichnet, damit dieselbe
// Pointer-Event-Interaktion wie im Rest des Spiels genutzt werden kann (kein Mischen von
// DOM-Buttons und Canvas-Dragging).

export const HUD_HEIGHT = 52

export interface HudButton {
  id: 'settings' | 'save' | 'cheat' | 'demolish'
  label: string
  x: number
  y: number
  width: number
  height: number
}

export function buildHudButtons(canvasWidth: number): HudButton[] {
  const width = 110
  const height = 30
  const y = (HUD_HEIGHT - height) / 2
  const gap = 10
  const rightPadding = 16
  // "ABRISS" steht bewusst GANZ links in dieser Reihe (letzter Eintrag -> kleinstes x, siehe
  // Positionsformel unten) — im HUD statt in einer der beiden Kauf-Leisten, die schon eng
  // gepackt sind (10/12 Icons, siehe CLAUDE.md), UND weil der Modus für BEIDE Seiten gleichzeitig
  // gilt (Economy-Gebäude UND Türme), nicht nur für eine.
  const order: { id: HudButton['id']; label: string }[] = [
    { id: 'settings', label: 'SETTINGS' },
    { id: 'save', label: 'SAVE' },
    { id: 'cheat', label: 'CHEAT +100' },
    { id: 'demolish', label: 'DEMOLISH' },
  ]
  return order.map((o, i) => ({
    ...o,
    width,
    height,
    y,
    x: canvasWidth - rightPadding - (i + 1) * width - i * gap,
  }))
}

export function hitTestButton(button: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean {
  return x >= button.x && x <= button.x + button.width && y >= button.y && y <= button.y + button.height
}

function drawButton(ctx: CanvasRenderingContext2D, button: HudButton, active: boolean) {
  const color = active ? '#ff3355' : COLORS.textBright
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.strokeRect(button.x, button.y, button.width, button.height)
  ctx.fillStyle = color
  ctx.font = '11px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(active ? 'DEMOLISH: ON' : button.label, button.x + button.width / 2, button.y + button.height / 2 + 1)
  ctx.restore()
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  inventory: Inventory,
  playerName: string,
  level: number,
  buttons: HudButton[],
  demolishActive: boolean,
) {
  ctx.save()
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, width, HUD_HEIGHT)
  ctx.strokeStyle = COLORS.gridLineStrong
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, HUD_HEIGHT)
  ctx.lineTo(width, HUD_HEIGHT)
  ctx.stroke()
  ctx.restore()

  const midY = HUD_HEIGHT / 2

  ctx.save()
  ctx.textBaseline = 'middle'
  ctx.fillStyle = COLORS.textBright
  ctx.font = 'bold 13px monospace'
  ctx.fillText(playerName, 20, midY)
  ctx.fillStyle = COLORS.textDim
  ctx.font = '11px monospace'
  ctx.fillText(`LVL ${level}`, 20 + ctx.measureText(playerName).width + 16, midY)
  ctx.restore()

  // Ressourcenliste ist auf den Bereich links der Buttons begrenzt (clip), sonst würde eine
  // lange Liste in die Buttons laufen. Nur noch Lumen/Prisma (Spezial-Ressourcen, Kampf-Belohnung)
  // — die 14 Kampf-/Mischfarben sind seit der Umstellung auf beam-versorgte Türme kein
  // Bestands-/Ratenwert mehr, der irgendwo im HUD sinnvoll wäre (siehe main.ts economyTick()).
  const leftmostButtonX = buttons.reduce((min, b) => Math.min(min, b.x), width)
  const maxX = leftmostButtonX - 20

  const visible = RESOURCES.filter((r) => r.tier === 'special' && getBalance(inventory, r.id) > 0)

  ctx.save()
  ctx.beginPath()
  ctx.rect(210, 0, Math.max(0, maxX - 210), HUD_HEIGHT)
  ctx.clip()
  ctx.textBaseline = 'middle'
  ctx.font = '11px monospace'
  let cursor = 220
  let shown = 0
  for (const resource of visible) {
    const label = Math.floor(getBalance(inventory, resource.id)).toString()
    const entryWidth = 11 + ctx.measureText(label).width + 18
    if (cursor + entryWidth > maxX) break
    ctx.fillStyle = resource.color
    ctx.beginPath()
    ctx.arc(cursor, midY, 5, 0, Math.PI * 2)
    ctx.fill()
    cursor += 11
    ctx.fillStyle = COLORS.textDim
    ctx.fillText(label, cursor, midY)
    cursor += ctx.measureText(label).width + 18
    shown++
  }
  ctx.restore()

  if (shown < visible.length) {
    ctx.save()
    ctx.textBaseline = 'middle'
    ctx.font = '11px monospace'
    ctx.fillStyle = COLORS.textDim
    ctx.fillText(`+${visible.length - shown}`, maxX + 4, midY)
    ctx.restore()
  }

  for (const button of buttons) drawButton(ctx, button, button.id === 'demolish' && demolishActive)
}
