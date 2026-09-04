// Economy-Seite: Licht-basiertes Mischsystem (siehe CLAUDE.md, "Licht-Wirtschaft"). Ersetzt das
// frühere automatisch geroutete Generator/Synthesizer/Refiner-Verbindungssystem komplett.
//
// Grundprinzip (User-Vorgabe): Lichtquellen (Cyan/Magenta/Yellow) strahlen in alle 6
// Rasterrichtungen (Hexfeld-Raster, siehe grid/placementGrid.ts). Spiegel lenken Strahlen nur
// um (Richtung, nicht Farbe/Stärke). Prismen prüfen, ob die nötigen Farbsignale an ihren Seiten
// anliegen (kein Prozent-Rechnen) und erzeugen bei Erfüllung eine fest definierte Ausgabefarbe —
// die aber NUR NOCH aus einem einzigen, dedizierten Output-Port abgestrahlt wird (User-Vorgabe,
// seit dieser Runde — vorher alle 6 Richtungen gleichzeitig), per Klick drehbar wie ein Spiegel
// (`rotatePrism()`). Diese Ausgabe DARF (seit Farbsystem V2) auch in ein weiteres Prisma
// eingespeist werden, um so die Tier-Kette 1->2->3->4->5 aufzubauen (siehe data/resources.ts,
// triangleRecipe). Container fangen ankommendes Licht ein und wandeln es in Ressourcen-Rate um.
// Strahlen kollidieren jetzt (User-Vorgabe): zwei Strahlen, die sich dieselbe freie Rasterzelle
// streitig machen, stoppen aneinander (siehe lightSimulation.ts). Die eigentliche Simulation
// (Strahlverlauf, Reflexion, Kollision, Rezept-Abgleich, mehrstufige Ketten-Auflösung) lebt in
// lightSimulation.ts — diese Datei ist nur das Datenmodell.

import type { HexDirection } from '../grid/placementGrid'

export type LightColor = 'cyan' | 'magenta' | 'yellow'

/** 5 Level (User-Vorgabe): erhöht nur die Reichweite (Zellen), nicht die Rate. */
export const GENERATOR_RANGE_BY_LEVEL = [3, 5, 9, 12, 15] as const
export const GENERATOR_MAX_LEVEL = GENERATOR_RANGE_BY_LEVEL.length

export interface LightSource {
  id: string
  kind: 'source'
  col: number
  row: number
  resourceId: LightColor
  /** 1-5, siehe GENERATOR_RANGE_BY_LEVEL — steuert `range`. */
  level: number
  /** Wie viele Zellen der Strahl maximal zurücklegt (inkl. Zellen mit Spiegeln), aus `level` abgeleitet. */
  range: number
  /** Rate/Sekunde, die ein Container erhält, solange er von diesem Strahl (direkt oder über Spiegel) erreicht wird. */
  baseRate: number
}

/** Ein Hexfeld hat 6 Richtungen (0-5, siehe `HexDirection` in grid/placementGrid.ts) statt der
 * früheren 4 — ein Spiegel liegt also auf einer von 3 möglichen Achsen (jede Achse liegt genau
 * zwischen zwei benachbarten Richtungen, z. B. Achse 0 zwischen Richtung 0 und 1), nicht mehr
 * nur 2 wie beim quadratischen Raster. Jede Achse spiegelt alle 6 Richtungen sauber in 3 Paare
 * (siehe `reflect()`) — Klick auf einen Spiegel dreht ihn 0 -> 1 -> 2 -> 0 (`rotateMirror()`).
 * Ändert nur die Richtung, nie Farbe oder Rate des Strahls. */
export type MirrorOrientation = 0 | 1 | 2

export interface Mirror {
  id: string
  kind: 'mirror'
  col: number
  row: number
  orientation: MirrorOrientation
}

