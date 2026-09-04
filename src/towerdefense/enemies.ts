// Gegner-Datenmodell + reine Zustands-Logik (Bewegung, Farb-Effekte, Schaden). Kein Rendering
// hier — siehe render/combatRender.ts. Position wird NICHT gespeichert, sondern bei Bedarf aus
// `progress` über getPointAtProgress() abgeleitet (siehe towerdefense/path.ts).
//
// Kern-Mechanik: JEDE der 14 Kampf-Farben (Tier 1-5, Lumen/Prisma ausgenommen) hat ihren EIGENEN,
// festen Effekt, der bei einem Treffer direkt angewendet wird (siehe ammoEffects.ts für die
// Anwendungs-Logik je Farbe, exakt nach den Referenzbildern Assets/ColorEffects.png). Die meisten
// Effekte sammeln dafür Stacks auf dem Gegner, die hier als Felder + Verfalls-/Tick-Logik leben.
//
// Alle konkreten Zahlenwerte (max. DPS, Slow-Stärke, Radien, Bonusschaden, ...) sind — wie überall
// in diesem Projekt — Platzhalter-Balancing.

/** Tier-2-Stacks (Blue/Red/Green): 0 bis MAX, verlieren automatisch 1 Stack/Sekunde. */
export const TIER2_STACK_MAX = 10
export const STACK_DECAY_PER_SECOND = 1

export const RED_BURN_MAX_DPS = 5 // bei TIER2_STACK_MAX Stacks
export const GREEN_POISON_MAX_DPS = 6 // bei TIER2_STACK_MAX Stacks

/** Cerulean (Freeze): 0-30, kein Verfall vor Auslösung, danach zurückgesetzt. */
export const CERULEAN_STACK_MAX = 30
export const CERULEAN_FREEZE_DURATION = 1

/** Violet (Vulnerability): 0-100, permanent (kein Verfall). */
export const VIOLET_STACK_MAX = 100
export const VIOLET_MAX_VULNERABILITY = 0.1 // +10% erlittener Schaden bei VIOLET_STACK_MAX Stacks

/** Chartreuse (Stack Spread): kein eigener Stack-Pool — spreadet stattdessen bis zu
 * CHARTREUSE_SPREAD_FRACTION der VORHANDENEN Cerulean-/Violet-Stacks (Tier 3) des Ziels auf
 * Gegner in der Nähe. Spread-Kopien dürfen nicht noch einmal weiterverbreitet werden (siehe
 * `tier3SpreadBlock`), das verhindert eine Kettenreaktion. */
export const CHARTREUSE_SPREAD_RADIUS = 70
export const CHARTREUSE_SPREAD_FRACTION = 0.5

/** Aquamarine (Pull): kein Stack — zieht Gegner in der Nähe pro Treffer ein Stück Richtung
 * Trefferpunkt (als Fortschritts-Angleichung entlang des Pfads, da Positionen nur über
 * `progress` existieren), sodass sie sich mit der Zeit zusammenballen. */
export const AQUAMARINE_PULL_RADIUS = 70
export const AQUAMARINE_PULL_STRENGTH = 0.12 // Anteil des Fortschritts-Abstands, der pro Treffer aufgeholt wird

/** Fuchsia (Scaling Chain Lightning): 0-100, permanent — mehr Stacks = mehr Sprünge. */
export const FUCHSIA_STACK_MAX = 100
export const FUCHSIA_MAX_JUMPS = 10 // bei FUCHSIA_STACK_MAX Stacks
export const CHAIN_LIGHTNING_RADIUS = 70

/** Amber (Explosion): 0-30, kein Verfall vor Auslösung, danach zurückgesetzt. */
export const AMBER_STACK_MAX = 30
export const AMBER_EXPLOSION_DAMAGE_FRACTION = 0.03 // 3% der maximalen Lebenspunkte des auslösenden Gegners
export const AMBER_EXPLOSION_RADIUS = 60

