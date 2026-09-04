// Rendering für die eigentliche Kampf-Simulation: Gegner (Körper + C/M/Y-Anzeige + Lebensbalken),
// Projektile, Turm-spezifische Dauer-Effekte (Flamethrower-Kegel, Beam-Laser, Burst-Ladeanzeige)
// und transiente Vorschau-Effekte (Pulse-Ringe, Einschlag-Blitze). Reine Zeichenfunktionen, keine
// Logik — siehe towerdefense/combat.ts + enemies.ts dafür.

import { COLORS } from '../constants/colors'
import { getResource } from '../data/resources'
import type { Projectile, VisualEffect } from '../towerdefense/combat'
import { activeStatusEffects, type Enemy } from '../towerdefense/enemies'
import { getPointAtProgress, type Point } from '../towerdefense/path'
import { getTowerDefinition, type PlacedTower } from '../towerdefense/towers'
import { drawCircle, drawCircleOutline } from './shapes'
import { TOWER_UNSELECTED_COLOR } from './towerRender'

const HEALTH_BAR_WIDTH = 20
const HEALTH_BAR_HEIGHT = 3
const STATUS_BAR_WIDTH = 3
const STATUS_BAR_GAP = 2
const STATUS_BAR_MAX_HEIGHT = 10

/** Kleine Säulen unter dem Gegner, eine je aktuell aktivem Farb-Effekt (siehe enemies.ts
 * `activeStatusEffects()`) — Höhe = Stack-Füllstand relativ zum jeweiligen Maximalwert. Ersetzt
 * die frühere feste C/M/Y-Anzeige (jede der bis zu 16 Kampf-Farben hat jetzt ihren eigenen
 * Effekt statt eines gemeinsamen Mischungsverhältnisses, siehe ammoEffects.ts). */
function drawStatusEffects(ctx: CanvasRenderingContext2D, pos: Point, enemy: Enemy, elapsedSeconds: number) {
  const active = activeStatusEffects(enemy, elapsedSeconds)
  if (active.length === 0) return
  const totalWidth = active.length * STATUS_BAR_WIDTH + (active.length - 1) * STATUS_BAR_GAP
  const startX = pos.x - totalWidth / 2
  const baseY = pos.y + enemy.size + 4 + STATUS_BAR_MAX_HEIGHT

  ctx.save()
  active.forEach((status, i) => {
    const barHeight = STATUS_BAR_MAX_HEIGHT * Math.max(0, Math.min(1, status.fraction))
    const x = startX + i * (STATUS_BAR_WIDTH + STATUS_BAR_GAP)
    ctx.fillStyle = getResource(status.resourceId).color
    ctx.fillRect(x, baseY - barHeight, STATUS_BAR_WIDTH, barHeight)
  })
  ctx.restore()
}

function drawHealthBar(ctx: CanvasRenderingContext2D, pos: Point, radius: number, fraction: number) {
  const width = Math.max(HEALTH_BAR_WIDTH, radius * 2.2)
  const x = pos.x - width / 2
  const y = pos.y - radius - 10
  const clamped = Math.max(0, Math.min(1, fraction))
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(x, y, width, HEALTH_BAR_HEIGHT)
  ctx.fillStyle = clamped > 0.5 ? '#39ff8f' : clamped > 0.25 ? '#ffcc33' : '#ff3355'
  ctx.fillRect(x, y, width * clamped, HEALTH_BAR_HEIGHT)
  ctx.restore()
}

const FROZEN_COLOR = '#00AAFF' // Cerulean-Farbton, dieselbe Farbe wie der auslösende Effekt
const BOSS_RING_COLOR = '#ffcc33' // deutlich sichtbarer Warn-Ring, unabhängig vom Frozen-Zustand

