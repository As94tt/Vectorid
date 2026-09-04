// Gegner-Datenmodell + reine Zustands-Logik (Bewegung, Farb-Effekte, Schaden). Kein Rendering
// hier — siehe render/combatRender.ts. Position wird NICHT gespeichert, sondern bei Bedarf aus
// `progress` über getPointAtProgress() abgeleitet (siehe towerdefense/path.ts).
//
// Kern-Mechanik (User-Vorgabe, ersetzt die vorherige "C/M/Y-Mischungsverhältnis bestimmt Status"-
// Runde komplett): JEDE der 16 Kampf-Farben (Tier 1-5, Lumen/Prisma ausgenommen) hat ihren EIGENEN,
// festen Effekt, der bei einem Treffer direkt angewendet wird (siehe ammoEffects.ts für die
// Anwendungs-Logik je Farbe) — kein Ableiten aus einem Mischverhältnis mehr. Die meisten Tier-2/4-
// Effekte sammeln dafür Stacks auf dem Gegner, die hier als Felder + Verfalls-/Tick-Logik leben.
//
// Alle konkreten Zahlenwerte (max. DPS, Slow-Stärke, Radien, Bonusschaden, ...) sind — wie überall
// in diesem Projekt — Platzhalter-Balancing: die Tabelle des Users gibt Mechanik + Verhältnisse
// vor (z. B. "bei 10 Stacks maximaler Schaden"), aber keine absoluten Zahlen.

/** Tier-2-Stacks (Blue/Red/Green): 0 bis MAX, verlieren automatisch 1 Stack/Sekunde. */
export const TIER2_STACK_MAX = 10
export const STACK_DECAY_PER_SECOND = 1

export const RED_BURN_MAX_DPS = 5 // bei TIER2_STACK_MAX Stacks
export const GREEN_POISON_MAX_DPS = 6 // bei TIER2_STACK_MAX Stacks

/** Tier-3-Verstärker (Teal/Purple/Olive): permanent, kein Verfall (User-Tabelle nennt keinen). */
export const AMPLIFIER_PER_HIT = 0.1 // +10 Prozentpunkte je Treffer
export const AMPLIFIER_MAX = 1.0 // Deckel bei +100% Bonus-Stacks

/** Cerulean (Freeze) / Violet (Explosion): 0-30, kein Verfall vor Auslösung, danach zurückgesetzt. */
export const TIER4_LOW_STACK_MAX = 30
export const CERULEAN_FREEZE_DURATION = 1
export const VIOLET_EXPLOSION_DAMAGE_FRACTION = 0.03 // 3% der maximalen Lebenspunkte des auslösenden Gegners
export const VIOLET_EXPLOSION_RADIUS = 60
export const AQUAMARINE_SPREAD_RADIUS = 70
export const AQUAMARINE_BASE_SPREAD_FRACTION = 0.5

/** Fuchsia (Vulnerability) / Amber (Permanent Burn) / Chartreuse (Scaling Chain): 0-100, permanent. */
export const TIER4_HIGH_STACK_MAX = 100
export const FUCHSIA_MAX_VULNERABILITY = 0.1 // +10% erlittener Schaden bei 100 Stacks
export const AMBER_MAX_DPS_FRACTION = 0.01 // 1% der maximalen Lebenspunkte/Sekunde bei 100 Stacks
export const CHARTREUSE_MAX_JUMPS = 10 // bei 100 Stacks
export const CHAIN_LIGHTNING_RADIUS = 70

export const YELLOW_CHAIN_JUMPS = 3

export const MAGENTA_BONUS_DAMAGE = 2
export const CYAN_SLOW_DURATION = 1 // Sekunden, pro Treffer erneuert
export const CYAN_SLOW_REDUCTION = 0.15 // deutlich schwächer als Blues Maximalwert
export const BLUE_MAX_SLOW_REDUCTION = 0.5 // bei TIER2_STACK_MAX Blue-Stacks

/** Black (Execute): jeder Stack = 0.1 Prozentpunkte Execute-Schwelle, alle Stacks verfallen
 * gemeinsam 5s nach dem letzten Treffer (nicht einzeln pro Sekunde wie bei Tier 2). */
export const BLACK_STACK_DURATION = 5
export const BLACK_THRESHOLD_PER_STACK = 0.001 // 0.1 Prozentpunkte als Bruchteil (0-1)

