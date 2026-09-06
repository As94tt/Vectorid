// Kern-Simulation der Licht-Wirtschaft (siehe buildings.ts für das Datenmodell, CLAUDE.md für
// die Gesamt-Erklärung). Berechnet bei Bedarf (main.ts ruft das jeden Frame neu auf, wie zuvor
// computeResourceRates()) den kompletten aktuellen Strahlverlauf aus der Bauwerks-Konfiguration
// — kein zeitbasiertes "Licht reist über mehrere Frames", sondern ein sofortiges Neu-Berechnen
// des stationären Zustands, wie bei einem Puzzle statt einer Physik-Simulation.
//
// Farbsystem V2 (User-Vorgabe): Prismen dürfen ihre Ausgabefarbe jetzt in ein WEITERES Prisma
// einspeisen (keine Rekursions-Sperre mehr, siehe data/resources.ts) — dadurch entsteht die
// Tier-Kette 1->2->3->4->5 (z. B. Cerulean = Blue + Green, beides selbst Prisma-Ausgaben). Da die
// endgültige Ausgabefarbe eines Prismas von der (evtl. erst in einem SPÄTEREN Prisma
// aufgelösten) Ausgabefarbe eines VORGESCHALTETEN Prismas abhängen kann, wird die komplette
// Strahlverfolgung + Rezept-Auflösung mehrfach hintereinander durchlaufen (Fixpunkt-Iteration):
// jeder Durchlauf lässt alle Lichtquellen UND alle bereits im vorigen Durchlauf aufgelösten
// Prismen gemeinsam strahlen, bis sich nichts mehr ändert.
//
// WICHTIG: Ein einmal aufgelöstes Prisma wird NIE wieder neu bewertet (monotone Sperre), sobald
// es einen Treffer hat. Grund: ein Prisma strahlt seine Ausgabe in seine eine Output-Richtung ab
// — steht es direkt neben einem seiner EIGENEN Eingangs-Prismen (der übliche Aufbau für eine
// Tier-Kette, z. B. Cerulean direkt neben Blue+Green) und ist zufällig genau darauf ausgerichtet,
// könnte sein Ausgabestrahl in einem SPÄTEREN Durchlauf dessen exaktes Eingangs-Set verfälschen
// (ein 3. Farbsignal killt z. B. den 2-Teile-Treffer von Blue) — ohne Sperre könnte die Auflösung
// dadurch endlos zwischen "aufgelöst"/"nicht aufgelöst" oszillieren, statt sich einzupendeln. Ein
// echter Zirkelbezug in den REZEPTEN selbst ist ausgeschlossen (jedes Rezept in resources.ts
// referenziert nur Farben NIEDRIGEREN Tiers) — die Sperre verhindert nur diese rein geometrische
// Rückkopplung übers Strahl-Rendering.
//
// Zwei grundverschiedene Prisma-Typen (Form = Misch-METHODE):
//   - Dreieck (triangle): exaktes Set von 2 fest benannten Eingangsfarben. GEOMETRISCH
//     eingeschränkt (User-Vorgabe): das Dreieck ist so gedreht, dass seine 3 Ecken auf 3 der 6
//     Hex-Nachbarn zeigen (die dazwischenliegenden 3 Seiten treffen keine Ecke) — ein Strahl, der
//     die Zelle aus einer der 3 "Seiten"-Richtungen erreicht, wird NICHT registriert (siehe
//     `registerHit()`/`isTriangleCorner()`). Die OUTPUT-Richtung ist NICHT mehr fest per Klick
//     gewählt (User-Vorgabe V2): sobald genau 2 der 3 Ecken gerade einen Strahl tragen, wird die
//     3. (freie) Ecke automatisch zum Output (siehe `deriveTriangleOutputDirection()`). `rotate-
//     Prism()` dreht weiterhin `outputDirection` — das legt jetzt nur noch fest, WELCHE 3 der 6
//     Richtungen überhaupt Ecken sind (Anker fürs Dreieck), und dient als Fallback, solange nicht
//     exakt 2 Ecken belegt sind (z. B. direkt nach dem Platzieren, oder falls zufällig alle 3
//     oder nur 1 Ecke anliegt).
//   - Hexagon (hexagon, ersetzt das frühere Fünfeck): exakte rohe Cyan/Magenta/Yellow-Teile-Summe
//     (ignoriert gemischte Farben komplett, siehe hexagonRecipe) ODER ein exaktes Set fest
//     benannter Farben (siehe hexagonNamedRecipe, Sonderfall Black/White) — unverändert alle 5
//     Nicht-Output-Seiten als gültige Eingänge, wie zuvor beim Fünfeck.
// Ein aufgelöstes Prisma strahlt seine Ausgabe NUR NOCH in seine eine dedizierte `outputDirection`
// ab (User-Vorgabe, per Klick drehbar wie ein Spiegel — siehe buildings.ts `rotatePrism()`),
// nicht mehr in alle 6 Richtungen gleichzeitig.
//
// Strahl-Kollision — NUR bei exakt entgegengesetzten Richtungen (User-Vorgabe, ersetzt die
// pauschale "jede geteilte Zelle blockt"-Regel einer früheren Runde): zwei Strahlen dürfen sich
// weiterhin frei KREUZEN (unterschiedliche, nicht-entgegengesetzte Richtungen durch dieselbe
// Zelle) — nur wenn sie exakt frontal aufeinander zulaufen, treffen sie sich in der Mitte der
// gemeinsamen Zelle und stoppen dort beide. Das lässt sich nur erkennen, wenn ALLE Strahlen
// GEMEINSAM Schritt für Schritt vorrücken (statt wie zuvor einer nach dem anderen komplett
// durchgerechnet zu werden) — siehe `traceAllFronts()`. Gilt weiterhin nur für leere Zellen:
// Spiegel/Prismen/Türme dürfen von beliebig vielen Strahlen gleichzeitig besucht werden (das
// ist ja der Sinn eines Sammelpunkts).
//
// Strahl-"Stärke" (User-Vorgabe, ersetzt die frühere feste Rate/Sekunde je Lichtquelle bzw.
// Ausgabe-Rate je Prisma): ein Strahl hat an jeder Zelle die Stärke = wie viele Zellen er von DORT
// aus noch zurücklegen könnte (`Front.stepsLeft`, siehe unten) — ein Level-1-Generator (Reichweite
// 3) liefert an einen 1 Zelle entfernten Turm also Stärke 2, und GENAU das ist dann die Menge, mit
// der dieser Turm gerade "versorgt" ist (siehe main.ts hasAmmoAvailable()). Erreicht ein Strahl
// stattdessen ein Prisma, zählt NUR diese Stärke (nicht Farbe/Rezept) mit in dessen Durchschnitt
// ein (siehe `registerHit()`): kommen mehrere Strahlen an, wird ihre Stärke addiert und durch ihre
// Anzahl geteilt (Standard-Rundung), und GENAU dieser Wert ist dann sowohl die Stärke, mit der das
// Prisma (sobald sein Rezept erfüllt ist) selbst weiterstrahlt, als auch entsprechend viele Zellen
// weit reicht (siehe `prismAvgStrength`/`simulateLight()`) — Prismen haben dafür kein eigenes
// Level mehr (User-Vorgabe, entfernt).
//
// Türme als Strahl-Ziel (User-Vorgabe, ersetzt Container): ein Strahl, der einen Turm erreicht,
// liefert genau wie früher bei einem Container seine Farbe + Stärke dorthin (siehe `hitTower`
// unten) — das IST jetzt die Munition des Turms, keine manuelle Auswahl mehr nötig (siehe
// main.ts). Erreichen MEHRERE, unterschiedlich gefärbte Strahlen denselben Turm im selben
// Durchlauf, gewinnt der zuerst in `fronts` verarbeitete (siehe `tracePass()` — dieselbe stabile
// "erster gewinnt"-Reihenfolge, mit der Container früher ihre Kapazitäts-Slots vergeben haben).
// Anders als ein Dreieck-Prisma nimmt ein Turm einen Strahl aus JEDER der 6 Richtungen an (wie ein
// Hexagon-Prisma) — er hat keine "Seiten", die eine Form vorgeben.
//
// Gegner-Pfad als Strahl-Hindernis (User-Vorgabe: "die Farbverbindungen sollen vom Weg der Enemies
// geblockt werden, nicht andersherum" — der Gegner-Pfad selbst hängt NICHT von Strahlen ab, siehe
// grid/routing.ts): main.ts übergibt die aktuelle Pfad-Zellkette als `enemyPathCells`, jede dieser
// Zellen wirkt wie ein blankes Gebäude — ein Strahl stoppt eine Zelle davor, wirkungslos, kommt
// also nie an einem Prisma/Turm an (siehe `hitPrism`/`hitTower` bleiben unbesetzt). Das gilt AUCH
// für eine Zelle mit Spiegel darauf (User-Vorgabe/Bugfix: "kann keine Farbverbindung in dieses
// Feld rein oder raus, es ist praktisch blockiert") — läuft der Gegner-Pfad gerade durch einen
// Spiegel, blockiert das Licht dort komplett, statt (wie zuvor fälschlich) trotzdem umgelenkt zu
// werden (siehe `buildLookup()`s Einfüge-Reihenfolge). Lichtquellen/Prismen/Türme sind davon
// NICHT betroffen — der Pfad endet ja ohnehin genau auf ihrer eigenen Zelle, die bleibt ihr
// gültiges Licht-Ziel/-Quelle.