/** Dreieck = mischt aus 2 fest benannten ANDEREN Farben (resources.ts: triangleRecipe) — die
 * Eingangsfarben dürfen selbst wieder gemischte Farben sein, dadurch entsteht die Tier-Kette
 * 1->2->3->4->5. Nur an 2 der 6 Rasterrichtungen (den beiden Ecken neben dem Output) nimmt es
 * überhaupt Eingänge an (siehe lightSimulation.ts `isTriangleInputSide()`). Hexagon (ersetzt das
 * frühere Fünfeck) = mischt direkt aus roher Cyan/Magenta/Yellow-Teile-Summe ODER einem exakten
 * Set fest benannter Farben (resources.ts: hexagonRecipe/hexagonNamedRecipe), überspringt dabei
 * ggf. alle Zwischenfarben, und nimmt (unverändert) an allen 5 Nicht-Output-Richtungen Eingänge
 * an. Beide Prisma-Typen können prinzipiell JEDE Farbe erzeugen, für die resources.ts das
 * jeweilige Rezept definiert — die Form ist keine Tier-Obergrenze, sondern nur die Misch-METHODE. */
export type PrismKind = 'triangle' | 'hexagon'

/** 5 Level (User-Vorgabe): erhöht nur die Ausgabe-Rate (als Multiplikator auf die Basis-Rate),
 * nicht die Reichweite. Level 3 (Index 2, Faktor 1) entspricht der bisherigen Basis-Ausgabe. */
export const PRISM_OUTPUT_MULTIPLIER_BY_LEVEL = [0.25, 0.5, 1, 1.5, 2] as const
export const PRISM_MAX_LEVEL = PRISM_OUTPUT_MULTIPLIER_BY_LEVEL.length

export interface Prism {
  id: string
  kind: 'prism'
  col: number
  row: number
  prismKind: PrismKind
  /** Max. gleichzeitig nötige Eingänge (Dreieck: 2, Hexagon: 3) — rein informativ/fürs Rendering. */
  maxParts: number
  /** 1-5, siehe PRISM_OUTPUT_MULTIPLIER_BY_LEVEL — steuert `outputRate`. */
  level: number
  range: number
  /** Rate/Sekunde der erzeugten Farbe, solange das Prisma aktiv (Rezept erfüllt) ist — Basis-Rate
   * (siehe PRISM_SIMPLE_OUTPUT_RATE/PRISM_COMPLEX_OUTPUT_RATE) mal Level-Multiplikator. */
  outputRate: number
  /** Ein Prisma hat IMMER nur einen dedizierten Output (User-Vorgabe) — strahlt seine
   * Ausgabefarbe nur noch in DIESE eine der 6 Rasterrichtungen ab, statt (wie vorher) in alle 6
   * gleichzeitig. Die anderen Seiten bleiben Eingänge. Per Klick drehbar, genau wie ein Spiegel
   * (`rotatePrism()`), zyklisch 0->1->2->3->4->5->0. */
  outputDirection: HexDirection
}

/** 6 Level (User-Vorgabe, EIN Level mehr als die übrigen Bautypen): wie viele UNTERSCHIEDLICHE
 * Farben der Container gleichzeitig annimmt — die erste Farbe, die eine noch freie "Kapazitäts-
 * Zelle" belegt, gewinnt (siehe lightSimulation.ts `addContainerRate()`). */
export const CONTAINER_CAPACITY_BY_LEVEL = [1, 2, 3, 4, 5, 6] as const
export const CONTAINER_MAX_LEVEL = CONTAINER_CAPACITY_BY_LEVEL.length

export interface Container {
  id: string
  kind: 'container'
  col: number
  row: number
  /** 1-6, siehe CONTAINER_CAPACITY_BY_LEVEL. */
  level: number
}

export type EconomyBuilding = LightSource | Mirror | Prism | Container

/** Baukosten in Lumen (Raster-Erweiterung weiterhin in Prisma) — Platzhalter-Werte. */
export const BUILDING_COSTS = {
  source: 10,
  mirror: 5,
  prismSimple: 25,
  prismComplex: 50,
  container: 8,
} as const

/** Level-Up-Kosten in Lumen (Platzhalter-Werte, wie BUILDING_COSTS noch nicht ausbalanciert):
 * steigt linear mit dem ZIEL-Level, damit spätere Level spürbar teurer werden. */
export function generatorUpgradeCost(targetLevel: number): number {
  return BUILDING_COSTS.source * targetLevel
}
export function prismUpgradeCost(prismKind: PrismKind, targetLevel: number): number {
  return (prismKind === 'triangle' ? BUILDING_COSTS.prismSimple : BUILDING_COSTS.prismComplex) * targetLevel * 0.5
}
export function containerUpgradeCost(targetLevel: number): number {
  return BUILDING_COSTS.container * targetLevel
}

