// Farb-Effekte — jede der 14 Kampf-Farben (Tier 1-5, siehe data/resources.ts) hat ihren EIGENEN,
// festen Effekt, der bei einem Treffer direkt angewendet wird — siehe applyAmmoEffect() als
// zentraler Dispatch, aufgerufen aus towerdefense/combat.ts' treatHit(). Kurzbeschreibungen je
// Farbe (siehe COLOR_EFFECT_INFO unten) stehen im Farb-Guide (render/referencePanels.ts
// drawColorGuideList()). Alle Stack-Felder/Konstanten leben in enemies.ts (Datenmodell), diese
// Datei enthält nur die Anwendungs-LOGIK je Farbe.
//
//   Turmform -> bestimmt, wie Treffer verteilt werden (siehe combat.ts)
//   Munition -> bestimmt hier, WELCHER Farb-Effekt beim Treffer ausgelöst wird

import { dealDamage, type Enemy, type Tier3StackKey } from './enemies'
import {
  AMBER_EXPLOSION_DAMAGE_FRACTION,
  AMBER_EXPLOSION_RADIUS,
  AMBER_STACK_MAX,
  AQUAMARINE_PULL_RADIUS,
  AQUAMARINE_PULL_STRENGTH,
  BLACK_STACK_DURATION,
  BLACK_THRESHOLD_PER_STACK,
  CERULEAN_FREEZE_DURATION,
  CERULEAN_STACK_MAX,
  CHAIN_LIGHTNING_RADIUS,
  CHARTREUSE_SPREAD_FRACTION,
  CHARTREUSE_SPREAD_RADIUS,
  CYAN_SLOW_DURATION,
  FUCHSIA_MAX_JUMPS,
  FUCHSIA_STACK_MAX,
  MAGENTA_BONUS_DAMAGE,
  TIER2_STACK_MAX,
  VIOLET_STACK_MAX,
  WHITE_PURGE_FRACTION_PER_POOL,
  YELLOW_CHAIN_JUMPS,
} from './enemies'
import { getPointAtProgress, type Point } from './path'

/** Lebende Gegner in `radius` Pixel um `source`, ohne `source` selbst und ohne `excludeIds`
 * (fürs Ketten-/Spread-/Explosions-Ausschließen bereits getroffener Ziele). */
function findNearbyEnemies(allEnemies: Enemy[], source: Enemy, pathPixels: Point[], radius: number, excludeIds: Set<string>): Enemy[] {
  const sourcePos = getPointAtProgress(pathPixels, source.progress)
  return allEnemies.filter((e) => e.hp > 0 && e.id !== source.id && !excludeIds.has(e.id) && Math.hypot(getPointAtProgress(pathPixels, e.progress).x - sourcePos.x, getPointAtProgress(pathPixels, e.progress).y - sourcePos.y) <= radius)
}

/** Springt von `origin` aus bis zu `maxJumps` Mal auf je einen neuen, noch nicht getroffenen
 * Gegner in der Nähe und verursacht dort denselben Schaden — für Yellow (fix 3 Sprünge) und
 * Fuchsia (skaliert mit dessen eigenen Stacks, bis zu 10 Sprünge). */
function chainLightning(origin: Enemy, damage: number, maxJumps: number, allEnemies: Enemy[], pathPixels: Point[]) {
  if (maxJumps <= 0) return
  const hit = new Set([origin.id])
  let current = origin
  for (let i = 0; i < maxJumps; i++) {
    const nearby = findNearbyEnemies(allEnemies, current, pathPixels, CHAIN_LIGHTNING_RADIUS, hit)
    if (nearby.length === 0) break
    const next = nearby[0]
    dealDamage(next, damage)
    hit.add(next.id)
    current = next
  }
}

// --- Tier 1 — Basic Effects ---

function applyYellow(target: Enemy, damage: number, allEnemies: Enemy[], pathPixels: Point[]) {
  chainLightning(target, damage, YELLOW_CHAIN_JUMPS, allEnemies, pathPixels)
}

function applyMagenta(target: Enemy) {
  dealDamage(target, MAGENTA_BONUS_DAMAGE)
}

function applyCyan(target: Enemy, elapsedSeconds: number) {
  target.cyanSlowUntil = Math.max(target.cyanSlowUntil, elapsedSeconds + CYAN_SLOW_DURATION)
}

// --- Tier 2 — Stacking Effects ---

function applyBlue(target: Enemy) {
  target.blueStacks = Math.min(TIER2_STACK_MAX, target.blueStacks + 1)
}

function applyRed(target: Enemy) {
  target.redStacks = Math.min(TIER2_STACK_MAX, target.redStacks + 1)
}

