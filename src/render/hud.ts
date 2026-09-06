import { COLORS } from '../constants/colors'
import { drawCard, drawCheatIcon, drawDemolishIcon, drawMenuIcon, drawPauseIcon, drawPlayIcon, drawSaveIcon, drawSettingsIcon } from './ui'

// Globale Kopfzeile: Spielername/Level, Einstellungen/Speichern (noch ohne Funktion), Menü
// (ebenfalls ohne Funktion, nur Referenzbild-Parität) und ein Cheat-Button (+100 auf alles).
// Lumen-/Prisma-Bestand steht NICHT mehr hier (User-Vorgabe: "move the currencies... between the
// building categories, wo aktuell die Trennlinie vorhanden ist") — siehe main.ts
// drawCurrencyPanel(), das zeigt ihn jetzt in der Kauf-Leiste an. Komplett Canvas-gezeichnet,
// damit dieselbe Pointer-Event-Interaktion wie im Rest des Spiels genutzt werden kann (kein
// Mischen von DOM-Buttons und Canvas-Dragging).

// User-Vorgabe: höher, damit Titel/Tagline-Zeile UND die (jetzt kartenförmigen) Buttons bequem
// Platz haben — vorher reine Text-Buttons in einer knappen 52px-Zeile.
export const HUD_HEIGHT = 64

export interface HudButton {
  id: 'pause' | 'settings' | 'save' | 'cheat' | 'demolish' | 'menu'
  label: string
  x: number
  y: number
  width: number
  height: number
}

const ICON_DRAWERS: Record<HudButton['id'], typeof drawSaveIcon> = {
  pause: drawPauseIcon,
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
  // "PAUSE" steht GANZ links (User-Vorgabe: "links neben DEMOLISH"), danach "ABRISS" (letzter
  // Eintrag hier -> kleinstes x, siehe Positionsformel unten) — im HUD statt in einer der beiden
  // Kauf-Leisten, die schon eng gepackt sind, UND weil beide Modi für BEIDE Seiten gleichzeitig
  // gelten (Economy-Gebäude UND Türme), nicht nur für eine. "MENU" ganz rechts, dem Referenzbild
  // entsprechend, ohne Funktion (User-Vorgabe: reine Optik-Parität, wie SETTINGS/SAVE).
  const order: { id: HudButton['id']; label: string }[] = [
    { id: 'pause', label: 'PAUSE' },
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

/** `icon`/`label` überschreiben je nach Zustand, was sonst statisch aus `button` käme — braucht nur
 * der neue PAUSE-Button (Icon UND Beschriftung wechseln zwischen Pause/Play, siehe drawHud()),
 * DEMOLISH bleibt beim bisherigen "gleiches Icon, Text wird zu 'ON'"-Muster. */
function drawButton(ctx: CanvasRenderingContext2D, button: HudButton, active: boolean, icon?: typeof drawSaveIcon, label?: string) {
  const color = active ? '#ff3355' : COLORS.textBright
  drawCard(ctx, button.x, button.y, button.width, button.height, active)
  const iconX = button.x + 22
  const iconY = button.y + button.height / 2
  const drawIcon = icon ?? ICON_DRAWERS[button.id]
  drawIcon(ctx, iconX, iconY, 8, color)

  ctx.save()
  ctx.fillStyle = color
  ctx.font = '12px monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label ?? (active ? 'ON' : button.label), iconX + 16, iconY + 1)
  ctx.restore()
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  playerName: string,
  level: number,
  buttons: HudButton[],
  demolishActive: boolean,
  gamePaused: boolean,
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

  ctx.save()
  ctx.textBaseline = 'middle'
  ctx.fillStyle = COLORS.textBright
  ctx.font = 'bold 16px monospace'
  ctx.fillText(playerName, 20, HUD_HEIGHT * 0.36)
  // Bugfix: Breite MUSS mit der noch aktiven (fetten 15px-) Schriftart gemessen werden, bevor auf
  // die kleinere LVL-Schriftart gewechselt wird — sonst kommt ein zu kleiner (falscher) Wert
  // heraus und "LVL" rückt zu dicht an den Namen heran.
  const nameWidth = ctx.measureText(playerName).width
  ctx.fillStyle = COLORS.textDim
  ctx.font = '13px monospace'
  ctx.fillText(`LVL ${level}`, 20 + nameWidth + 16, HUD_HEIGHT * 0.36)
  // User-Vorgabe: Referenzbild-Tagline unter Name/Level.
  ctx.fillStyle = COLORS.accent
  ctx.font = '11px monospace'
  ctx.fillText('DEFEND · COMBINE · EVOLVE', 20, HUD_HEIGHT * 0.72)
  ctx.restore()

  for (const button of buttons) {
    if (button.id === 'pause') {
      // User-Vorgabe: Icon UND Beschriftung wechseln je nach Spielzustand (Pause-Symbol + "PAUSE"
      // solange es läuft, Play-Symbol + "RESUME" solange pausiert) — anders als DEMOLISH, dessen
      // Icon gleich bleibt und nur der Text zu "ON" wechselt.
      drawButton(ctx, button, gamePaused, gamePaused ? drawPlayIcon : drawPauseIcon, gamePaused ? 'RESUME' : 'PAUSE')
    } else {
      drawButton(ctx, button, button.id === 'demolish' && demolishActive)
    }
  }
}
