import { COLORS } from '../constants/colors'
import { drawHexagon, drawPentagon } from '../render/shapes'

// Gegner-Pfad: eine Kette von Wegpunkten vom Spawn bis zu seinem (dynamisch berechneten) Ende —
// siehe grid/routing.ts `traceDefensePath()` für die eigentliche Pfad-Berechnung. Diese Datei
// kennt nur die fertige Punkteliste, keine Rasterlogik: reines Bewegen entlang der Pfadlänge.

export interface Point {
  x: number
  y: number
}

function segmentLengths(path: Point[]) {
  const lengths: number[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const dx = path[i + 1].x - path[i].x
    const dy = path[i + 1].y - path[i].y
    lengths.push(Math.hypot(dx, dy))
  }
  return lengths
}

/** Gesamtlänge des Pfads in Pixeln — braucht `tickEnemy()` (siehe enemies.ts), um aus einer
 * festen Pixel/Sekunde-Geschwindigkeit den richtigen `progress`-Zuwachs pro Frame zu berechnen
 * (User-Vorgabe: Geschwindigkeit soll NICHT von der Weglänge abhängen, siehe dort). */
export function pathTotalLength(path: Point[]): number {
  return segmentLengths(path).reduce((sum, l) => sum + l, 0)
}

/** Liefert die Position entlang des Pfads bei Fortschritt t (0 = Spawn, 1 = Basis). */
export function getPointAtProgress(path: Point[], t: number): Point {
  const clamped = Math.max(0, Math.min(1, t))
  const lengths = segmentLengths(path)
  const total = lengths.reduce((sum, l) => sum + l, 0)
  const target = clamped * total

  let covered = 0
  for (let i = 0; i < lengths.length; i++) {
    const segLength = lengths[i]
    if (target <= covered + segLength || i === lengths.length - 1) {
      const segT = segLength === 0 ? 0 : (target - covered) / segLength
      const a = path[i]
      const b = path[i + 1]
      return {
        x: a.x + (b.x - a.x) * segT,
        y: a.y + (b.y - a.y) * segT,
      }
    }
    covered += segLength
  }
  return path[path.length - 1]
}

/**
 * Seit dieser Runde (User-Vorgabe: "die Linie, wie die Gegner laufen, wird vom Endpunkt und nicht
 * vom Startpunkt erzeugt") ist `path[path.length - 1]` immer der feste Endpunkt-Stein (siehe
 * main.ts `endpointNode()`) — der bekommt IMMER seinen Marker, unabhängig davon, wo der Pfad
 * herkommt. `path[0]` ist dagegen die dynamische Stelle, an der Gegner tatsächlich auftauchen (wo
 * auch immer der vom Stein aus zurückverfolgte Strahl endet): `entryHitsBuilding` unterdrückt dort
 * den Marker, wenn das ohnehin schon ein sichtbares Gebäude ist (kein Marker nötig) — nur an der
 * bloßen Wand (Rasterrand, kein Gebäude) zeigt ein kleines Hexagon, wo die Gegner einlaufen.
 */
export function drawPath(ctx: CanvasRenderingContext2D, path: Point[], entryHitsBuilding: boolean) {
  if (path.length < 2) return

  ctx.save()
  ctx.strokeStyle = COLORS.path
  ctx.shadowColor = COLORS.pathGlow
  ctx.shadowBlur = 12
  ctx.lineWidth = 6
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(path[0].x, path[0].y)
  for (const point of path.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.stroke()
  ctx.restore()

  if (!entryHitsBuilding) {
    const entry = path[0]
    drawHexagon(ctx, entry.x, entry.y, 14, COLORS.enemy, 0, 18)
  }
  const endpoint = path[path.length - 1]
  drawPentagon(ctx, endpoint.x, endpoint.y, 16, COLORS.base, 0, 18)
}
