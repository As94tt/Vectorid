// Schuss-/Zielerfassungslogik je Turmtyp (Form = Mechanik, siehe CLAUDE.md). Reine Logik,
// kein Rendering (siehe render/combatRender.ts). Wird einmal pro Frame aus main.ts' combatTick
// aufgerufen, NACH dem Bewegungs-/Status-Tick der Gegner (towerdefense/enemies.ts).
//
// Turmform bestimmt hier, WIE Treffer verteilt werden (1 Ziel, mehrere Ziele, Kegel, alle in
// Reichweite, ...) — WAS ein Treffer bewirkt (Schaden + C/M/Y-Lieferung) ist für jeden Turm
// gleich, siehe treatHit() unten (ammoEffects.ts liefert nur noch C/M/Y, keine Fähigkeiten mehr).

import { getResource } from '../data/resources'
import { TOWER_UNSELECTED_COLOR } from '../render/towerRender'
import { applyAmmoEffect } from './ammoEffects'
import { dealDamage, type Enemy } from './enemies'
import { getPointAtProgress, type Point } from './path'
import { getEffectiveTowerStats, getTowerDefinition, loadoutKey, type PlacedTower, type TowerDefinition, type TowerKind } from './towers'

export interface Projectile {
  id: string
  x: number
  y: number
  targetId: string
  speed: number
  damage: number
  resourceId: string | null
  /** Welche Turmart dieses Projektil abgefeuert hat — trifft es, wird der Schaden auf diese
   * Konfiguration angerechnet (siehe `treatHit()`/main.ts drawTowerLoadoutSummary()), da das
   * Projektil sonst (einmal unterwegs) keinen Bezug mehr zu seinem Ursprungsturm hat. */
  towerKind: TowerKind
  /** Nur Cannon: Radius, in dem beim Einschlag zusätzlich (reduzierter) Schaden verteilt wird. */
  splashRadius?: number
}

export interface VisualEffect {
  kind: 'ring' | 'flash'
  x: number
  y: number
  radius: number
  startedAt: number
  duration: number
  color: string
}

function colorFor(resourceId: string | null): string {
  return resourceId ? getResource(resourceId).color : TOWER_UNSELECTED_COLOR
}

function angleBetween(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x)
}

/** Ein Treffer: Schaden anwenden + der Farb-Effekt der Munition wird ausgelöst (siehe
 * ammoEffects.ts). `allEnemies`/`pathPixels`/`elapsedSeconds` werden nur für die Effekte
 * gebraucht, die andere Gegner in der Nähe betreffen (Chain Lightning, Stack Spread, Explosion)
 * bzw. einen Zeitstempel brauchen (Cyan-Slow, Freeze, Black-Execute).
 *
 * Zählt den tatsächlich abgezogenen Schaden (siehe dealDamage()) auf `damageByLoadout` (siehe
 * towers.ts loadoutKey()) — bewusst NUR der direkte Treffer-Schaden dieses Schusses, NICHT
 * zusätzlicher Folgeschaden aus applyAmmoEffect() (z. B. Magentas Bonus-Schaden, Ambers Explosion,
 * Whites Purge-Burst, oder die laufenden Burn-/Poison-Ticks in enemies.ts tickEnemy()) — diese
 * ließen sich nicht mehr eindeutig auf EINEN Turm zurückführen (mehrere Türme können z. B.
 * denselben Stack-Pool auffrischen). Die Übersicht zeigt daher den reinen Treffer-Schaden, nicht
 * die volle Gesamtschadenssumme. */
function treatHit(
  target: Enemy,
  damage: number,
  resourceId: string | null,
  allEnemies: Enemy[],
  pathPixels: Point[],
  elapsedSeconds: number,
  towerKind: TowerKind,
  damageByLoadout: Map<string, number>,
) {
  const dealt = dealDamage(target, damage)
  if (resourceId) {
    const key = loadoutKey(towerKind, resourceId)
    damageByLoadout.set(key, (damageByLoadout.get(key) ?? 0) + dealt)
  }
  applyAmmoEffect(resourceId, damage, target, allEnemies, pathPixels, elapsedSeconds)
}