export type Tier4StackKey = 'cerulean' | 'violet' | 'fuchsia' | 'amber' | 'chartreuse'

export interface Enemy {
  id: string
  hp: number
  maxHp: number
  /** Rüstung als Anteil abgezogenen Schadens (0-1), Platzhalter-Balancing. */
  armor: number
  /** 0 (Spawn) bis 1 (Ziel erreicht), Position wird daraus abgeleitet. */
  progress: number
  /** Fortschritt/Sekunde ohne Verlangsamung. */
  baseSpeed: number

  // Tier 1 — kein Stack, nur ein kurzzeitiger Effekt-Zeitstempel (Cyan).
  cyanSlowUntil: number

  // Tier 2 — 0-10, verlieren automatisch 1 Stack/Sekunde (siehe STACK_DECAY_PER_SECOND).
  blueStacks: number
  redStacks: number
  greenStacks: number

  // Tier 3 — permanente Verstärker für die jeweilige Tier-4-Farbfamilie (Teal=Cyan-Spektrum,
  // Purple=Magenta-Spektrum, Olive=Yellow-Spektrum), als Bruchteil (0 = kein Bonus, 1 = +100%).
  tealAmplifier: number
  purpleAmplifier: number
  oliveAmplifier: number

  // Tier 4
  ceruleanStacks: number // 0-30, Freeze-Trigger
  frozenUntil: number
  violetStacks: number // 0-30, Explosions-Trigger
  fuchsiaStacks: number // 0-100, permanent
  amberStacks: number // 0-100, permanent
  chartreuseStacks: number // 0-100, permanent
  /** Welche Tier-4-Stack-Typen dieser Gegner per Aquamarine-Spread EMPFANGEN hat — die dürfen
   * nicht noch einmal per Aquamarine weiterverbreitet werden (verhindert Kettenreaktionen). */
  aquamarineSpreadBlock: Set<Tier4StackKey>

  // Tier 5 — Black: Stacks verfallen gemeinsam BLACK_STACK_DURATION Sekunden nach dem letzten Treffer.
  blackStacks: number
  blackStacksExpireAt: number
}

let enemyCounter = 0
export function createEnemy(hp = 30, baseSpeed = 0.09, armor = 0.1): Enemy {
  enemyCounter += 1
  return {
    id: `enemy-${enemyCounter}`,
    hp,
    maxHp: hp,
    armor,
    progress: 0,
    baseSpeed,
    cyanSlowUntil: 0,
    blueStacks: 0,
    redStacks: 0,
    greenStacks: 0,
    tealAmplifier: 0,
    purpleAmplifier: 0,
    oliveAmplifier: 0,
    ceruleanStacks: 0,
    frozenUntil: 0,
    violetStacks: 0,
    fuchsiaStacks: 0,
    amberStacks: 0,
    chartreuseStacks: 0,
    aquamarineSpreadBlock: new Set(),
    blackStacks: 0,
    blackStacksExpireAt: 0,
  }
}

/** Aktuelle Bewegungsgeschwindigkeit als Faktor: eingefroren (Cerulean) stoppt komplett,
 * ansonsten addieren sich Cyans kurzer Minor-Slow und Blues stapelnder Slow (nie unter eine
 * kleine Rest-Geschwindigkeit, außer beim vollständigen Freeze). */
export function speedFactor(enemy: Enemy, elapsedSeconds: number): number {
  if (enemy.frozenUntil > elapsedSeconds) return 0
  let reduction = 0
  if (enemy.cyanSlowUntil > elapsedSeconds) reduction += CYAN_SLOW_REDUCTION
  reduction += (enemy.blueStacks / TIER2_STACK_MAX) * BLUE_MAX_SLOW_REDUCTION
  return Math.max(0.1, 1 - reduction)
}

/** Wendet Schaden an — gemindert durch Rüstung, verstärkt durch Fuchsias Vulnerability (gilt für
 * ALLE Schadensquellen, siehe User-Tabelle: "Schaden, den das Ziel aus allen Schadensquellen erhält"). */
export function dealDamage(enemy: Enemy, rawDamage: number) {
  const vulnerability = 1 + (enemy.fuchsiaStacks / TIER4_HIGH_STACK_MAX) * FUCHSIA_MAX_VULNERABILITY
  enemy.hp -= rawDamage * (1 - enemy.armor) * vulnerability
}