export function drawEnemies(ctx: CanvasRenderingContext2D, enemies: Enemy[], pathPixels: Point[], elapsedSeconds: number) {
  for (const enemy of enemies) {
    const pos = getPointAtProgress(pathPixels, enemy.progress)
    const frozen = enemy.frozenUntil > elapsedSeconds
    drawCircle(ctx, pos.x, pos.y, enemy.size, frozen ? FROZEN_COLOR : COLORS.enemy, frozen ? 16 : enemy.isBoss ? 18 : 10)
    if (enemy.isBoss) drawCircleOutline(ctx, pos.x, pos.y, enemy.size + 4, BOSS_RING_COLOR, 2, 12)
    if (frozen) drawCircleOutline(ctx, pos.x, pos.y, enemy.size + 3, FROZEN_COLOR, 1.5, 10)
    drawHealthBar(ctx, pos, enemy.size, enemy.hp / enemy.maxHp)
    drawStatusEffects(ctx, pos, enemy, elapsedSeconds)
  }
}

export function drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: Projectile[]) {
  for (const projectile of projectiles) {
    const color = projectile.resourceId ? getResource(projectile.resourceId).color : TOWER_UNSELECTED_COLOR
    drawCircle(ctx, projectile.x, projectile.y, projectile.splashRadius ? 4 : 3, color, 8)
  }
}

/** Transiente Effekte: Pulse-Impulsringe (kind 'ring', expandieren + verblassen) und
 * Einschlag-Blitze (kind 'flash', Cannon-Splash — schrumpfen leicht + verblassen). */
export function drawVisualEffects(ctx: CanvasRenderingContext2D, effects: VisualEffect[], elapsedSeconds: number) {
  for (const effect of effects) {
    const t = Math.max(0, Math.min(1, (elapsedSeconds - effect.startedAt) / effect.duration))
    const radius = effect.kind === 'ring' ? effect.radius * (0.25 + 0.75 * t) : effect.radius * (0.5 + 0.5 * t)
    ctx.save()
    ctx.globalAlpha = (1 - t) * 0.75
    ctx.strokeStyle = effect.color
    ctx.shadowColor = effect.color
    ctx.shadowBlur = 10
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
}

function towerAmmoColor(tower: PlacedTower): string {
  return tower.resourceId ? getResource(tower.resourceId).color : TOWER_UNSELECTED_COLOR
}

/** Flamethrower-Kegel (nur solange `tower.active`), Beam-Laserlinie (nur solange `tower.active`
 * UND das verriegelte Ziel noch existiert) und Burst-Ladeanzeige (wachsender Ring während
 * `tower.charging`). Muss NACH den Türmen selbst gezeichnet werden (liegt optisch darüber). */
export function drawTowerCombatEffects(ctx: CanvasRenderingContext2D, towers: PlacedTower[], enemies: Enemy[], pathPixels: Point[], towerCenter: (t: PlacedTower) => Point) {
  for (const tower of towers) {
    const def = getTowerDefinition(tower.kind)
    const center = towerCenter(tower)
    const color = towerAmmoColor(tower)

    if (tower.kind === 'flamethrower' && tower.active) {
      const halfCone = ((def.coneAngle ?? 50) * Math.PI) / 180 / 2
      ctx.save()
      ctx.globalAlpha = 0.28
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = 12
      ctx.beginPath()
      ctx.moveTo(center.x, center.y)
      ctx.arc(center.x, center.y, def.range, tower.rotation - halfCone, tower.rotation + halfCone)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    if (tower.kind === 'beam' && tower.active && tower.lockedTargetId) {
      const target = enemies.find((e) => e.id === tower.lockedTargetId)
      if (target) {
        const targetPos = getPointAtProgress(pathPixels, target.progress)
        ctx.save()
        ctx.strokeStyle = color
        ctx.shadowColor = color
        ctx.shadowBlur = 10
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(center.x, center.y)
        ctx.lineTo(targetPos.x, targetPos.y)
        ctx.stroke()
        ctx.restore()
      }
    }

    if (tower.kind === 'burst' && tower.charging) {
      const chargeFraction = tower.chargeElapsed / (def.chargeTime ?? 1.5)
      ctx.save()
      ctx.globalAlpha = 0.5 + 0.4 * chargeFraction
      ctx.strokeStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = 10
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(center.x, center.y, 12 + 8 * chargeFraction, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }
}