import { RESOURCES, getResource, type ResourceDefinition } from '../data/resources'
import { cellKey, hexNeighbor, inBounds, type GridCoord, type HexDirection, type PlacementGrid } from '../grid/placementGrid'
import { reflect, type EconomyBuilding, type LightColor, type LightSource, type Mirror, type Prism } from './buildings'

const HEX_DIRECTIONS: HexDirection[] = [0, 1, 2, 3, 4, 5]

export interface BeamSegment {
  /** Zellpfad inkl. Startzelle (Quelle bzw. Prisma), in Durchlaufreihenfolge. */
  cells: GridCoord[]
  color: string
  resourceId: string
  /** true, wenn dieser Strahl tatsächlich einen Turm oder ein weiteres Prisma erreicht hat (nicht
   * bloß am Rasterrand/der Reichweite/einer Kollision geendet ist) — steuert, ob ein fliegendes
   * Partikel entlang dieses Pfads animiert wird (siehe `drawBeamTraveler()` in
   * render/buildingRender.ts, User-Vorgabe: "Kugel soll entlang der Verbindung fliegen, sofern
   * ein Endpunkt existiert"). */
  reachedEndpoint: boolean
}

export interface PrismStatus {
  /** Fünfeck: rohe Cyan/Magenta/Yellow-Teile-Summe der ankommenden Strahlen (gemischte Farben
   * tragen hier NICHT bei — nur die 3 Grundfarben zählen als "roh"). */
  counts: { c: number; m: number; y: number }
  /** Dreieck: welche Ressourcen-Ids (roh oder gemischt) gerade an irgendeiner Seite ankommen. */
  presentColors: Set<string>
  /** Welche der 6 Seiten gerade mindestens einen ankommenden Strahl tragen (fürs Rendering der
   * "fehlt noch"/"liegt an"-Anschlussstellen). */
  sides: Set<HexDirection>
  output: ResourceDefinition | null
  /** Effektive Output-Richtung fürs Rendering (siehe `drawPrismPorts()`) — bei Dreiecken die
   * automatisch abgeleitete freie Ecke (siehe `deriveTriangleOutputDirection()`), bei Hexagonen
   * unverändert `prism.outputDirection`. */
  outputDirection: HexDirection
}