/**
 * Die Grundformen zeigen standardmäßig nach oben (Polygon-Konvention, siehe render/shapes.ts) —
 * darum +90° für alle eckigen/sternförmigen Türme, damit eine Spitze/Ecke exakt Richtung Ziel
 * zeigt (Rapid/Multishot/Sniper/Burst — eine Drehung ändert dort nie die erkennbare Form).
 * Halbkreis (Flamethrower) nutzt seine eigene, direkte Winkel-Konvention. Kreis (Pulse) braucht
 * keine Rotation (rundum symmetrisch). Cannon (Quadrat) und Beam (auf 45° fixierte Raute) drehen
 * sich bewusst NICHT mit dem Ziel — ein beliebig gedrehtes Quadrat könnte sonst optisch mit der
 * jeweils anderen Form verwechselt werden (siehe die beiden Sonderfälle in `updateProjectileTower`/
 * `updateBeam`, die `aimRotation()` für diese zwei Turmarten gar nicht erst aufrufen).
 */
function aimRotation(kind: TowerKind, angle: number): number {
  switch (kind) {
    case 'pulse':
      return 0
    case 'flamethrower':
      return angle
    default:
      return angle + Math.PI / 2
  }
}

/** Gegner in Reichweite, sortiert nach Fortschritt absteigend (am weitesten fortgeschrittener
 * Gegner zuerst) — einheitliche, einfache Ziel-Priorität für alle Einzel-/Mehrfachziel-Türme. */
function targetsInRange(enemies: Enemy[], center: Point, range: number, pathPixels: Point[]): Enemy[] {
  return enemies
    .filter((e) => e.hp > 0)
    .map((enemy) => ({ enemy, pos: getPointAtProgress(pathPixels, enemy.progress) }))
    .filter(({ pos }) => Math.hypot(pos.x - center.x, pos.y - center.y) <= range)
    .sort((a, b) => b.enemy.progress - a.enemy.progress)
    .map(({ enemy }) => enemy)
}

let projectileCounter = 0
function fireProjectile(
  center: Point,
  target: Enemy,
  damage: number,
  speed: number,
  resourceId: string | null,
  towerKind: TowerKind,
  splashRadius: number | undefined,
  projectiles: Projectile[],
) {
  projectileCounter += 1
  projectiles.push({ id: `proj-${projectileCounter}`, x: center.x, y: center.y, targetId: target.id, speed, damage, resourceId, towerKind, splashRadius })
}

function createRingEffect(center: Point, radius: number, elapsedSeconds: number, color: string): VisualEffect {
  return { kind: 'ring', x: center.x, y: center.y, radius, startedAt: elapsedSeconds, duration: 0.35, color }
}

function createFlashEffect(pos: Point, radius: number, elapsedSeconds: number, color: string): VisualEffect {
  return { kind: 'flash', x: pos.x, y: pos.y, radius, startedAt: elapsedSeconds, duration: 0.25, color }
}

export function pruneVisualEffects(effects: VisualEffect[], elapsedSeconds: number): VisualEffect[] {
  return effects.filter((e) => elapsedSeconds < e.startedAt + e.duration)
}

/** Kreis/Pulse: trifft ALLE Gegner in Reichweite gleichzeitig, keine Zielrotation nötig. */
function updatePulse(
  tower: PlacedTower,
  def: TowerDefinition,
  center: Point,
  enemies: Enemy[],
  elapsedSeconds: number,
  pathPixels: Point[],
  effects: VisualEffect[],
  damageByLoadout: Map<string, number>,
) {
  const targets = targetsInRange(enemies, center, def.range, pathPixels)
  if (targets.length === 0 || tower.cooldown > 0) return

  for (const target of targets) treatHit(target, def.damage, tower.resourceId, enemies, pathPixels, elapsedSeconds, tower.kind, damageByLoadout)
  tower.cooldown = def.fireInterval
  effects.push(createRingEffect(center, def.range, elapsedSeconds, colorFor(tower.resourceId)))
}

/** Rapid/Cannon/Multishot/Sniper: feuern Projektile auf 1 (bzw. bei Multishot mehrere) Ziel(e). */
function updateProjectileTower(
  tower: PlacedTower,
  def: TowerDefinition,
  center: Point,
  enemies: Enemy[],
  pathPixels: Point[],
  projectiles: Projectile[],
) {
  const targets = targetsInRange(enemies, center, def.range, pathPixels)
  if (targets.length === 0) return

  // Cannon (Quadrat) dreht sich NICHT mit — ein beliebig gedrehtes Quadrat kann optisch wie die
  // Raute (Beam, fest auf 45°) aussehen, das würde die Form-Bedeutung der beiden Türme vermischen.
  if (tower.kind !== 'cannon') {
    tower.rotation = aimRotation(tower.kind, angleBetween(center, getPointAtProgress(pathPixels, targets[0].progress)))
  }
  if (tower.cooldown > 0) return

  const chosen = targets.slice(0, def.projectileCount ?? 1)
  for (const target of chosen) {
    fireProjectile(center, target, def.damage, def.projectileSpeed ?? 400, tower.resourceId, tower.kind, def.splashRadius, projectiles)
  }
  tower.cooldown = def.fireInterval
}