/** Pro Frame: Bewegung (abzüglich Slow/Freeze) + Stack-Verfall (Blue/Red/Green je 1/Sekunde,
 * Black gemeinsam nach 5s) + laufender DoT-Schaden (Red-Burn/Green-Poison/Amber-Permanent-Burn).
 * Muss vor dem Turm-/Projektil-Update im Combat-Tick laufen. */
export function tickEnemy(enemy: Enemy, dt: number, elapsedSeconds: number) {
  enemy.progress += enemy.baseSpeed * speedFactor(enemy, elapsedSeconds) * dt

  enemy.blueStacks = Math.max(0, enemy.blueStacks - STACK_DECAY_PER_SECOND * dt)
  enemy.redStacks = Math.max(0, enemy.redStacks - STACK_DECAY_PER_SECOND * dt)
  enemy.greenStacks = Math.max(0, enemy.greenStacks - STACK_DECAY_PER_SECOND * dt)

  if (enemy.redStacks > 0) dealDamage(enemy, (enemy.redStacks / TIER2_STACK_MAX) * RED_BURN_MAX_DPS * dt)
  if (enemy.greenStacks > 0) dealDamage(enemy, (enemy.greenStacks / TIER2_STACK_MAX) * GREEN_POISON_MAX_DPS * dt)
  if (enemy.amberStacks > 0) dealDamage(enemy, (enemy.amberStacks / TIER4_HIGH_STACK_MAX) * AMBER_MAX_DPS_FRACTION * enemy.maxHp * dt)

  if (enemy.blackStacksExpireAt <= elapsedSeconds) enemy.blackStacks = 0
}

/** Für die Statuspunkte-Anzeige (siehe render/combatRender.ts): alle aktuell aktiven Effekte mit
 * ihrer Ressourcen-Id und einem Füllstand 0-1 relativ zum jeweiligen Maximalwert. */
export function activeStatusEffects(enemy: Enemy, elapsedSeconds: number): { resourceId: string; fraction: number }[] {
  const list: { resourceId: string; fraction: number }[] = []
  if (enemy.cyanSlowUntil > elapsedSeconds) list.push({ resourceId: 'cyan', fraction: 1 })
  if (enemy.blueStacks > 0) list.push({ resourceId: 'blue', fraction: enemy.blueStacks / TIER2_STACK_MAX })
  if (enemy.redStacks > 0) list.push({ resourceId: 'red', fraction: enemy.redStacks / TIER2_STACK_MAX })
  if (enemy.greenStacks > 0) list.push({ resourceId: 'green', fraction: enemy.greenStacks / TIER2_STACK_MAX })
  if (enemy.ceruleanStacks > 0) list.push({ resourceId: 'cerulean', fraction: enemy.ceruleanStacks / TIER4_LOW_STACK_MAX })
  if (enemy.violetStacks > 0) list.push({ resourceId: 'violet', fraction: enemy.violetStacks / TIER4_LOW_STACK_MAX })
  if (enemy.fuchsiaStacks > 0) list.push({ resourceId: 'fuchsia', fraction: enemy.fuchsiaStacks / TIER4_HIGH_STACK_MAX })
  if (enemy.amberStacks > 0) list.push({ resourceId: 'amber', fraction: enemy.amberStacks / TIER4_HIGH_STACK_MAX })
  if (enemy.chartreuseStacks > 0) list.push({ resourceId: 'chartreuse', fraction: enemy.chartreuseStacks / TIER4_HIGH_STACK_MAX })
  if (enemy.blackStacksExpireAt > elapsedSeconds) list.push({ resourceId: 'black', fraction: Math.min(1, enemy.blackStacks / 10) })
  return list
}

export interface PruneResult {
  remaining: Enemy[]
  killed: Enemy[]
  arrived: Enemy[]
}

/** Trennt gestorbene (hp<=0) und am Ziel angekommene (progress>=1) Gegner heraus. Aufrufer
 * entscheidet, was mit `killed` (Lumen-Belohnung) bzw. `arrived` (aktuell folgenlos) passiert. */
export function pruneEnemies(enemies: Enemy[]): PruneResult {
  const remaining: Enemy[] = []
  const killed: Enemy[] = []
  const arrived: Enemy[] = []
  for (const enemy of enemies) {
    if (enemy.hp <= 0) killed.push(enemy)
    else if (enemy.progress >= 1) arrived.push(enemy)
    else remaining.push(enemy)
  }
  return { remaining, killed, arrived }
}