export interface SimulationResult {
  segments: BeamSegment[]
  /** Prisma-Id -> aktueller Status. */
  prismStatus: Map<string, PrismStatus>
  /** Turm-Id -> die Farbe + Stärke, die ihn gerade (direkt oder über Spiegel/Prismen) erreicht —
   * das IST seine aktuelle Munition (siehe main.ts economyTick()/hasAmmoAvailable()), keine
   * manuelle Auswahl mehr. Kein Eintrag = gerade kein Strahl angeschlossen. */
  towerAmmo: Map<string, { resourceId: string; strength: number }>
  /** Lichtquellen-Ids, deren Strahl gerade (direkt oder über Spiegel) mindestens einen Turm
   * erreicht — fürs Info-Panel ("liefert gerade" vs. "läuft ins Leere"). */
  activeSourceIds: Set<string>
}

/** Occupant-Sicht der Licht-Simulation auf einen Turm — nur die Id, keine Turm-Details nötig (und
 * ausdrücklich NICHT der rohe `PlacedTower`: dessen `.kind` ist `TowerKind` ('pulse'|'sniper'|…),
 * kein generisches `'tower'`-Tag, würde also nie auf den `occupant.kind === 'tower'`-Zweig unten
 * matchen). Nimmt bewusst nur `{id, col, row}` entgegen (siehe `simulateLight()`), damit dieses
 * Economy-Modul nicht von towerdefense/towers.ts abhängen muss. */
interface TowerOccupant {
  kind: 'tower'
  id: string
}
/** Der Gegner-Pfad als Strahl-Hindernis (User-Vorgabe: "die Farbverbindungen sollen vom Weg der
 * Enemies geblockt werden, nicht andersherum") — trägt keine weiteren Daten, nur die Zell-Präsenz
 * zählt. Wird in `buildLookup()` VOR den echten Gebäuden eingetragen, damit ein Gebäude, das
 * zufällig auf einer Pfad-Zelle steht, seinen eigenen (wichtigeren) Occupant-Eintrag behält. */
interface PathOccupant {
  kind: 'path'
}
type LightOccupant = EconomyBuilding | TowerOccupant | PathOccupant

function buildLookup(
  sources: LightSource[],
  mirrors: Mirror[],
  prisms: Prism[],
  towers: { id: string; col: number; row: number }[],
  enemyPathCells: GridCoord[],
): Map<string, LightOccupant> {
  const map = new Map<string, LightOccupant>()
  // User-Vorgabe (Bugfix): "geht der Enemy-Weg durch ein Feld, kann keine Farbverbindung in
  // dieses Feld rein oder raus, es ist praktisch blockiert" — GILT AUCH für ein Feld mit Spiegel
  // darauf (vorher fälschlich ausgenommen: Spiegel wurden NACH den Pfad-Zellen eingetragen und
  // haben sie damit wieder überschrieben, sodass Licht dort trotzdem ungehindert umgelenkt wurde).
  // Reihenfolge jetzt: Spiegel zuerst (niedrigste Priorität) -> Pfad-Zellen überschreiben einen
  // Spiegel auf dem Weg zu einem reinen Blocker -> Gebäude (Quelle/Prisma/Turm) überschreiben
  // eine Pfad-Zelle wieder zurück auf sich selbst (der Pfad endet ja ohnehin GENAU auf ihrer
  // eigenen Zelle, siehe grid/routing.ts traceDefensePath() — die müssen als Licht-Ziel/-Quelle
  // weiter funktionieren, nur Spiegel sollen blockierbar sein).
  for (const m of mirrors) map.set(cellKey(m), m)
  for (const c of enemyPathCells) map.set(cellKey(c), { kind: 'path' })
  for (const s of sources) map.set(cellKey(s), s)
  for (const p of prisms) map.set(cellKey(p), p)
  for (const t of towers) map.set(cellKey(t), { kind: 'tower', id: t.id })
  return map
}

