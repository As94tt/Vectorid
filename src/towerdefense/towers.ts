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
}

export const TOWER_DEFINITIONS: TowerDefinition[] = [
  { kind: 'pulse', name: 'Pulse', description: '360° pulses, short range, hits many enemies', cost: 15, range: 90, damage: 8, fireInterval: 1.0 },
  {
    kind: 'rapid',
    name: 'Rapid',
    description: 'Very high fire rate, low damage per hit',
    cost: 20,
    range: 110,
    damage: 3,
    fireInterval: 0.15,
    projectileSpeed: 500,
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
  },
  { kind: 'beam', name: 'Beam', description: 'Permanent laser locked on one target', cost: 60, range: 150, damage: 5, fireInterval: 0.15 },
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
  },
]

export function getTowerDefinition(kind: TowerKind): TowerDefinition {
  const def = TOWER_DEFINITIONS.find((d) => d.kind === kind)
  if (!def) throw new Error(`Unknown tower type: ${kind}`)
  return def
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
    rotation: defaultTowerRotation(kind),
    cooldown: 0,
    lockedTargetId: null,
    charging: false,
    chargeElapsed: 0,
    active: false,
  }
}