/** Halbkreis/Flamethrower: tickt Schaden an ALLEN Gegnern innerhalb des Kegels vor dem Turm. */
function updateFlamethrower(
  tower: PlacedTower,
  def: TowerDefinition,
  center: Point,
  enemies: Enemy[],
  pathPixels: Point[],
  elapsedSeconds: number,
  damageByLoadout: Map<string, number>,
) {
  const targets = targetsInRange(enemies, center, def.range, pathPixels)
  tower.active = targets.length > 0
  if (targets.length === 0) return

  const aimAngle = angleBetween(center, getPointAtProgress(pathPixels, targets[0].progress))
  tower.rotation = aimRotation('flamethrower', aimAngle)
  if (tower.cooldown > 0) return

  const halfCone = ((def.coneAngle ?? 50) * Math.PI) / 180 / 2
  for (const target of targets) {
    const angle = angleBetween(center, getPointAtProgress(pathPixels, target.progress))
    let diff = Math.abs(angle - aimAngle)
    if (diff > Math.PI) diff = Math.PI * 2 - diff
    if (diff > halfCone) continue
    treatHit(target, def.damage, tower.resourceId, enemies, pathPixels, elapsedSeconds, tower.kind, damageByLoadout)
  }
  tower.cooldown = def.fireInterval
}

/** Raute/Beam: verriegelt ein Ziel und tickt Dauerschaden, solange es lebt und in Reichweite bleibt. */
function updateBeam(
  tower: PlacedTower,
  def: TowerDefinition,
  center: Point,
  enemies: Enemy[],
  pathPixels: Point[],
  elapsedSeconds: number,
  damageByLoadout: Map<string, number>,
) {
  let target = enemies.find((e) => e.id === tower.lockedTargetId && e.hp > 0)
  if (target) {
    const pos = getPointAtProgress(pathPixels, target.progress)
    if (Math.hypot(pos.x - center.x, pos.y - center.y) > def.range) target = undefined
  }
  if (!target) {
    target = targetsInRange(enemies, center, def.range, pathPixels)[0]
    tower.lockedTargetId = target ? target.id : null
  }
  tower.active = !!target
  if (!target) return

  // Beam bleibt fest auf seiner 45°-Rauten-Neigung (siehe defaultTowerRotation()) statt sich
  // zum Ziel zu drehen — sonst könnte es bei bestimmten Winkeln wie ein normales (Cannon-)
  // Quadrat aussehen. Die Laserlinie selbst (render/combatRender.ts) zeigt die Zielrichtung.
  if (tower.cooldown > 0) return

  treatHit(target, def.damage, tower.resourceId, enemies, pathPixels, elapsedSeconds, tower.kind, damageByLoadout)
  tower.cooldown = def.fireInterval
}

/** Stern/Burst: lädt auf, solange ein Ziel in Reichweite bleibt, feuert dann eine Salve auf
 * einmal ab. Ladevorgang bricht ab (kein Fortschrittsverlust reicht, einfach Reset), sobald
 * kein Ziel mehr in Reichweite ist. */
function updateBurst(
  tower: PlacedTower,
  def: TowerDefinition,
  center: Point,
  enemies: Enemy[],
  dt: number,
  pathPixels: Point[],
  projectiles: Projectile[],
) {
  if (tower.cooldown > 0) {
    tower.charging = false
    tower.chargeElapsed = 0
    return
  }
  const targets = targetsInRange(enemies, center, def.range, pathPixels)
  if (targets.length === 0) {
    tower.charging = false
    tower.chargeElapsed = 0
    return
  }

  const target = targets[0]
  tower.rotation = aimRotation('burst', angleBetween(center, getPointAtProgress(pathPixels, target.progress)))
  tower.charging = true
  tower.chargeElapsed += dt
  if (tower.chargeElapsed < (def.chargeTime ?? 1.5)) return

  for (let i = 0; i < (def.volleyCount ?? 4); i++) {
    fireProjectile(center, target, def.damage, def.projectileSpeed ?? 450, tower.resourceId, tower.kind, undefined, projectiles)
  }
  tower.charging = false
  tower.chargeElapsed = 0
  tower.cooldown = def.fireInterval
}