function channelFor(resourceId: LightColor): 'c' | 'm' | 'y' {
  if (resourceId === 'cyan') return 'c'
  if (resourceId === 'magenta') return 'm'
  return 'y'
}

function oppositeDirection(dir: HexDirection): HexDirection {
  return ((dir + 3) % 6) as HexDirection
}

/** Die 3 Richtungen, an denen ein um `anchor` ausgerichtetes Dreieck-Prisma überhaupt eine Ecke
 * hat (anchor selbst + ±2, siehe render/buildingRender.ts für die passende Rotation). */
function triangleCornerDirections(anchor: HexDirection): [HexDirection, HexDirection, HexDirection] {
  return [anchor, ((anchor + 2) % 6) as HexDirection, ((anchor + 4) % 6) as HexDirection]
}

/** Ein gedrehtes Dreieck-Prisma hat nur an 3 der 6 Hex-Richtungen überhaupt eine Ecke (die
 * anderen 3 treffen eine flache Seite, zählen nie als Eingang). */
function isTriangleCorner(anchor: HexDirection, side: HexDirection): boolean {
  return triangleCornerDirections(anchor).includes(side)
}

/** Automatische Output-Wahl (User-Vorgabe): sobald genau 2 der 3 Ecken gerade einen Strahl
 * tragen, wird die 3. (freie) Ecke die Output-Richtung. Sonst (0, 1 oder alle 3 Ecken belegt)
 * bleibt `anchor` (die per Klick gewählte Rotation) als Fallback stehen. */
function deriveTriangleOutputDirection(anchor: HexDirection, hitSides: Set<HexDirection>): HexDirection {
  const corners = triangleCornerDirections(anchor)
  const fed = corners.filter((c) => hitSides.has(c))
  if (fed.length === 2) return corners.find((c) => !fed.includes(c))!
  return anchor
}

/** Ein einzelner, noch laufender Strahl (Lichtquelle oder aufgelöstes Prisma). `cells[0]` ist die
 * Startzelle, jeder weitere Eintrag ein zurückgelegter Schritt — die aktuelle Position ist also
 * immer `cells[cells.length - 1]`. */
interface Front {
  cells: GridCoord[]
  direction: HexDirection
  resourceId: string
  color: string
  isRawSource: boolean
  sourceId?: string
  /** Nur gesetzt bei einem von einem aufgelösten Prisma ausgestrahlten Front (Gegenstück zu
   * `sourceId`) — welches Prisma diesen Strahl abgeschickt hat, fürs transitive "erreicht diese
   * Kette am Ende einen Turm"-Tracking (siehe `simulateLight()` activeSourceIds). */
  prismId?: string
  /** Wie viele weitere Zellen dieser Strahl noch zurücklegen kann — sinkt mit jedem Schritt um 1.
   * Das ist zugleich seine "Stärke" (User-Vorgabe): kommt er bei einem Turm oder Prisma an, ist
   * der dort gerade noch übrige Wert (NACH dem letzten Schritt) genau die Menge, die
   * ankommt/weitergegeben wird — siehe die `hitTower`-Zuweisung in `traceAllFronts()`/`registerHit()`. */
  stepsLeft: number
  alive: boolean
  reachedEndpoint: boolean
  hitPrism?: { prism: Prism; fromDirection: HexDirection }
  hitTower?: { towerId: string; resourceId: string; strength: number }
}

/**
 * Lässt alle Fronten GEMEINSAM Schritt für Schritt vorrücken statt jede einzeln komplett
 * durchzurechnen — nur so lässt sich "zwei entgegenkommende Strahlen treffen sich in der Mitte
 * einer Zelle" korrekt erkennen: dafür müssen beide Strahlen zum exakt gleichen Zeitpunkt an
 * derselben Zelle ankommen, was ein sequenzielles "ein Strahl nach dem anderen" nicht abbilden
 * könnte. Zwei Kollisionsfälle pro Schritt:
 *   1. Zwei Fronten wollen dieselbe LEERE Zelle betreten, aus exakt entgegengesetzten Richtungen
 *      (gerader Abstand zwischen ihnen) -> beide betreten sie noch (das ist die "Mitte", in der
 *      sie sich treffen), dann stoppen beide dort.
 *   2. Zwei Fronten würden ihre jeweils aktuelle Zelle TAUSCHEN (ungerader Abstand, kein
 *      gemeinsames Ziel, aber Ziel_A == Position_B und Ziel_B == Position_A) -> keine von beiden
 *      betritt die andere Seite, beide stoppen an ihrer aktuellen Position (kein exaktes
 *      Zell-Zentrum zum Treffen vorhanden, aber "durcheinander hindurchlaufen" wäre falsch).
 * Alles andere (unterschiedliche, nicht-entgegengesetzte Richtungen durch dieselbe Zelle) kreuzt
 * sich frei, ohne Wechselwirkung.
 */
