import { COLORS } from '../constants/colors'
import { RESOURCES } from '../data/resources'
import { getBalance, type Inventory } from '../economy/inventory'
import { drawCard, drawCheatIcon, drawDemolishIcon, drawMenuIcon, drawSaveIcon, drawSettingsIcon } from './ui'

// Globale Kopfzeile: Spielername/Level, Lumen-/Prisma-Bestand, Einstellungen/Speichern (noch ohne
// Funktion), Menü (ebenfalls ohne Funktion, nur Referenzbild-Parität) und ein Cheat-Button (+100
// auf alles). Komplett Canvas-gezeichnet, damit dieselbe Pointer-Event-Interaktion wie im Rest des
// Spiels genutzt werden kann (kein Mischen von DOM-Buttons und Canvas-Dragging).

// User-Vorgabe: höher, damit Titel/Tagline-Zeile UND die (jetzt kartenförmigen) Buttons bequem
// Platz haben — vorher reine Text-Buttons in einer knappen 52px-Zeile.
export const HUD_HEIGHT = 64

export interface HudButton {
  id: 'settings' | 'save' | 'cheat' | 'demolish' | 'menu'
  label: string
  x: number
  y: number
  width: number
  height: number
}

const ICON_DRAWERS: Record<HudButton['id'], typeof drawSaveIcon> = {
  save: drawSaveIcon,
  settings: drawSettingsIcon,
  menu: drawMenuIcon,
  cheat: drawCheatIcon,
  demolish: drawDemolishIcon,
}

export function buildHudButtons(canvasWidth: number): HudButton[] {
  const width = 108
  const height = 40
  const y = (HUD_HEIGHT - height) / 2
  const gap = 10
  const rightPadding = 20
  // "ABRISS" steht bewusst GANZ links in dieser Reihe (letzter Eintrag -> kleinstes x, siehe
  // Positionsformel unten) — im HUD statt in einer der beiden Kauf-Leisten, die schon eng
  // gepackt sind, UND weil der Modus für BEIDE Seiten gleichzeitig gilt (Economy-Gebäude UND
  // Türme), nicht nur für eine. "MENU" ganz rechts, dem Referenzbild entsprechend, ohne Funktion
  // (User-Vorgabe: reine Optik-Parität, wie SETTINGS/SAVE).
  const order: { id: HudButton['id']; label: string }[] = [
    { id: 'demolish', label: 'DEMOLISH' },
    { id: 'cheat', label: 'CHEAT' },
    { id: 'save', label: 'SAVE' },
    { id: 'settings', label: 'SETTINGS' },
    { id: 'menu', label: 'MENU' },
  ]
  return order.map((o, i) => ({
    ...o,
    width,
    height,
    y,
    x: canvasWidth - rightPadding - (order.length - i) * width - (order.length - 1 - i) * gap,
  }))
}

export function hitTestButton(button: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean {
  return x >= button.x && x <= button.x + button.width && y >= button.y && y <= button.y + button.height
}

function drawButton(ctx: CanvasRenderingContext2D, button: HudButton, active: boolean) {
  const color = active ? '#ff3355' : COLORS.textBright
  drawCard(ctx, button.x, button.y, button.width, button.height, active)
  const iconX = button.x + 22
  const iconY = button.y + button.height / 2
  ICON_DRAWERS[button.id](ctx, iconX, iconY, 8, color)

  ctx.save()
  ctx.fillStyle = color
  ctx.font = '11px monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(active ? 'ON' : button.label, iconX + 16, iconY + 1)
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
  ctx.font = 'bold 15px monospace'
  ctx.fillText(playerName, 20, HUD_HEIGHT * 0.36)
  // Bugfix: Breite MUSS mit der noch aktiven (fetten 15px-) Schriftart gemessen werden, bevor auf
  // die kleinere LVL-Schriftart gewechselt wird — sonst kommt ein zu kleiner (falscher) Wert
  // heraus und "LVL" rückt zu dicht an den Namen heran.
  const nameWidth = ctx.measureText(playerName).width
  ctx.fillStyle = COLORS.textDim
  ctx.font = '12px monospace'
  ctx.fillText(`LVL ${level}`, 20 + nameWidth + 16, HUD_HEIGHT * 0.36)
  // User-Vorgabe: Referenzbild-Tagline unter Name/Level.
  ctx.fillStyle = COLORS.accent
  ctx.font = '10px monospace'
  ctx.fillText('DEFEND · COMBINE · EVOLVE', 20, HUD_HEIGHT * 0.72)
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
  ctx.font = '12px monospace'
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
    ctx.font = '12px monospace'
    ctx.fillStyle = COLORS.textDim
    ctx.fillText(`+${visible.length - shown}`, maxX + 4, midY)
    ctx.restore()
  }

  for (const button of buttons) drawButton(ctx, button, button.id === 'demolish' && demolishActive)
}