export const YELLOW_CHAIN_JUMPS = 3

export const MAGENTA_BONUS_DAMAGE = 2
export const CYAN_SLOW_DURATION = 1 // Sekunden, pro Treffer erneuert
export const CYAN_SLOW_REDUCTION = 0.15 // deutlich schwächer als Blues Maximalwert
export const BLUE_MAX_SLOW_REDUCTION = 0.5 // bei TIER2_STACK_MAX Blue-Stacks

/** Black (Execute): jeder Stack = 0.1 Prozentpunkte Execute-Schwelle, alle Stacks verfallen
 * gemeinsam 5s nach dem letzten Treffer (nicht einzeln pro Sekunde wie bei Tier 2). */
export const BLACK_STACK_DURATION = 5
export const BLACK_THRESHOLD_PER_STACK = 0.001 // 0.1 Prozentpunkte als Bruchteil (0-1)

/** White (Purge Burst): verzehrt sofort ALLE vorhandenen Farb-Stacks des Ziels (siehe
 * applyWhite() in ammoEffects.ts) und wandelt sie in einen einmaligen Schadens-Burst um — kein
 * eigener Stack-Pool, kein Verfall, wirkt instant bei Treffer. */
export const WHITE_PURGE_FRACTION_PER_POOL = 0.05 // % max. HP pro voll gefülltem, verzehrtem Stack-Pool

export type Tier3StackKey = 'cerulean' | 'violet'

export interface Enemy {
  id: string
  hp: number
  maxHp: number
  /** Rüstung als Anteil abgezogenen Schadens (0-1), Platzhalter-Balancing. */
  armor: number
  /** 0 (Spawn) bis 1 (Ziel erreicht), Position wird daraus abgeleitet. */
  progress: number
  /** Pixel/Sekunde ohne Verlangsamung (User-Vorgabe: feste, von der Weglänge UNABHÄNGIGE
   * Geschwindigkeit — siehe `tickEnemy()`, das daraus je nach aktueller Pfadlänge den passenden
   * `progress`-Zuwachs pro Frame berechnet, statt `progress` direkt in fixen Bruchteilen/Sekunde
   * zu erhöhen wie zuvor). */
  baseSpeed: number
  /** Render-Radius in Pixeln (siehe render/combatRender.ts) — Bosse (siehe towerdefense/
   * waves.ts) sind deutlich größer als normale Gegner. */
  size: number
  /** Boss-Welle (siehe waves.ts BOSS_WAVE_INTERVAL) — steuert Rendering (Warn-Ring) und
   * Lumen-Belohnung (siehe main.ts). */
  isBoss: boolean

  // Tier 1 — kein Stack, nur ein kurzzeitiger Effekt-Zeitstempel (Cyan).
  cyanSlowUntil: number

  // Tier 2 — 0-10, verlieren automatisch 1 Stack/Sekunde (siehe STACK_DECAY_PER_SECOND).
  blueStacks: number
  redStacks: number
  greenStacks: number

  // Tier 3
  ceruleanStacks: number // 0-30, Freeze-Trigger
  frozenUntil: number
  violetStacks: number // 0-100, permanent (Vulnerability)
  /** Welche Tier-3-Stack-Typen dieser Gegner per Chartreuse-Spread EMPFANGEN hat — die dürfen
   * nicht noch einmal weiterverbreitet werden (verhindert eine Kettenreaktion). */
  tier3SpreadBlock: Set<Tier3StackKey>

  // Tier 4
  fuchsiaStacks: number // 0-100, permanent (Scaling Chain Lightning)
  amberStacks: number // 0-30, Explosions-Trigger

  // Tier 5 — Black: Stacks verfallen gemeinsam BLACK_STACK_DURATION Sekunden nach dem letzten
  // Treffer. White hat keinen eigenen Stack-Pool (siehe WHITE_PURGE_FRACTION_PER_POOL).
  blackStacks: number
  blackStacksExpireAt: number
}