function traceAllFronts(grid: PlacementGrid, lookup: Map<string, LightOccupant>, fronts: Front[]) {
  const maxSteps = fronts.reduce((max, f) => Math.max(max, f.stepsLeft), 0)

  for (let step = 0; step < maxSteps; step++) {
    const alive = fronts.filter((f) => f.alive)
    if (alive.length === 0) break

    const proposals: { front: Front; current: GridCoord; next: GridCoord; key: string; occupant?: LightOccupant }[] = []
    for (const front of alive) {
      if (front.stepsLeft <= 0) {
        front.alive = false
        continue
      }
      const current = front.cells[front.cells.length - 1]
      const next = hexNeighbor(current, front.direction)
      if (!inBounds(grid, next)) {
        front.alive = false
        continue
      }
      proposals.push({ front, current, next, key: cellKey(next), occupant: lookup.get(cellKey(next)) })
    }

    const stopAfterEntering = new Set<Front>()
    const stopBeforeEntering = new Set<Front>()

    const emptyByTarget = new Map<string, typeof proposals>()
    for (const p of proposals) {
      if (p.occupant) continue
      const list = emptyByTarget.get(p.key) ?? []
      list.push(p)
      emptyByTarget.set(p.key, list)
    }
    for (const list of emptyByTarget.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].front.direction === oppositeDirection(list[j].front.direction)) {
            stopAfterEntering.add(list[i].front)
            stopAfterEntering.add(list[j].front)
          }
        }
      }
    }

    for (let i = 0; i < proposals.length; i++) {
      for (let j = i + 1; j < proposals.length; j++) {
        const a = proposals[i]
        const b = proposals[j]
        if (a.occupant || b.occupant) continue
        if (a.key === cellKey(b.current) && b.key === cellKey(a.current) && a.front.direction === oppositeDirection(b.front.direction)) {
          stopBeforeEntering.add(a.front)
          stopBeforeEntering.add(b.front)
        }
      }
    }

    for (const p of proposals) {
      const { front, next, occupant } = p
      if (stopBeforeEntering.has(front)) {
        front.alive = false
        continue
      }
      front.stepsLeft -= 1
      if (!occupant) {
        front.cells.push(next)
        if (stopAfterEntering.has(front)) front.alive = false
        continue
      }
      if (occupant.kind === 'mirror') {
        front.cells.push(next)
        front.direction = reflect(front.direction, occupant.orientation)
        continue
      }
      if (occupant.kind === 'tower') {
        // Wie ein Hexagon-Prisma (nicht wie ein Dreieck) nimmt ein Turm einen Strahl aus JEDER
        // der 6 Richtungen an — er hat keine "Seiten", die eine Form vorgeben.
        front.cells.push(next)
        front.alive = false
        front.reachedEndpoint = true
        front.hitTower = { towerId: occupant.id, resourceId: front.resourceId, strength: front.stepsLeft }
        continue
      }
      if (occupant.kind === 'path') {
        // Gegner-Pfad blockiert wirkungslos, genau wie ein Gebäude — der Strahl stoppt EINE Zelle
        // davor (kein `front.cells.push(next)`, siehe die anderen Hindernis-Fälle unten).
        front.alive = false
        continue
      }
      if (occupant.kind === 'prism') {
        // Dreieck: nur die 2 Ecken NEBEN dem Output nehmen überhaupt Eingänge an (siehe
        // isTriangleCorner()) — trifft der Strahl stattdessen eine der 3 flachen Seiten, landet er
        // NICHT im Prisma (User-Vorgabe: sichtbar machen, dass er dort nicht ankommt) — er bricht
        // schon in der Zelle DAVOR ab, statt (wie bei einem gültigen Treffer) noch bis ins Prisma
        // selbst zu ziehen. Da Segmente ohnehin nur Zellmittelpunkte verbinden, genügt es, `next`
        // hier NICHT anzuhängen: der Pfad endet dann exakt am Mittelpunkt der letzten Zelle davor.
        const side = oppositeDirection(front.direction)
        if (occupant.prismKind === 'triangle' && !isTriangleCorner(occupant.outputDirection, side)) {
          front.alive = false
          continue
        }
        front.cells.push(next)
        front.alive = false
        front.reachedEndpoint = true
        front.hitPrism = { prism: occupant, fromDirection: front.direction }
        continue
      }
      front.alive = false // sonstiges Hindernis (z. B. eine andere Lichtquelle) blockiert wirkungslos
    }
  }
}

