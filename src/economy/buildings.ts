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
  /** Wie viele Zellen der Strahl maximal zurücklegt (inkl. Zellen mit Spiegeln), aus `level`
   * abgeleitet — bestimmt zugleich die "Stärke" (siehe lightSimulation.ts), mit der der Strahl an
   * einem Container oder Prisma ankommt: Stärke = wie viele Zellen er von dort aus noch könnte. */
  range: number
}

/** Ein Hexfeld hat 6 Richtungen (0-5, siehe `HexDirection` in grid/placementGrid.ts), und eine
 * Spiegel-Achse kann in 6 um je 30° versetzten Lagen liegen (User-Vorgabe: alle Richtungen drehbar
 * statt nur 3) — 3 davon liegen genau ZWISCHEN zwei benachbarten Richtungen (die bisherigen
 * "sauberen" 0/1/2, z. B. Achse zwischen Richtung 0 und 1), die anderen 3 liegen genau AUF einer
 * Richtung (die Richtung UND ihr Gegenüber liegen dann exakt auf der Achse). Ein Strahl, der exakt
 * entlang einer solchen Achsen-Richtung ankommt, spiegelt sich auf SICH SELBST — läuft also
 * unverändert weiter, statt umgelenkt zu werden (siehe `reflect()`), was physikalisch korrekt ist
 * (ein Strahl exakt parallel zur Spiegellinie "streift" sie nur). Klick auf einen Spiegel dreht ihn
 * zyklisch 0 -> 1 -> ... -> 5 -> 0 (`rotateMirror()`), abwechselnd zwischen beiden Achsen-Familien.
 * Ändert nur die Richtung, nie Farbe oder Stärke des Strahls. */
export type MirrorOrientation = 0 | 1 | 2 | 3 | 4 | 5

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

/** Prismen haben KEIN Level (User-Vorgabe, entfernt) — ihre Ausgabe-"Stärke" (= wie viele Zellen
 * die Ausgabe noch weiterreicht) ergibt sich stattdessen live jeden Frame aus den ankommenden
 * Strahlen (siehe lightSimulation.ts `registerHit()`/`prismAvgStrength`: Summe der Stärken aller
 * ankommenden Strahlen geteilt durch ihre Anzahl, gerundet). */
export interface Prism {
  id: string
  kind: 'prism'
  col: number
  row: number
  prismKind: PrismKind
  /** Max. gleichzeitig nötige Eingänge (Dreieck: 2, Hexagon: 3) — rein informativ/fürs Rendering. */
  maxParts: number
  /** Hexagon: der dedizierte Output — strahlt seine Ausgabefarbe nur in DIESE eine der 6
   * Rasterrichtungen ab, die anderen 5 Seiten bleiben Eingänge, per Klick drehbar wie ein Spiegel
   * (`rotatePrism()`), zyklisch 0->1->2->3->4->5->0.
   * Dreieck: dient nur noch als ROTATIONS-ANKER (legt fest, welche 3 der 6 Richtungen überhaupt
   * Ecken sind, siehe lightSimulation.ts `triangleCornerDirections()`) — die tatsächliche Output-
   * Ecke wird automatisch aus den 2 aktuell belegten Eingangs-Ecken abgeleitet (siehe dort
   * `deriveTriangleOutputDirection()`), Klick dreht hier also nur den Anker, nicht mehr direkt
   * den Output. */
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
export function containerUpgradeCost(targetLevel: number): number {
  return BUILDING_COSTS.container * targetLevel
}

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

export function createLightSource(col: number, row: number, resourceId: LightColor): LightSource {
  return { id: nextId('source'), kind: 'source', col, row, resourceId, level: 1, range: GENERATOR_RANGE_BY_LEVEL[0] }
}

export function createMirror(col: number, row: number, orientation: MirrorOrientation = 0): Mirror {
  return { id: nextId('mirror'), kind: 'mirror', col, row, orientation }
}

export function createPrism(col: number, row: number, prismKind: PrismKind): Prism {
  return {
    id: nextId('prism'),
    kind: 'prism',
    col,
    row,
    prismKind,
    maxParts: prismKind === 'triangle' ? 2 : 3,
    outputDirection: 0,
  }
}

export function createContainer(col: number, row: number): Container {
  return { id: nextId('container'), kind: 'container', col, row, level: 1 }
}

/** Erhöht das Level um 1 (bis zum jeweiligen Maximum) und rechnet die abgeleiteten Felder neu —
 * siehe GENERATOR_RANGE_BY_LEVEL / CONTAINER_CAPACITY_BY_LEVEL. */
export function upgradeLightSource(source: LightSource) {
  if (source.level >= GENERATOR_MAX_LEVEL) return
  source.level += 1
  source.range = GENERATOR_RANGE_BY_LEVEL[source.level - 1]
}

export function upgradeContainer(container: Container) {
  if (container.level >= CONTAINER_MAX_LEVEL) return
  container.level += 1
}

/**
 * Spiegelt eine der 6 Richtungen an der Achse eines Spiegels. Eine Achse liegt (in Vielfachen von
 * 30°) bei `orientation/2` — für gerade `orientation` (0/2/4) exakt AUF einer Richtung, für
 * ungerade (1/3/5) genau ZWISCHEN zwei Richtungen (das sind die bisherigen 3 Orientierungen, siehe
 * MirrorOrientation-Kommentar). Allgemeine Formel für Reflexion an einer Achse bei Winkel `t`
 * (in 60°-Schritten): `(2t - direction) mod 6`; mit `t = orientation/2` wird daraus exakt
 * `(orientation - direction) mod 6` — für gerade `orientation` bildet eine zur Achse parallele
 * Richtung (`direction === orientation` oder `direction === orientation+3`) sich dabei auf SICH
 * SELBST ab (Strahl läuft unverändert weiter, siehe Datei-Kommentar oben), für ungerade
 * `orientation` bildet sich (wie bisher) nie eine Richtung auf sich selbst ab.
 */
export function reflect(direction: HexDirection, orientation: MirrorOrientation): HexDirection {
  return (((orientation - direction) % 6) + 6) % 6 as HexDirection
}

/** Klick auf einen Spiegel dreht ihn (User-Vorgabe: "in alle Richtungen drehen lassen, nicht nur
 * 3") statt ein Info-Panel zu öffnen — zyklisch durch alle 6 Achsen-Orientierungen. */
export function rotateMirror(mirror: Mirror) {
  mirror.orientation = ((mirror.orientation + 1) % 6) as MirrorOrientation
}

/** Klick auf ein Prisma dreht seinen einzigen Output-Port (User-Vorgabe: "Prismen müssen auch
 * gedreht werden können, wie Spiegel") statt ein Info-Panel zu öffnen — zyklisch durch alle 6
 * Rasterrichtungen, genau wie `rotateMirror()` für Spiegel. */
export function rotatePrism(prism: Prism) {
  prism.outputDirection = ((prism.outputDirection + 1) % 6) as HexDirection
}