function applyGreen(target: Enemy) {
  target.greenStacks = TIER2_STACK_MAX // wird auf den Maximalwert GESETZT, nicht addiert (User-Vorgabe)
}

// --- Tier 3 — Special Stack Effects ---

function applyCerulean(target: Enemy, elapsedSeconds: number) {
  target.ceruleanStacks = Math.min(CERULEAN_STACK_MAX, target.ceruleanStacks + 1)
  if (target.ceruleanStacks >= CERULEAN_STACK_MAX) {
    target.frozenUntil = elapsedSeconds + CERULEAN_FREEZE_DURATION
    target.ceruleanStacks = 0
  }
}

function applyViolet(target: Enemy) {
  target.violetStacks = Math.min(VIOLET_STACK_MAX, target.violetStacks + 1)
}

const TIER3_STACK_ACCESSORS: { key: Tier3StackKey; get: (e: Enemy) => number; set: (e: Enemy, v: number) => void; max: number }[] = [
  { key: 'cerulean', get: (e) => e.ceruleanStacks, set: (e, v) => (e.ceruleanStacks = v), max: CERULEAN_STACK_MAX },
  { key: 'violet', get: (e) => e.violetStacks, set: (e, v) => (e.violetStacks = v), max: VIOLET_STACK_MAX },
]

/** Chartreuse hat keinen eigenen Stack-Pool — überträgt stattdessen bis zu 50% der VORHANDENEN
 * Cerulean-/Violet-Stacks (Tier 3) des Ziels auf Gegner in der Nähe. Stacks, die selbst schon per
 * Spread empfangen wurden, werden dabei ausgelassen (siehe `tier3SpreadBlock` in enemies.ts),
 * damit keine Kettenreaktion entsteht. */
function applyChartreuse(target: Enemy, allEnemies: Enemy[], pathPixels: Point[]) {
  const nearby = findNearbyEnemies(allEnemies, target, pathPixels, CHARTREUSE_SPREAD_RADIUS, new Set())
  if (nearby.length === 0) return
  for (const accessor of TIER3_STACK_ACCESSORS) {
    if (target.tier3SpreadBlock.has(accessor.key)) continue
    const amount = accessor.get(target) * CHARTREUSE_SPREAD_FRACTION
    if (amount <= 0) continue
    for (const other of nearby) {
      accessor.set(other, Math.min(accessor.max, accessor.get(other) + amount))
      other.tier3SpreadBlock.add(accessor.key)
    }
  }
}

// --- Tier 4 — Advanced Effects ---

/** Aquamarine hat keinen Stack-Pool — zieht Gegner in der Nähe stattdessen pro Treffer ein Stück
 * Richtung Trefferpunkt (Fortschritts-Angleichung entlang des Pfads), sodass sie sich mit der
 * Zeit zusammenballen. */
function applyAquamarine(target: Enemy, allEnemies: Enemy[], pathPixels: Point[]) {
  const nearby = findNearbyEnemies(allEnemies, target, pathPixels, AQUAMARINE_PULL_RADIUS, new Set())
  for (const other of nearby) {
    other.progress += (target.progress - other.progress) * AQUAMARINE_PULL_STRENGTH
  }
}

function applyFuchsia(target: Enemy, damage: number, allEnemies: Enemy[], pathPixels: Point[]) {
  target.fuchsiaStacks = Math.min(FUCHSIA_STACK_MAX, target.fuchsiaStacks + 1)
  const jumps = Math.floor((target.fuchsiaStacks / FUCHSIA_STACK_MAX) * FUCHSIA_MAX_JUMPS)
  chainLightning(target, damage, jumps, allEnemies, pathPixels)
}

function applyAmber(target: Enemy, allEnemies: Enemy[], pathPixels: Point[]) {
  target.amberStacks = Math.min(AMBER_STACK_MAX, target.amberStacks + 1)
  if (target.amberStacks < AMBER_STACK_MAX) return
  target.amberStacks = 0
  const damage = target.maxHp * AMBER_EXPLOSION_DAMAGE_FRACTION
  for (const other of findNearbyEnemies(allEnemies, target, pathPixels, AMBER_EXPLOSION_RADIUS, new Set())) dealDamage(other, damage)
}

// --- Tier 5 — Ultimate Effects ---

function applyBlack(target: Enemy, elapsedSeconds: number) {
  if (target.blackStacksExpireAt <= elapsedSeconds) target.blackStacks = 0
  target.blackStacks += 1
  target.blackStacksExpireAt = elapsedSeconds + BLACK_STACK_DURATION
  const thresholdFraction = target.blackStacks * BLACK_THRESHOLD_PER_STACK
  if (target.hp / target.maxHp <= thresholdFraction) target.hp = 0
}

