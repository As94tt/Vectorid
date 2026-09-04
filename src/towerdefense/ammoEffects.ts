// Farb-Effekte (User-Vorgabe, komplette Tabelle, ersetzt die vorherige "C/M/Y-Mischungsverhältnis
// bestimmt Status"-Mechanik): jede der 16 Kampf-Farben (Tier 1-5) hat ihren EIGENEN, festen Effekt,
// der bei einem Treffer direkt angewendet wird — siehe applyAmmoEffect() als zentraler Dispatch,
// aufgerufen aus towerdefense/combat.ts' treatHit(). Alle Stack-Felder/Konstanten leben in
// enemies.ts (Datenmodell), diese Datei enthält nur die Anwendungs-LOGIK je Farbe.
//
//   Turmform -> bestimmt, wie Treffer verteilt werden (siehe combat.ts)
//   Munition -> bestimmt hier, WELCHER Farb-Effekt beim Treffer ausgelöst wird
//
// Tier-3-Verstärker (Teal/Purple/Olive) erhöhen die STACK-GEWINNRATE ihrer jeweiligen Tier-4-
// Farbfamilie (Cyan-Spektrum/Magenta-Spektrum/Yellow-Spektrum) — für Aquamarine (das selbst
// keinen eigenen Stack-Pool führt, siehe enemies.ts-Kommentar) wird Teals Bonus stattdessen als
// zusätzlicher Spread-Anteil interpretiert (eigene, dokumentierte Auslegung einer im Rohtext nicht
// ganz eindeutigen Stelle: Teal erwähnt "Aquamarine-Stacks", aber Aquamarines eigene
// Beschreibung führt keinen eigenen Stack-Aufbau — sinnvollste Deutung: Teal macht Aquamarines
// Weiterverbreitung wirksamer).

