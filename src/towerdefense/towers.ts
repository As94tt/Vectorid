// Acht Turmtypen, je durch ihre Form die Schussmechanik repräsentierend (Form = Bedeutung,
// siehe CLAUDE.md). Nach dem Bau ist ein Turm farblos (Munitionstyp noch nicht gewählt) —
// der Spieler wählt anschließend eine Ressourcenfarbe als Munition (siehe Farbwheel-Panel,
// Auswahl-Modus). Kampf-/Schadenslogik ist noch nicht implementiert, nur Datenmodell + Optik.

export type TowerKind = 'pulse' | 'sniper' | 'cannon' | 'multishot' | 'rapid' | 'flamethrower' | 'beam' | 'burst'

export interface TowerDefinition {
  kind: TowerKind
  name: string
  description: string
  /** Kosten in Lumen — Platzhalter-Werte, noch nicht ausbalanciert. */
  cost: number
  /** Reichweite in Pixeln. */
  range: number
  /** Schaden pro Treffer (bzw. pro Tick bei Flamethrower/Beam) — Platzhalter, unausbalanciert. */
  damage: number
  /** Sekunden zwischen zwei Schüssen (bzw. Tick-Rate bei Flamethrower/Beam). */
  fireInterval: number
  /** Nur Projektil-Türme (Rapid/Cannon/Multishot/Sniper/Burst): Pixel/Sekunde. */
  projectileSpeed?: number
  /** Nur Cannon: Radius, in dem beim Einschlag zusätzlich Schaden verteilt wird. */
  splashRadius?: number
  /** Nur Multishot: wie viele unterschiedliche Ziele gleichzeitig beschossen werden. */
  projectileCount?: number
  /** Nur Flamethrower: Öffnungswinkel des Kegels in Grad. */
  coneAngle?: number
  /** Nur Burst: Ladezeit in Sekunden, bevor die Salve abgefeuert wird. */
  chargeTime?: number
  /** Nur Burst: wie viele Projektile eine Salve auf einmal abfeuert. */
  volleyCount?: number
  /** Einheiten/Sekunde der zugewiesenen Munitionsfarbe, die dieser Turm braucht, um "versorgt" zu
   * bleiben (siehe main.ts hasAmmoAvailable() — ersetzt den früheren globalen TOWER_AMMO_DRAIN).
   * Platzhalter-Werte, grob an Feuerrate/Schaden orientiert, noch nicht ausbalanciert. */
  consumption: number
}

export const TOWER_DEFINITIONS: TowerDefinition[] = [
  { kind: 'pulse', name: 'Pulse', description: '360° pulses, short range, hits many enemies', cost: 15, range: 90, damage: 8, fireInterval: 1.0, consumption: 1 },
  {
    kind: 'rapid',
    name: 'Rapid',
    description: 'Very high fire rate, low damage per hit',
    cost: 20,
    range: 110,
    damage: 3,
    fireInterval: 0.15,
    projectileSpeed: 500,
    consumption: 2,
  },
  {
    kind: 'cannon',
    name: 'Cannon',
    description: 'Slow projectiles, area damage',
    cost: 25,
    range: 130,
    damage: 16,
    fireInterval: 1.4,
    projectileSpeed: 180,
    splashRadius: 42,
    consumption: 1.5,
  },
  {
    kind: 'multishot',
    name: 'Multishot',
    description: 'Fires multiple projectiles at once',
    cost: 35,
    range: 120,
    damage: 6,
    fireInterval: 0.9,
    projectileSpeed: 420,
    projectileCount: 3,
    consumption: 2,
  },
  {
    kind: 'sniper',
    name: 'Sniper',
    description: 'Slow, long range, high single-target damage',
    cost: 40,
    range: 230,
    damage: 34,
    fireInterval: 2.2,
    projectileSpeed: 900,
    consumption: 1.5,
  },
  {
    kind: 'flamethrower',
    name: 'Flamethrower',
    description: 'Continuous cone-shaped stream',
    cost: 45,
    range: 75,
    damage: 4,
    fireInterval: 0.15,
    coneAngle: 55,
    consumption: 2.5,
  },
  { kind: 'beam', name: 'Beam', description: 'Permanent laser locked on one target', cost: 60, range: 150, damage: 5, fireInterval: 0.15, consumption: 2.5 },
  {
    kind: 'burst',
    name: 'Burst',
    description: 'Charges up, then fires powerful volleys',
    cost: 70,
    range: 140,
    damage: 9,
    fireInterval: 2.0,
    projectileSpeed: 480,
    chargeTime: 1.6,
    volleyCount: 5,
    consumption: 2,
  },
]

/** Identität einer "Konfiguration" (Turmart + Munitionsfarbe) für die Schadens-Übersicht (siehe
 * main.ts drawTowerLoadoutSummary()/towerdefense/combat.ts treatHit()) — mehrere Türme derselben
 * Art UND Farbe zählen als EINE Zeile mit gemeinsamem Schadens-Topf, unabhängig von Level oder
 * Position. */
