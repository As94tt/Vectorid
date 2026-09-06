// Gemeinsame Karten-/Balken-Bausteine für den neuen Referenzbild-Look (User-Vorgabe: UI
// umfassend an ein Referenzbild mit umrandeten "Karten" + Fortschrittsbalken anpassen) — bewusst
// klein gehalten (kein generisches Komponenten-Framework), nur das, was quer durch Kauf-Leiste/
// HUD-Buttons/Seitenleisten wiederverwendet wird.

import { COLORS } from '../constants/colors'

/** Umrandete Karte mit abgerundeten Ecken — der zentrale visuelle Baustein des neuen Looks
 * (Kauf-Leisten-Icons, HUD-Buttons, Seitenleisten-Panels/-Einträge). `active` hebt den Rahmen
 * hervor (ausgewählt/hover), sonst der gedämpfte Standard-Rahmen. */
export function drawCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, active = false, radius = 8) {
  ctx.save()
  ctx.fillStyle = COLORS.panelBg
  ctx.strokeStyle = active ? COLORS.panelBorderActive : COLORS.panelBorder
  ctx.lineWidth = active ? 2 : 1.5
  if (active) {
    ctx.shadowColor = COLORS.panelBorderActive
    ctx.shadowBlur = 8
  }
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, radius)
    ctx.fill()
    ctx.stroke()
  } else {
    ctx.fillRect(x, y, w, h)
    ctx.strokeRect(x, y, w, h)
  }
  ctx.restore()
}

/** Fortschrittsbalken (abgerundete Leiste, dunkle Spur + gefüllter Anteil) — Wellen-Spawn-
 * Fortschritt und Basis-HP teilen sich denselben Baustein, nur mit unterschiedlicher Füllfarbe. */
export function drawProgressBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fraction: number, fillColor: string) {
  const clamped = Math.max(0, Math.min(1, fraction))
  const radius = h / 2
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, radius)
    ctx.fill()
  } else {
    ctx.fillRect(x, y, w, h)
  }

  if (clamped > 0) {
    ctx.save()
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, radius)
      ctx.clip()
    }
    ctx.fillStyle = fillColor
    ctx.shadowColor = fillColor
    ctx.shadowBlur = 6
    ctx.fillRect(x, y, w * clamped, h)
    ctx.restore()
  }
  ctx.restore()
}

/** Gesundheits-/HP-Farbe je Füllstand (grün -> gelb -> rot) — dieselbe Schwellenlogik wie
 * render/combatRender.ts drawHealthBar(), hier für die Basis-HP-Leiste wiederverwendet. */
export function healthFractionColor(fraction: number): string {
  return fraction > 0.5 ? '#39ff8f' : fraction > 0.25 ? '#ffcc33' : '#ff3355'
}

type IconDrawer = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) => void

/** Speichern (Diskette): Außenrahmen + gefalzte Ecke oben rechts + kleiner "Label"-Balken. */
export const drawSaveIcon: IconDrawer = (ctx, x, y, size, color) => {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x - size, y - size)
  ctx.lineTo(x + size * 0.5, y - size)
  ctx.lineTo(x + size, y - size * 0.5)
  ctx.lineTo(x + size, y + size)
  ctx.lineTo(x - size, y + size)
  ctx.closePath()
  ctx.stroke()
  ctx.strokeRect(x - size * 0.45, y - size, size * 0.9, size * 0.7)
  ctx.strokeRect(x - size * 0.6, y + size * 0.15, size * 1.2, size * 0.55)
  ctx.restore()
}

/** Einstellungen (Zahnrad): Kreis + radiale Zacken ringsum + kleiner Innenkreis. */
export const drawSettingsIcon: IconDrawer = (ctx, x, y, size, color) => {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x, y, size * 0.55, 0, Math.PI * 2)
  ctx.stroke()
  const teeth = 8
  for (let i = 0; i < teeth; i++) {
    const angle = (i / teeth) * Math.PI * 2
    const inner = size * 0.75
    const outer = size
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner)
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(x, y, size * 0.2, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

/** Menü (Hamburger): 3 waagerechte Linien. */
export const drawMenuIcon: IconDrawer = (ctx, x, y, size, color) => {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  for (const dy of [-size * 0.6, 0, size * 0.6]) {
    ctx.beginPath()
    ctx.moveTo(x - size, y + dy)
    ctx.lineTo(x + size, y + dy)
    ctx.stroke()
  }
  ctx.restore()
}

/** Abriss (Mülleimer): Deckel + Behälter-Umriss + 2 senkrechte Rillen. */
export const drawDemolishIcon: IconDrawer = (ctx, x, y, size, color) => {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - size, y - size * 0.7)
  ctx.lineTo(x + size, y - size * 0.7)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - size * 0.45, y - size * 0.7)
  ctx.lineTo(x - size * 0.3, y - size)
  ctx.lineTo(x + size * 0.3, y - size)
  ctx.lineTo(x + size * 0.45, y - size * 0.7)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - size * 0.8, y - size * 0.55)
  ctx.lineTo(x - size * 0.6, y + size)
  ctx.lineTo(x + size * 0.6, y + size)
  ctx.lineTo(x + size * 0.8, y - size * 0.55)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - size * 0.25, y - size * 0.3)
  ctx.lineTo(x - size * 0.2, y + size * 0.7)
  ctx.moveTo(x + size * 0.25, y - size * 0.3)
  ctx.lineTo(x + size * 0.2, y + size * 0.7)
  ctx.stroke()
  ctx.restore()
}

/** Cheat (Test-Tool, kein Teil des Referenzbilds): einfaches Plus in einem Kreis. */
export const drawCheatIcon: IconDrawer = (ctx, x, y, size, color) => {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x, y, size, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - size * 0.5, y)
  ctx.lineTo(x + size * 0.5, y)
  ctx.moveTo(x, y - size * 0.5)
  ctx.lineTo(x, y + size * 0.5)
  ctx.stroke()
  ctx.restore()
}

/** Herz (Basis-HP): zwei Bögen + Spitze, via zusammengesetzter Pfad. */
export function drawHeartIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 6
  ctx.beginPath()
  const topY = y - size * 0.35
  ctx.moveTo(x, y + size * 0.7)
  ctx.bezierCurveTo(x - size * 1.1, y - size * 0.1, x - size * 0.5, topY - size * 0.6, x, topY)
  ctx.bezierCurveTo(x + size * 0.5, topY - size * 0.6, x + size * 1.1, y - size * 0.1, x, y + size * 0.7)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Totenkopf-artiges "verbleibend"-Symbol (Gegner-Rest-Anzeige): einfacher Kreis + 2 Augen. */
export function drawSkullIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.arc(x, y, size, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x - size * 0.35, y - size * 0.1, size * 0.18, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x + size * 0.35, y - size * 0.1, size * 0.18, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