import { dealDamage, type Enemy, type Tier4StackKey } from './enemies'
import {
  AMPLIFIER_MAX,
  AMPLIFIER_PER_HIT,
  AQUAMARINE_BASE_SPREAD_FRACTION,
  AQUAMARINE_SPREAD_RADIUS,
  BLACK_STACK_DURATION,
  BLACK_THRESHOLD_PER_STACK,
  CERULEAN_FREEZE_DURATION,
  CHAIN_LIGHTNING_RADIUS,
  CHARTREUSE_MAX_JUMPS,
  CYAN_SLOW_DURATION,
  MAGENTA_BONUS_DAMAGE,
  TIER2_STACK_MAX,
  TIER4_HIGH_STACK_MAX,
  TIER4_LOW_STACK_MAX,
  VIOLET_EXPLOSION_DAMAGE_FRACTION,
  VIOLET_EXPLOSION_RADIUS,
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
 * Chartreuse (skaliert mit dessen eigenen Stacks, bis zu 10 Sprünge). */
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

// --- Tier 1 ---

function applyYellow(target: Enemy, damage: number, allEnemies: Enemy[], pathPixels: Point[]) {
  chainLightning(target, damage, YELLOW_CHAIN_JUMPS, allEnemies, pathPixels)
}

function applyMagenta(target: Enemy) {
  dealDamage(target, MAGENTA_BONUS_DAMAGE)
}

function applyCyan(target: Enemy, elapsedSeconds: number) {
  target.cyanSlowUntil = Math.max(target.cyanSlowUntil, elapsedSeconds + CYAN_SLOW_DURATION)
}

// --- Tier 2 ---

function applyBlue(target: Enemy) {
  target.blueStacks = Math.min(TIER2_STACK_MAX, target.blueStacks + 1)
}

function applyRed(target: Enemy) {
  target.redStacks = Math.min(TIER2_STACK_MAX, target.redStacks + 1)
}

function applyGreen(target: Enemy) {
  target.greenStacks = TIER2_STACK_MAX // wird auf den Maximalwert GESETZT, nicht addiert (User-Vorgabe)
}

function applyBrown(target: Enemy) {
  if (target.blueStacks > 0) target.blueStacks = Math.min(TIER2_STACK_MAX, target.blueStacks + 1)
  if (target.redStacks > 0) target.redStacks = Math.min(TIER2_STACK_MAX, target.redStacks + 1)
  if (target.greenStacks > 0) target.greenStacks = Math.min(TIER2_STACK_MAX, target.greenStacks + 1)
}

// --- Tier 3 (permanente Verstärker) ---

function applyTeal(target: Enemy) {
  target.tealAmplifier = Math.min(AMPLIFIER_MAX, target.tealAmplifier + AMPLIFIER_PER_HIT)
}

function applyPurple(target: Enemy) {
  target.purpleAmplifier = Math.min(AMPLIFIER_MAX, target.purpleAmplifier + AMPLIFIER_PER_HIT)
}

function applyOlive(target: Enemy) {
  target.oliveAmplifier = Math.min(AMPLIFIER_MAX, target.oliveAmplifier + AMPLIFIER_PER_HIT)
}

// --- Tier 4 ---

function applyCerulean(target: Enemy, elapsedSeconds: number) {
  const gain = 1 * (1 + target.tealAmplifier)
  target.ceruleanStacks = Math.min(TIER4_LOW_STACK_MAX, target.ceruleanStacks + gain)
  if (target.ceruleanStacks >= TIER4_LOW_STACK_MAX) {
    target.frozenUntil = elapsedSeconds + CERULEAN_FREEZE_DURATION
    target.ceruleanStacks = 0
  }
}

const TIER4_STACK_ACCESSORS: { key: Tier4StackKey; get: (e: Enemy) => number; set: (e: Enemy, v: number) => void; max: number }[] = [
  { key: 'cerulean', get: (e) => e.ceruleanStacks, set: (e, v) => (e.ceruleanStacks = v), max: TIER4_LOW_STACK_MAX },
  { key: 'violet', get: (e) => e.violetStacks, set: (e, v) => (e.violetStacks = v), max: TIER4_LOW_STACK_MAX },
  { key: 'fuchsia', get: (e) => e.fuchsiaStacks, set: (e, v) => (e.fuchsiaStacks = v), max: TIER4_HIGH_STACK_MAX },
  { key: 'amber', get: (e) => e.amberStacks, set: (e, v) => (e.amberStacks = v), max: TIER4_HIGH_STACK_MAX },
  { key: 'chartreuse', get: (e) => e.chartreuseStacks, set: (e, v) => (e.chartreuseStacks = v), max: TIER4_HIGH_STACK_MAX },
]

/** Überträgt bis zu (50% + Teal-Bonus) der vorhandenen Tier-4-Stacks des Ziels auf Gegner in der
 * Nähe — Stacks, die selbst schon per Spread empfangen wurden, werden dabei ausgelassen (siehe
 * `aquamarineSpreadBlock` in enemies.ts), damit keine Kettenreaktion entsteht. */
function applyAquamarine(target: Enemy, allEnemies: Enemy[], pathPixels: Point[]) {
  const fraction = Math.min(1, AQUAMARINE_BASE_SPREAD_FRACTION + target.tealAmplifier)
  const nearby = findNearbyEnemies(allEnemies, target, pathPixels, AQUAMARINE_SPREAD_RADIUS, new Set())
  if (nearby.length === 0) return
  for (const accessor of TIER4_STACK_ACCESSORS) {
    if (target.aquamarineSpreadBlock.has(accessor.key)) continue
    const amount = accessor.get(target) * fraction
    if (amount <= 0) continue
    for (const other of nearby) {
      accessor.set(other, Math.min(accessor.max, accessor.get(other) + amount))
      other.aquamarineSpreadBlock.add(accessor.key)
    }
  }
}

function applyViolet(target: Enemy, allEnemies: Enemy[], pathPixels: Point[]) {
  const gain = 1 * (1 + target.purpleAmplifier)
  target.violetStacks = Math.min(TIER4_LOW_STACK_MAX, target.violetStacks + gain)
  if (target.violetStacks < TIER4_LOW_STACK_MAX) return
  target.violetStacks = 0
  const damage = target.maxHp * VIOLET_EXPLOSION_DAMAGE_FRACTION
  for (const other of findNearbyEnemies(allEnemies, target, pathPixels, VIOLET_EXPLOSION_RADIUS, new Set())) dealDamage(other, damage)
}

function applyFuchsia(target: Enemy) {
  const gain = 1 * (1 + target.purpleAmplifier)
  target.fuchsiaStacks = Math.min(TIER4_HIGH_STACK_MAX, target.fuchsiaStacks + gain)
}

function applyAmber(target: Enemy) {
  const gain = 1 * (1 + target.oliveAmplifier)
  target.amberStacks = Math.min(TIER4_HIGH_STACK_MAX, target.amberStacks + gain)
}

function applyChartreuse(target: Enemy, damage: number, allEnemies: Enemy[], pathPixels: Point[]) {
  const gain = 1 * (1 + target.oliveAmplifier)
  target.chartreuseStacks = Math.min(TIER4_HIGH_STACK_MAX, target.chartreuseStacks + gain)
  const jumps = Math.floor((target.chartreuseStacks / TIER4_HIGH_STACK_MAX) * CHARTREUSE_MAX_JUMPS)
  chainLightning(target, damage, jumps, allEnemies, pathPixels)
}

// --- Tier 5 ---

function applyBlack(target: Enemy, elapsedSeconds: number) {
  if (target.blackStacksExpireAt <= elapsedSeconds) target.blackStacks = 0
  target.blackStacks += 1
  target.blackStacksExpireAt = elapsedSeconds + BLACK_STACK_DURATION
  const thresholdFraction = target.blackStacks * BLACK_THRESHOLD_PER_STACK
  if (target.hp / target.maxHp <= thresholdFraction) target.hp = 0
}

/**
 * Zentraler Dispatch: wendet den zur zugewiesenen Munition gehörenden Farb-Effekt an (siehe
 * Tabelle oben im Datei-Kommentar). Ohne zugewiesene Munition (resourceId null) oder bei
 * Ressourcen ohne eigenen Effekt (Lumen/Prisma) passiert nichts.
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
    case 'brown':
      applyBrown(target)
      return
    case 'teal':
      applyTeal(target)
      return
    case 'purple':
      applyPurple(target)
      return
    case 'olive':
      applyOlive(target)
      return
    case 'cerulean':
      applyCerulean(target, elapsedSeconds)
      return
    case 'aquamarine':
      applyAquamarine(target, allEnemies, pathPixels)
      return
    case 'violet':
      applyViolet(target, allEnemies, pathPixels)
      return
    case 'fuchsia':
      applyFuchsia(target)
      return
    case 'amber':
      applyAmber(target)
      return
    case 'chartreuse':
      applyChartreuse(target, damage, allEnemies, pathPixels)
      return
    case 'black':
      applyBlack(target, elapsedSeconds)
      return
  }
}

/** Kurzbeschreibungen für die "Munition"-Infoseite (siehe render/referencePanels.ts) — 1:1 aus
 * der User-Tabelle destilliert, aber auf eine knappe Zeile fürs Panel-Layout gekürzt. */
export const COLOR_EFFECT_INFO: Record<string, { name: string; description: string }> = {
  yellow: { name: 'Chain Lightning', description: 'Lightning jumps to up to 3 more enemies' },
  magenta: { name: 'Bonus Damage', description: 'Extra direct damage per hit' },
  cyan: { name: 'Minor Slow', description: 'Light slow, much weaker than Blue' },
  blue: { name: 'Stacking Slow', description: 'Up to 10 stacks, stronger slow per stack, -1/s' },
  red: { name: 'Decaying Burn', description: 'Up to 10 stacks of burn damage/s, -1 stack/s' },
  green: { name: 'Poison', description: 'Sets poison to a full 10 stacks, -1 stack/s' },
  brown: { name: 'Tier-2 Amplifier', description: '+1 stack to existing Blue/Red/Green effects' },
  teal: { name: 'Cyan-Spectrum Amplifier', description: 'Boosts future Cerulean/Aquamarine stacks' },
  purple: { name: 'Magenta-Spectrum Amplifier', description: 'Boosts future Violet/Fuchsia stacks' },
  olive: { name: 'Yellow-Spectrum Amplifier', description: 'Boosts future Amber/Chartreuse stacks' },
  cerulean: { name: 'Freeze', description: 'At 30 stacks, fully frozen for 1s, then resets' },
  aquamarine: { name: 'Stack Spread', description: 'Spreads up to 50% of Tier-4 stacks to nearby enemies' },
  violet: { name: 'Explosion', description: 'At 30 stacks, area damage (3% max HP), then resets' },
  fuchsia: { name: 'Vulnerability', description: 'Up to +10% damage taken at 100 stacks' },
  amber: { name: 'Permanent Burn', description: 'Permanent burn, up to 1% max HP/s at 100 stacks' },
  chartreuse: { name: 'Scaling Chain Lightning', description: 'Lightning jumps (up to 10) scale with stacks' },
  black: { name: 'Execute', description: '+0.1 percentage points execute threshold/hit, lasts 5s' },
}
