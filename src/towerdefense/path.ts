import { COLORS } from '../constants/colors'
import { drawHexagon, drawPentagon } from '../render/shapes'

// Gegner-Pfad: eine Kette von Wegpunkten vom Spawn bis zu seinem (dynamisch berechneten) Ende —
// siehe grid/routing.ts `traceDefensePath()` für die eigentliche Pfad-Berechnung. Diese Datei
// kennt nur die fertige Punkteliste, keine Rasterlogik: reines Bewegen entlang der Pfadlänge.

export interface Point {
  x: number
  y: number
}

export function createEnemyPath(points: Point[]): Point[] {
  return points
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
 * `endsAtTower`: seit der Umstellung auf einen strahlbasierten Pfad (siehe grid/routing.ts
 * `traceDefensePath()`, User-Vorgabe: "kein kürzester Weg mehr, sondern wie auf der Economy-Seite
 * mit Spiegeln veränderbar, unendlich lang, bis er auf eine Wand oder einen Turm trifft") gibt es
 * keinen separat platzierten Ziel-Knoten mehr — das Ziel ist dynamisch, wo auch immer der Pfad
 * endet. Endet er an einem Turm, ist der Turm selbst schon sichtbar (kein zusätzlicher Marker
 * nötig); endet er stattdessen an der Wand (Rasterrand), zeigt ein kleines Pentagon den
 * Pfad-Endpunkt an, damit das nicht wie ein Abbruch/Bug aussieht.
 */
export function drawPath(ctx: CanvasRenderingContext2D, path: Point[], endsAtTower: boolean) {
  if (path.length < 2) return

  ctx.save()
  ctx.strokeStyle = COLORS.path
  ctx.shadowColor = COLORS.pathGlow
  ctx.shadowBlur = 12
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(path[0].x, path[0].y)
  for (const point of path.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.stroke()
  ctx.restore()

  const spawn = path[0]
  drawHexagon(ctx, spawn.x, spawn.y, 14, COLORS.enemy, 0, 18)
  if (!endsAtTower) {
    const end = path[path.length - 1]
    drawPentagon(ctx, end.x, end.y, 16, COLORS.base, 0, 18)
  }
}