const SOURCE_BASE_RATE = 4
const PRISM_RANGE = 6
const PRISM_SIMPLE_OUTPUT_RATE = 2
const PRISM_COMPLEX_OUTPUT_RATE = 3

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

export function createLightSource(col: number, row: number, resourceId: LightColor): LightSource {
  return { id: nextId('source'), kind: 'source', col, row, resourceId, level: 1, range: GENERATOR_RANGE_BY_LEVEL[0], baseRate: SOURCE_BASE_RATE }
}

export function createMirror(col: number, row: number, orientation: MirrorOrientation = 0): Mirror {
  return { id: nextId('mirror'), kind: 'mirror', col, row, orientation }
}

function prismOutputRate(prismKind: PrismKind, level: number): number {
  const base = prismKind === 'triangle' ? PRISM_SIMPLE_OUTPUT_RATE : PRISM_COMPLEX_OUTPUT_RATE
  return base * PRISM_OUTPUT_MULTIPLIER_BY_LEVEL[level - 1]
}

export function createPrism(col: number, row: number, prismKind: PrismKind): Prism {
  const level = 1
  return {
    id: nextId('prism'),
    kind: 'prism',
    col,
    row,
    prismKind,
    maxParts: prismKind === 'triangle' ? 2 : 3,
    level,
    range: PRISM_RANGE,
    outputRate: prismOutputRate(prismKind, level),
    outputDirection: 0,
  }
}

export function createContainer(col: number, row: number): Container {
  return { id: nextId('container'), kind: 'container', col, row, level: 1 }
}

/** Erhöht das Level um 1 (bis zum jeweiligen Maximum) und rechnet die abgeleiteten Felder neu —
 * siehe GENERATOR_RANGE_BY_LEVEL / PRISM_OUTPUT_MULTIPLIER_BY_LEVEL / CONTAINER_CAPACITY_BY_LEVEL. */
export function upgradeLightSource(source: LightSource) {
  if (source.level >= GENERATOR_MAX_LEVEL) return
  source.level += 1
  source.range = GENERATOR_RANGE_BY_LEVEL[source.level - 1]
}

export function upgradePrism(prism: Prism) {
  if (prism.level >= PRISM_MAX_LEVEL) return
  prism.level += 1
  prism.outputRate = prismOutputRate(prism.prismKind, prism.level)
}

export function upgradeContainer(container: Container) {
  if (container.level >= CONTAINER_MAX_LEVEL) return
  container.level += 1
}

/**
 * Spiegelt eine der 6 Richtungen an der Achse eines Spiegels. Achse `orientation` (0/1/2) liegt
 * genau zwischen Richtung `orientation` und `orientation+1` — daraus folgt die Formel
 * `(2*orientation + 1 - direction) mod 6`, die alle 6 Richtungen sauber in 3 Paare spiegelt
 * (keine Richtung bildet sich auf sich selbst ab, anders als bei den 3 "unsauberen" Zwischen-
 * werten 30°/90°/150° zwischen den Achsen — deshalb genau diese 3 Orientierungen gewählt).
 */
export function reflect(direction: HexDirection, orientation: MirrorOrientation): HexDirection {
  return (((2 * orientation + 1 - direction) % 6) + 6) % 6 as HexDirection
}

/** Klick auf einen Spiegel dreht ihn (User-Vorgabe: "in jede Richtung drehen lassen") statt ein
 * Info-Panel zu öffnen — zyklisch durch alle 3 Achsen-Orientierungen. */
export function rotateMirror(mirror: Mirror) {
  mirror.orientation = ((mirror.orientation + 1) % 3) as MirrorOrientation
}

/** Klick auf ein Prisma dreht seinen einzigen Output-Port (User-Vorgabe: "Prismen müssen auch
 * gedreht werden können, wie Spiegel") statt ein Info-Panel zu öffnen — zyklisch durch alle 6
 * Rasterrichtungen, genau wie `rotateMirror()` für Spiegel. */
export function rotatePrism(prism: Prism) {
  prism.outputDirection = ((prism.outputDirection + 1) % 6) as HexDirection
}