/** Verzehrt sofort ALLE vorhandenen Farb-Stacks des Ziels (Blue/Red/Green/Cerulean/Violet/
 * Fuchsia/Amber) und wandelt die Summe ihrer Füllstände in einen einmaligen Schadens-Burst um,
 * danach werden sie auf 0 zurückgesetzt — kein eigener Stack-Pool, kein Verfall. */
function applyWhite(target: Enemy) {
  const pools: { stacks: number; max: number }[] = [
    { stacks: target.blueStacks, max: TIER2_STACK_MAX },
    { stacks: target.redStacks, max: TIER2_STACK_MAX },
    { stacks: target.greenStacks, max: TIER2_STACK_MAX },
    { stacks: target.ceruleanStacks, max: CERULEAN_STACK_MAX },
    { stacks: target.violetStacks, max: VIOLET_STACK_MAX },
    { stacks: target.fuchsiaStacks, max: FUCHSIA_STACK_MAX },
    { stacks: target.amberStacks, max: AMBER_STACK_MAX },
  ]
  const totalFraction = pools.reduce((sum, p) => sum + p.stacks / p.max, 0)
  if (totalFraction > 0) dealDamage(target, target.maxHp * WHITE_PURGE_FRACTION_PER_POOL * totalFraction)

  target.blueStacks = 0
  target.redStacks = 0
  target.greenStacks = 0
  target.ceruleanStacks = 0
  target.violetStacks = 0
  target.fuchsiaStacks = 0
  target.amberStacks = 0
}

/**
 * Zentraler Dispatch: wendet den zur zugewiesenen Munition gehörenden Farb-Effekt an. Ohne
 * zugewiesene Munition (resourceId null) oder bei Ressourcen ohne eigenen Effekt (Lumen/Prisma —
 * die inzwischen ohnehin nicht mehr als Munition wählbar sind, siehe colorWheelPanel.ts
 * AMMO_RESOURCES) passiert nichts.
 */
export function applyAmmoEffect(resourceId: string | null, damage: number, target: Enemy, allEnemies: Enemy[], pathPixels: Point[], elapsedSeconds: number) {
  switch (resourceId) {
    case 'yellow':
      applyYellow(target, damage, allEnemies, pathPixels)
      return
    case 'magenta':
      applyMagenta(target)
      return
    case 'cyan':
      applyCyan(target, elapsedSeconds)
      return
    case 'blue':
      applyBlue(target)
      return
    case 'red':
      applyRed(target)
      return
    case 'green':
      applyGreen(target)
      return
    case 'cerulean':
      applyCerulean(target, elapsedSeconds)
      return
    case 'violet':
      applyViolet(target)
      return
    case 'chartreuse':
      applyChartreuse(target, allEnemies, pathPixels)
      return
    case 'aquamarine':
      applyAquamarine(target, allEnemies, pathPixels)
      return
    case 'fuchsia':
      applyFuchsia(target, damage, allEnemies, pathPixels)
      return
    case 'amber':
      applyAmber(target, allEnemies, pathPixels)
      return
    case 'black':
      applyBlack(target, elapsedSeconds)
      return
    case 'white':
      applyWhite(target)
      return
  }
}

/** Kurzbeschreibungen für den Farb-Guide (siehe render/referencePanels.ts drawColorGuideList()) —
 * eine knappe Zeile je Farbe, muss inhaltlich zu den apply*()-Funktionen oben passen. */
export const COLOR_EFFECT_INFO: Record<string, { name: string; description: string }> = {
  cyan: { name: 'Minor Slow', description: 'Slightly slows the target.' },
  magenta: { name: 'Bonus Damage', description: 'Extra direct damage per hit.' },
  yellow: { name: 'Chain Lightning', description: 'Jumps to up to 3 enemies.' },
  blue: { name: 'Slow', description: 'Stacking slow, up to 10 stacks.' },
  red: { name: 'Burn', description: 'Stacking burn, up to 10 stacks.' },
  green: { name: 'Poison', description: 'Resets poison to 10 stacks.' },
  cerulean: { name: 'Freeze', description: 'At 30 stacks: freeze for 1s.' },
  violet: { name: 'Vulnerability', description: 'Up to +10% damage taken.' },
  chartreuse: { name: 'Stack Spread', description: 'Spreads Tier 3 stacks to nearby enemies.' },
  aquamarine: { name: 'Pull', description: 'Pulls nearby enemies together.' },
  fuchsia: { name: 'Scaling Chain Lightning', description: 'More stacks = more chained targets.' },
  amber: { name: 'Explosion', description: 'At 30 stacks: AoE damage.' },
  black: { name: 'Execute', description: 'Raises execute threshold per hit.' },
  white: { name: 'Purge Burst', description: 'Consumes all stacks for burst damage.' },
}