interface TracePass {
  segments: BeamSegment[]
  prismCounts: Map<string, { c: number; m: number; y: number }>
  prismColors: Map<string, Set<string>>
  prismSides: Map<string, Set<HexDirection>>
  /** Gerundeter Durchschnitt der Stärke aller Strahlen, die dieses Prisma in diesem Durchlauf
   * erreicht haben (siehe `registerHit()`) — das ist die Stärke, mit der es selbst (sobald sein
   * Rezept erfüllt ist) im NÄCHSTEN Durchlauf weiterstrahlt (siehe `simulateLight()`). */
  prismAvgStrength: Map<string, number>
  /** Turm-Id -> Farbe + Stärke des ERSTEN Strahls, der ihn in diesem Durchlauf erreicht hat (siehe
   * `simulateLight()`-Dateikommentar zu "erster gewinnt" bei mehrfarbigen Treffern). */
  towerHits: Map<string, { resourceId: string; strength: number }>
  /** Direkt trifft (nicht transitiv) — nur Quellen, deren Strahl SELBST einen Turm erreicht hat. */
  activeSourceIds: Set<string>
  /** Direkt-Eingänge je Prisma in DIESEM Durchlauf — welche rohen Lichtquellen bzw. welche ANDEREN
   * Prismen gerade unmittelbar hineinstrahlen. Da ein einmal aufgelöstes Prisma ab dann in JEDEM
   * weiteren Durchlauf mitstrahlt (monotone Sperre, siehe Datei-Kommentar), ist der LETZTE
   * Durchlauf ein vollständiger, stabiler Schnappschuss des gesamten Netzwerks — `simulateLight()`
   * verfolgt diese Kanten von dort aus rückwärts, um Quellen zu finden, die nur INDIREKT (über
   * eine Prisma-Kette) einen Turm versorgen (siehe activeSourceIds dort, User-Vorgabe: "Lichtquellen,
   * die nur auf ein Prisma zeigen, sollen auch als aktiv gelten"). */
  directSourcesIntoPrism: Map<string, Set<string>>
  directPrismsIntoPrism: Map<string, Set<string>>
  /** Prisma-Ids, deren Ausgabe in DIESEM Durchlauf direkt einen Turm erreicht hat (Gegenstück zu
   * `activeSourceIds` für Prismen statt Quellen). */
  prismsFeedingTower: Set<string>
}

/** Rundet wie vom User vorgegeben: <.5 ab, >.5 auf (= Standard-Rundung). */
function roundStrength(value: number): number {
  return Math.round(value)
}

/** Ein kompletter Strahlverfolgungs-Durchlauf: Lichtquellen strahlen immer, bereits aufgelöste
 * Prismen (laut `prismOutputs` aus dem VORIGEN Durchlauf) strahlen zusätzlich ihre Ausgabefarbe,
 * mit der Stärke, die sie im VORIGEN Durchlauf selbst von ihren Eingangs-Strahlen ermittelt haben
 * (siehe `prismStrengths`/`prismAvgStrength`). */
function tracePass(
  grid: PlacementGrid,
  lookup: Map<string, LightOccupant>,
  sources: LightSource[],
  prisms: Prism[],
  prismOutputs: Map<string, ResourceDefinition | null>,
  emitDirections: Map<string, HexDirection>,
  prismStrengths: Map<string, number>,
): TracePass {
  const fronts: Front[] = []

  for (const source of sources) {
    for (const dir of HEX_DIRECTIONS) {
      fronts.push({
        cells: [{ col: source.col, row: source.row }],
        direction: dir,
        resourceId: source.resourceId,
        color: getResource(source.resourceId).color,
        isRawSource: true,
        sourceId: source.id,
        stepsLeft: source.range,
        alive: true,
        reachedEndpoint: false,
      })
    }
  }

  // Ein aufgelöstes Prisma strahlt nur noch in seine EINE Output-Richtung ab — beim Dreieck die
  // automatisch abgeleitete freie Ecke (siehe `emitDirections`/`deriveTriangleOutputDirection()`),
  // beim Hexagon unverändert `prism.outputDirection` — nicht mehr in alle 6 Richtungen gleichzeitig.
  for (const prism of prisms) {
    const output = prismOutputs.get(prism.id)
    if (!output) continue
    fronts.push({
      cells: [{ col: prism.col, row: prism.row }],
      direction: emitDirections.get(prism.id) ?? prism.outputDirection,
      resourceId: output.id,
      color: output.color,
      isRawSource: false,
      prismId: prism.id,
      stepsLeft: prismStrengths.get(prism.id) ?? 0,
      alive: true,
      reachedEndpoint: false,
    })
  }

  traceAllFronts(grid, lookup, fronts)

  const segments: BeamSegment[] = []
  const prismCounts = new Map<string, { c: number; m: number; y: number }>()
  const prismColors = new Map<string, Set<string>>()
  const prismSides = new Map<string, Set<HexDirection>>()
  const prismStrengthSums = new Map<string, { sum: number; count: number }>()
  const towerHits = new Map<string, { resourceId: string; strength: number }>()
  const activeSourceIds = new Set<string>()
  const directSourcesIntoPrism = new Map<string, Set<string>>()
  const directPrismsIntoPrism = new Map<string, Set<string>>()
  const prismsFeedingTower = new Set<string>()

  function registerHit(prism: Prism, travelDirection: HexDirection, resourceId: string, isRawSource: boolean, strength: number) {
    // `travelDirection` ist die Richtung, in die der Strahl unterwegs war, als er die Zelle
    // erreichte — die tatsächlich berührte Seite des Prismas ist die ENTGEGENGESETZTE Richtung
    // (der Strahl kommt aus dem Nachbarn, der von hier aus in `travelDirection` liegt, also liegt
    // er selbst aus Prisma-Sicht in der Gegenrichtung). Ein Dreieck-Treffer an einer der 3 flachen
    // Seiten erreicht `registerHit()` gar nicht erst — `traceAllFronts()` lässt einen solchen
    // Strahl schon in der Zelle DAVOR abbrechen (siehe dort), hier zählt also immer eine der 3
    // echten Ecken.
    const side = oppositeDirection(travelDirection)

    if (isRawSource) {
      const counts = prismCounts.get(prism.id) ?? { c: 0, m: 0, y: 0 }
      counts[channelFor(resourceId as LightColor)] += 1
      prismCounts.set(prism.id, counts)
    }
    const colors = prismColors.get(prism.id) ?? new Set<string>()
    colors.add(resourceId)
    prismColors.set(prism.id, colors)
    const sides = prismSides.get(prism.id) ?? new Set<HexDirection>()
    sides.add(side)
    prismSides.set(prism.id, sides)
    const strengthAcc = prismStrengthSums.get(prism.id) ?? { sum: 0, count: 0 }
    strengthAcc.sum += strength
    strengthAcc.count += 1
    prismStrengthSums.set(prism.id, strengthAcc)
  }

  for (const front of fronts) {
    if (front.cells.length > 1) {
      segments.push({ cells: front.cells, color: front.color, resourceId: front.resourceId, reachedEndpoint: front.reachedEndpoint })
    }
    if (front.hitPrism) {
      registerHit(front.hitPrism.prism, front.hitPrism.fromDirection, front.resourceId, front.isRawSource, front.stepsLeft)
      const targetPrismId = front.hitPrism.prism.id
      if (front.isRawSource && front.sourceId) {
        const set = directSourcesIntoPrism.get(targetPrismId) ?? new Set<string>()
        set.add(front.sourceId)
        directSourcesIntoPrism.set(targetPrismId, set)
      } else if (front.prismId) {
        const set = directPrismsIntoPrism.get(targetPrismId) ?? new Set<string>()
        set.add(front.prismId)
        directPrismsIntoPrism.set(targetPrismId, set)
      }
    }
    if (front.hitTower) {
      // "Erster gewinnt" (User-Vorgabe): kommt später in dieser Schleife noch ein zweiter,
      // andersfarbiger Strahl an demselben Turm an, wird er ignoriert — die Reihenfolge hier ist
      // stets Quellen (in Array-Reihenfolge, alle 6 Richtungen) dann Prismen (in Array-Reihenfolge),
      // Durchlauf für Durchlauf identisch, also eine stabile, nicht "flackernde" Priorität.
      if (!towerHits.has(front.hitTower.towerId)) {
        towerHits.set(front.hitTower.towerId, { resourceId: front.hitTower.resourceId, strength: front.hitTower.strength })
      }
      if (front.isRawSource && front.sourceId) activeSourceIds.add(front.sourceId)
      else if (front.prismId) prismsFeedingTower.add(front.prismId)
    }
  }

  const prismAvgStrength = new Map<string, number>()
  for (const [prismId, { sum, count }] of prismStrengthSums) {
    if (count > 0) prismAvgStrength.set(prismId, roundStrength(sum / count))
  }

  return {
    segments,
    prismCounts,
    prismColors,
    prismSides,
    prismAvgStrength,
    towerHits,
    activeSourceIds,
    directSourcesIntoPrism,
    directPrismsIntoPrism,
    prismsFeedingTower,
  }
}