/** Aktualisiert alle Türme für einen Frame: Cooldown runterzählen, Ziel(e) suchen, ggf. feuern.
 * Neue Projektile/Vorschau-Effekte werden in die übergebenen Arrays gepusht (Aufrufer hält die
 * Referenzen), Gegner werden direkt per `treatHit()` mutiert. `hasAmmo` prüft (in main.ts, gegen
 * die aktuelle Ressourcen-Netto-Rate), ob die zugewiesene Munition gerade tatsächlich verfügbar
 * ist — ist sie es nicht mehr, feuert der Turm überhaupt nicht. */
export function updateTowers(
  towers: PlacedTower[],
  enemies: Enemy[],
  dt: number,
  elapsedSeconds: number,
  pathPixels: Point[],
  towerCenter: (tower: PlacedTower) => Point,
  hasAmmo: (tower: PlacedTower) => boolean,
  projectiles: Projectile[],
  effects: VisualEffect[],
  damageByLoadout: Map<string, number>,
) {
  for (const tower of towers) {
    // Level-Skalierung (siehe towerdefense/towers.ts getEffectiveTowerStats()): überschreibt nur
    // die numerischen Kampf-/Verbrauchswerte, alle übrigen Definitions-Felder (Form-spezifische
    // Parameter wie coneAngle/projectileCount/chargeTime/volleyCount) bleiben die Basis-Werte.
    const def: TowerDefinition = { ...getTowerDefinition(tower.kind), ...getEffectiveTowerStats(tower) }
    const center = towerCenter(tower)
    tower.cooldown = Math.max(0, tower.cooldown - dt)

    if (!hasAmmo(tower)) {
      tower.charging = false
      tower.chargeElapsed = 0
      tower.active = false
      continue
    }

    switch (tower.kind) {
      case 'pulse':
        updatePulse(tower, def, center, enemies, elapsedSeconds, pathPixels, effects, damageByLoadout)
        break
      case 'flamethrower':
        updateFlamethrower(tower, def, center, enemies, pathPixels, elapsedSeconds, damageByLoadout)
        break
      case 'beam':
        updateBeam(tower, def, center, enemies, pathPixels, elapsedSeconds, damageByLoadout)
        break
      case 'burst':
        updateBurst(tower, def, center, enemies, dt, pathPixels, projectiles)
        break
      default:
        updateProjectileTower(tower, def, center, enemies, pathPixels, projectiles)
    }
  }
}

const PROJECTILE_HIT_RADIUS = 9
const SPLASH_DAMAGE_FACTOR = 0.6

/** Bewegt alle Projektile Richtung ihres (live nachverfolgten) Ziels, löst Treffer aus, sobald
 * sie nah genug sind, und entfernt sie danach. Ein Projektil, dessen Ziel bereits verschwunden
 * ist (gestorben, bevor es ankam), verschwindet ohne Wirkung — kein Aufprall-Tracking nötig. */
export function updateProjectiles(
  projectiles: Projectile[],
  enemies: Enemy[],
  dt: number,
  elapsedSeconds: number,
  pathPixels: Point[],
  effects: VisualEffect[],
  damageByLoadout: Map<string, number>,
): Projectile[] {
  const remaining: Projectile[] = []

  for (const proj of projectiles) {
    const target = enemies.find((e) => e.id === proj.targetId && e.hp > 0)
    if (!target) continue

    const targetPos = getPointAtProgress(pathPixels, target.progress)
    const dx = targetPos.x - proj.x
    const dy = targetPos.y - proj.y
    const dist = Math.hypot(dx, dy)

    if (dist <= PROJECTILE_HIT_RADIUS) {
      treatHit(target, proj.damage, proj.resourceId, enemies, pathPixels, elapsedSeconds, proj.towerKind, damageByLoadout)

      if (proj.splashRadius) {
        for (const other of enemies) {
          if (other.id === target.id) continue
          const otherPos = getPointAtProgress(pathPixels, other.progress)
          if (Math.hypot(otherPos.x - targetPos.x, otherPos.y - targetPos.y) <= proj.splashRadius) {
            treatHit(other, proj.damage * SPLASH_DAMAGE_FACTOR, proj.resourceId, enemies, pathPixels, elapsedSeconds, proj.towerKind, damageByLoadout)
          }
        }
        effects.push(createFlashEffect(targetPos, proj.splashRadius, elapsedSeconds, colorFor(proj.resourceId)))
      }
      continue
    }

    const step = Math.min(proj.speed * dt, dist)
    proj.x += (dx / dist) * step
    proj.y += (dy / dist) * step
    remaining.push(proj)
  }

  return remaining
}