export function loadoutKey(kind: TowerKind, resourceId: string): string {
  return `${kind}|${resourceId}`
}

export function getTowerDefinition(kind: TowerKind): TowerDefinition {
  const def = TOWER_DEFINITIONS.find((d) => d.kind === kind)
  if (!def) throw new Error(`Unknown tower type: ${kind}`)
  return def
}

/** 1-50 (User-Vorgabe, deutlich mehr als die 5 Level der Economy-Gebäude). Exakte Kurve ist
 * bewusst ein Platzhalter (User: "Zahlen werden später angepasst") — isoliert hier in EINER
 * Stelle, damit sich die Balance später ändern lässt, ohne Aufrufer anzufassen. */
export const TOWER_MAX_LEVEL = 50
const TOWER_LEVEL_STAT_MULTIPLIER = (level: number) => 1 + (level - 1) * 0.06 // ~3.94x bei Level 50

export function towerUpgradeCost(def: TowerDefinition, targetLevel: number): number {
  return Math.round(def.cost * 0.5 * targetLevel)
}

/** Alle numerischen Kampf-/Verbrauchswerte eines Turms, multipliziert mit seiner Level-Kurve —
 * wie `getTowerDefinition()` immer live berechnet, nichts wird auf `PlacedTower` gespeichert. */
export interface EffectiveTowerStats {
  damage: number
  range: number
  fireInterval: number
  projectileSpeed?: number
  splashRadius?: number
  consumption: number
}

export function getEffectiveTowerStats(tower: PlacedTower): EffectiveTowerStats {
  const def = getTowerDefinition(tower.kind)
  const mult = TOWER_LEVEL_STAT_MULTIPLIER(tower.level)
  return {
    damage: def.damage * mult,
    range: def.range * mult,
    // Feuerrate soll mit dem Level SCHNELLER werden, nicht langsamer -> Intervall durch den
    // Multiplikator TEILEN statt multiplizieren.
    fireInterval: def.fireInterval / mult,
    projectileSpeed: def.projectileSpeed !== undefined ? def.projectileSpeed * mult : undefined,
    splashRadius: def.splashRadius !== undefined ? def.splashRadius * mult : undefined,
    consumption: def.consumption * mult,
  }
}

export interface PlacedTower {
  id: string
  kind: TowerKind
  /** Knotenpunkt auf dem Defense-Raster (siehe grid/placementGrid.ts) — Türme stehen NUR auf
   * Knoten, nicht frei im Feld, damit der Gegner-Pfad sauber um sie herum geroutet werden kann. */
  col: number
  row: number
  /** Munitionstyp (Ressourcen-Id) — null solange noch nicht gewählt. */
  resourceId: string | null
  /** 1-50, siehe TOWER_MAX_LEVEL/getEffectiveTowerStats(). */
  level: number
  /** Aktuelle Blickrichtung in Radiant (Canvas-Konvention, 0 = Osten) — fürs Rendering, wird
   * beim Zielen kontinuierlich nachgeführt (siehe towerdefense/combat.ts). */
  rotation: number
  /** Sekunden bis zum nächsten Schuss/Tick. */
  cooldown: number
  /** Nur Beam: Id des aktuell verriegelten Ziels, solange es lebt und in Reichweite bleibt. */
  lockedTargetId: string | null
  /** Nur Burst: lädt gerade auf. */
  charging: boolean
  /** Nur Burst: verstrichene Ladezeit in Sekunden. */
  chargeElapsed: number
  /** Nur Flamethrower/Beam: feuert gerade aktiv auf ein Ziel (fürs Rendern von Kegel/Laser-Linie
   * — die sollen nur sichtbar sein, solange tatsächlich ein Ziel in Reichweite ist). */
  active: boolean
}

/** Basis-Rotation je Form, BEVOR ein Ziel anvisiert wird — bei den meisten Formen 0 (Standard-
 * Ausrichtung reicht, Identität bleibt bei jeder Drehung erkennbar), außer bei Beam: die Raute
 * ist nur als "um 45° gedrehtes Quadrat" (siehe render/towerRender.ts) als Raute erkennbar, muss
 * also auch im Ruhezustand (noch kein Ziel in Reichweite) diese Neigung behalten. */
export function defaultTowerRotation(kind: TowerKind): number {
  return kind === 'beam' ? Math.PI / 4 : 0
}

export function createTower(id: string, kind: TowerKind, col: number, row: number): PlacedTower {
  return {
    id,
    kind,
    col,
    row,
    resourceId: null,
    level: 1,
    rotation: defaultTowerRotation(kind),
    cooldown: 0,
    lockedTargetId: null,
    charging: false,
    chargeElapsed: 0,
    active: false,
  }
}