function resolveTriangleOutput(presentColors: Set<string>): ResourceDefinition | null {
  if (presentColors.size < 2) return null
  for (const r of RESOURCES) {
    if (!r.triangleRecipe) continue
    if (r.triangleRecipe.length !== presentColors.size) continue
    if (r.triangleRecipe.every((id) => presentColors.has(id))) return r
  }
  return null
}

function resolveHexagonOutput(counts: { c: number; m: number; y: number }, presentColors: Set<string>): ResourceDefinition | null {
  const distinctChannels = [counts.c, counts.m, counts.y].filter((n) => n > 0).length
  if (distinctChannels >= 2) {
    const ratioMatch = RESOURCES.find(
      (r) => r.tier !== 1 && r.hexagonRecipe && r.hexagonRecipe.c === counts.c && r.hexagonRecipe.m === counts.m && r.hexagonRecipe.y === counts.y,
    )
    if (ratioMatch) return ratioMatch
  }
  // Bewusst kein Größenvergleich wie bei resolveTriangleOutput() — ein Dreieck kann geometrisch
  // NIE mehr als 2 Eingänge haben, ein Hexagon aber bis zu 5 (siehe registerHit()). Black/White
  // brauchen nur GENAU 3 bestimmte Farben ANLIEGEND, zusätzliche (z. B. weitere angeschlossene,
  // fürs Rezept irrelevante) Eingänge dürfen das nicht verhindern — sonst würde "bis zu 5
  // Eingänge" für diese beiden Farben faktisch nie mehr als exakt 3 erlauben.
  for (const r of RESOURCES) {
    if (!r.hexagonNamedRecipe) continue
    if (r.hexagonNamedRecipe.every((id) => presentColors.has(id))) return r
  }
  return null
}