export const ENEMY_BASE_SIZE = 9

export interface CreateEnemyOptions {
  hp?: number
  baseSpeed?: number
  armor?: number
  size?: number
  isBoss?: boolean
}

let enemyCounter = 0
export function createEnemy(options: CreateEnemyOptions = {}): Enemy {
  const { hp = 30, baseSpeed = 28, armor = 0.1, size = ENEMY_BASE_SIZE, isBoss = false } = options
  enemyCounter += 1
  return {
    id: `enemy-${enemyCounter}`,
    hp,
    maxHp: hp,
    armor,
    progress: 0,
    baseSpeed,
    size,
    isBoss,
    cyanSlowUntil: 0,
    blueStacks: 0,
    redStacks: 0,
    greenStacks: 0,
    ceruleanStacks: 0,
    frozenUntil: 0,
    violetStacks: 0,
    tier3SpreadBlock: new Set(),
    fuchsiaStacks: 0,
    amberStacks: 0,
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

/** Wendet Schaden an — gemindert durch Rüstung, verstärkt durch Violets Vulnerability (gilt für
 * ALLE Schadensquellen, siehe ColorEffects.png: "Increases damage taken"). */
export function dealDamage(enemy: Enemy, rawDamage: number) {
  const vulnerability = 1 + (enemy.violetStacks / VIOLET_STACK_MAX) * VIOLET_MAX_VULNERABILITY
  enemy.hp -= rawDamage * (1 - enemy.armor) * vulnerability
}

/** Pro Frame: Bewegung (abzüglich Slow/Freeze) + Stack-Verfall (Blue/Red/Green je 1/Sekunde,
 * Black gemeinsam nach 5s) + laufender DoT-Schaden (Red-Burn/Green-Poison). `pathLengthPixels`
 * (siehe towerdefense/path.ts `pathTotalLength()`) rechnet die feste Pixel/Sekunde-Geschwindigkeit
 * in den richtigen `progress`-Zuwachs für den AKTUELLEN Pfad um — dieselbe reale Geschwindigkeit
 * ergibt auf einem längeren Pfad also einen kleineren Fortschritts-Zuwachs pro Sekunde (User-
 * Vorgabe: Geschwindigkeit darf nicht von der Weglänge abhängen). */
export function tickEnemy(enemy: Enemy, dt: number, elapsedSeconds: number, pathLengthPixels: number) {
  if (pathLengthPixels > 0) {
    enemy.progress += ((enemy.baseSpeed * speedFactor(enemy, elapsedSeconds) * dt) / pathLengthPixels)
  }

  enemy.blueStacks = Math.max(0, enemy.blueStacks - STACK_DECAY_PER_SECOND * dt)
  enemy.redStacks = Math.max(0, enemy.redStacks - STACK_DECAY_PER_SECOND * dt)
  enemy.greenStacks = Math.max(0, enemy.greenStacks - STACK_DECAY_PER_SECOND * dt)

  if (enemy.redStacks > 0) dealDamage(enemy, (enemy.redStacks / TIER2_STACK_MAX) * RED_BURN_MAX_DPS * dt)
  if (enemy.greenStacks > 0) dealDamage(enemy, (enemy.greenStacks / TIER2_STACK_MAX) * GREEN_POISON_MAX_DPS * dt)

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
  if (enemy.ceruleanStacks > 0) list.push({ resourceId: 'cerulean', fraction: enemy.ceruleanStacks / CERULEAN_STACK_MAX })
  if (enemy.violetStacks > 0) list.push({ resourceId: 'violet', fraction: enemy.violetStacks / VIOLET_STACK_MAX })
  if (enemy.fuchsiaStacks > 0) list.push({ resourceId: 'fuchsia', fraction: enemy.fuchsiaStacks / FUCHSIA_STACK_MAX })
  if (enemy.amberStacks > 0) list.push({ resourceId: 'amber', fraction: enemy.amberStacks / AMBER_STACK_MAX })
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