export function simulateLight(
  grid: PlacementGrid,
  sources: LightSource[],
  mirrors: Mirror[],
  prisms: Prism[],
  towers: { id: string; col: number; row: number }[],
  enemyPathCells: GridCoord[],
): SimulationResult {
  const lookup = buildLookup(sources, mirrors, prisms, towers, enemyPathCells)

  let prismOutputs = new Map<string, ResourceDefinition | null>(prisms.map((p) => [p.id, null]))
  // Effektive Output-Richtung je Prisma — Default = die per Klick gewählte Rotation
  // (`outputDirection`), beim Dreieck ab dem Auflösungs-Durchlauf ggf. durch die automatisch
  // abgeleitete freie Ecke überschrieben (siehe deriveTriangleOutputDirection()) und dann NIE
  // wieder geändert (dieselbe monotone Sperre wie bei `prismOutputs`, siehe Datei-Kommentar).
  let emitDirections = new Map<string, HexDirection>(prisms.map((p) => [p.id, p.outputDirection]))
  // Stärke, mit der ein aufgelöstes Prisma gerade weiterstrahlt (siehe `tracePass()`/
  // `prismAvgStrength`) — anders als `prismOutputs`/`emitDirections` NICHT gesperrt: wird nach
  // JEDEM Durchlauf frisch aus dessen Treffern übernommen, damit spätere Änderungen an
  // vorgeschalteten Strahlen (z. B. ein geleveltes Generator davor) sich weiter durchreichen.
  let prismStrengths = new Map<string, number>()
  let pass = tracePass(grid, lookup, sources, prisms, prismOutputs, emitDirections, prismStrengths)
  prismStrengths = pass.prismAvgStrength

  // Obergrenze rein aus der Anzahl der Prismen abgeleitet: dank der monotonen Sperre (siehe
  // Datei-Kommentar) muss JEDER Durchlauf, der überhaupt noch etwas ändert, mindestens ein
  // weiteres Prisma neu auflösen — mehr als `prisms.length` solcher Durchläufe kann es also nie
  // geben, unabhängig von der Tier-Tiefe der tatsächlich gebauten Kette.
  const maxPasses = prisms.length + 1
  for (let i = 0; i < maxPasses; i++) {
    let changed = false
    const nextOutputs = new Map(prismOutputs)
    const nextEmitDirections = new Map(emitDirections)
    for (const prism of prisms) {
      if (prismOutputs.get(prism.id)) continue // bereits aufgelöst -> gesperrt, siehe Datei-Kommentar
      const counts = pass.prismCounts.get(prism.id) ?? { c: 0, m: 0, y: 0 }
      const colors = pass.prismColors.get(prism.id) ?? new Set<string>()
      const resolved = prism.prismKind === 'triangle' ? resolveTriangleOutput(colors) : resolveHexagonOutput(counts, colors)
      if (resolved) {
        nextOutputs.set(prism.id, resolved)
        if (prism.prismKind === 'triangle') {
          const hitSides = pass.prismSides.get(prism.id) ?? new Set<HexDirection>()
          nextEmitDirections.set(prism.id, deriveTriangleOutputDirection(prism.outputDirection, hitSides))
        }
        changed = true
      }
    }
    prismOutputs = nextOutputs
    emitDirections = nextEmitDirections
    if (!changed) break
    pass = tracePass(grid, lookup, sources, prisms, prismOutputs, emitDirections, prismStrengths)
    prismStrengths = pass.prismAvgStrength
  }

  const prismStatus = new Map<string, PrismStatus>()
  for (const prism of prisms) {
    prismStatus.set(prism.id, {
      counts: pass.prismCounts.get(prism.id) ?? { c: 0, m: 0, y: 0 },
      presentColors: pass.prismColors.get(prism.id) ?? new Set(),
      sides: pass.prismSides.get(prism.id) ?? new Set(),
      output: prismOutputs.get(prism.id) ?? null,
      outputDirection: emitDirections.get(prism.id) ?? prism.outputDirection,
    })
  }

  // Transitive Aktiv-Markierung (User-Vorgabe: "Lichtquellen, die nur auf ein Prisma zeigen, sollen
  // auch als aktiv gelten") — `pass.activeSourceIds` allein enthält nur Quellen, die SELBST direkt
  // einen Turm treffen; eine Quelle, die nur in ein Prisma einspeist (das seinerseits — evtl. über
  // mehrere weitere Prismen — einen Turm versorgt), fehlte darin bisher komplett. Da `pass` hier der
  // LETZTE Durchlauf ist (stabiler Schnappschuss des gesamten aufgelösten Netzwerks, siehe
  // TracePass-Kommentar), reicht ein einmaliger Rückwärts-Durchlauf von den turm-versorgenden
  // Prismen über die Prisma-Kette bis zu deren jeweiligen Quellen.
  const activeSourceIds = new Set(pass.activeSourceIds)
  const visitedPrisms = new Set<string>()
  const prismQueue = [...pass.prismsFeedingTower]
  while (prismQueue.length > 0) {
    const prismId = prismQueue.pop()!
    if (visitedPrisms.has(prismId)) continue
    visitedPrisms.add(prismId)
    for (const sourceId of pass.directSourcesIntoPrism.get(prismId) ?? []) activeSourceIds.add(sourceId)
    for (const upstreamPrismId of pass.directPrismsIntoPrism.get(prismId) ?? []) prismQueue.push(upstreamPrismId)
  }

  return { segments: pass.segments, prismStatus, towerAmmo: pass.towerHits, activeSourceIds }
}
