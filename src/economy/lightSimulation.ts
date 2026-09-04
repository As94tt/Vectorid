// Kern-Simulation der Licht-Wirtschaft (siehe buildings.ts für das Datenmodell, CLAUDE.md für
// die Gesamt-Erklärung). Berechnet bei Bedarf (main.ts ruft das jeden Frame neu auf, wie zuvor
// computeResourceRates()) den kompletten aktuellen Strahlverlauf aus der Bauwerks-Konfiguration
// — kein zeitbasiertes "Licht reist über mehrere Frames", sondern ein sofortiges Neu-Berechnen
// des stationären Zustands, wie bei einem Puzzle statt einer Physik-Simulation.
//
// Farbsystem V2 (User-Vorgabe): Prismen dürfen ihre Ausgabefarbe jetzt in ein WEITERES Prisma
// einspeisen (keine Rekursions-Sperre mehr, siehe data/resources.ts) — dadurch entsteht die
// Tier-Kette 1->2->3->4->5 (z. B. Teal = Blue + Green, beides selbst Prisma-Ausgaben). Da die
// endgültige Ausgabefarbe eines Prismas von der (evtl. erst in einem SPÄTEREN Prisma
// aufgelösten) Ausgabefarbe eines VORGESCHALTETEN Prismas abhängen kann, wird die komplette
// Strahlverfolgung + Rezept-Auflösung mehrfach hintereinander durchlaufen (Fixpunkt-Iteration):
// jeder Durchlauf lässt alle Lichtquellen UND alle bereits im vorigen Durchlauf aufgelösten
// Prismen gemeinsam strahlen, bis sich nichts mehr ändert.
//
// WICHTIG: Ein einmal aufgelöstes Prisma wird NIE wieder neu bewertet (monotone Sperre), sobald
// es einen Treffer hat. Grund: ein Prisma strahlt seine Ausgabe in seine eine Output-Richtung ab
// — steht es direkt neben einem seiner EIGENEN Eingangs-Prismen (der übliche Aufbau für eine
// Tier-Kette, z. B. Teal direkt neben Blue+Green) und ist zufällig genau darauf ausgerichtet,
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
// Spiegel/Prismen/Container dürfen von beliebig vielen Strahlen gleichzeitig besucht werden (das
// ist ja der Sinn eines Sammelpunkts).

import { RESOURCES, getResource, type ResourceDefinition } from '../data/resources'
import { cellKey, hexNeighbor, inBounds, type GridCoord, type HexDirection, type PlacementGrid } from '../grid/placementGrid'
import { CONTAINER_CAPACITY_BY_LEVEL, reflect, type Container, type EconomyBuilding, type LightColor, type LightSource, type Mirror, type Prism } from './buildings'

const HEX_DIRECTIONS: HexDirection[] = [0, 1, 2, 3, 4, 5]

export interface BeamSegment {
  /** Zellpfad inkl. Startzelle (Quelle bzw. Prisma), in Durchlaufreihenfolge. */
  cells: GridCoord[]
  color: string
  resourceId: string
  /** true, wenn dieser Strahl tatsächlich einen Container oder ein weiteres Prisma erreicht hat
   * (nicht bloß am Rasterrand/der Reichweite/einer Kollision geendet ist) — steuert, ob ein
   * fliegendes Partikel entlang dieses Pfads animiert wird (siehe `drawBeamTraveler()` in
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
  /** Container-Id -> (Ressourcen-Id -> Rate/Sekunde, die dieser Container gerade davon einfängt). */
  containerRates: Map<string, Map<string, number>>
  /** Summe über alle Container je Ressourcen-Id — die "Brutto"-Produktionsrate fürs Inventar. */
  totalRates: Map<string, number>
  /** Lichtquellen-Ids, deren Strahl gerade (direkt oder über Spiegel) mindestens einen
   * Container erreicht — fürs Info-Panel ("liefert gerade" vs. "läuft ins Leere"). */
  activeSourceIds: Set<string>
}

function buildLookup(sources: LightSource[], mirrors: Mirror[], prisms: Prism[], containers: Container[]): Map<string, EconomyBuilding> {
  const map = new Map<string, EconomyBuilding>()
  for (const s of sources) map.set(cellKey(s), s)
  for (const m of mirrors) map.set(cellKey(m), m)
  for (const p of prisms) map.set(cellKey(p), p)
  for (const c of containers) map.set(cellKey(c), c)
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
  rate: number
  isRawSource: boolean
  sourceId?: string
  stepsLeft: number
  alive: boolean
  reachedEndpoint: boolean
  hitPrism?: { prism: Prism; fromDirection: HexDirection }
  hitContainer?: Container
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
function traceAllFronts(grid: PlacementGrid, lookup: Map<string, EconomyBuilding>, fronts: Front[]) {
  const maxSteps = fronts.reduce((max, f) => Math.max(max, f.stepsLeft), 0)

  for (let step = 0; step < maxSteps; step++) {
    const alive = fronts.filter((f) => f.alive)
    if (alive.length === 0) break

    const proposals: { front: Front; current: GridCoord; next: GridCoord; key: string; occupant?: EconomyBuilding }[] = []
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
      if (occupant.kind === 'container') {
        front.cells.push(next)
        front.alive = false
        front.reachedEndpoint = true
        front.hitContainer = occupant
        continue
      }
      if (occupant.kind === 'prism') {
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
  containerRates: Map<string, Map<string, number>>
  activeSourceIds: Set<string>
}

/** Ein kompletter Strahlverfolgungs-Durchlauf: Lichtquellen strahlen immer, bereits aufgelöste
 * Prismen (laut `prismOutputs` aus dem VORIGEN Durchlauf) strahlen zusätzlich ihre Ausgabefarbe. */
function tracePass(
  grid: PlacementGrid,
  lookup: Map<string, EconomyBuilding>,
  sources: LightSource[],
  prisms: Prism[],
  prismOutputs: Map<string, ResourceDefinition | null>,
  emitDirections: Map<string, HexDirection>,
): TracePass {
  const fronts: Front[] = []

  for (const source of sources) {
    for (const dir of HEX_DIRECTIONS) {
      fronts.push({
        cells: [{ col: source.col, row: source.row }],
        direction: dir,
        resourceId: source.resourceId,
        color: getResource(source.resourceId).color,
        rate: source.baseRate,
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
      rate: prism.outputRate,
      isRawSource: false,
      stepsLeft: prism.range,
      alive: true,
      reachedEndpoint: false,
    })
  }

  traceAllFronts(grid, lookup, fronts)

  const segments: BeamSegment[] = []
  const prismCounts = new Map<string, { c: number; m: number; y: number }>()
  const prismColors = new Map<string, Set<string>>()
  const prismSides = new Map<string, Set<HexDirection>>()
  const containerRates = new Map<string, Map<string, number>>()
  const activeSourceIds = new Set<string>()

  function addContainerRate(container: Container, resourceId: string, rate: number) {
    const perResource = containerRates.get(container.id) ?? new Map<string, number>()
    // Kapazität nach Level (siehe buildings.ts CONTAINER_CAPACITY_BY_LEVEL): eine NEUE Farbe, die
    // die Kapazität sprengen würde, wird ignoriert — die zuerst angekommenen Farben "gewinnen"
    // ihren Kapazitäts-Slot dauerhaft, bereits gehaltene Farben werden weiter normal aktualisiert.
    const capacity = CONTAINER_CAPACITY_BY_LEVEL[container.level - 1] ?? CONTAINER_CAPACITY_BY_LEVEL[CONTAINER_CAPACITY_BY_LEVEL.length - 1]
    if (!perResource.has(resourceId) && perResource.size >= capacity) return
    perResource.set(resourceId, (perResource.get(resourceId) ?? 0) + rate)
    containerRates.set(container.id, perResource)
  }

  function registerHit(prism: Prism, travelDirection: HexDirection, resourceId: string, isRawSource: boolean) {
    // `travelDirection` ist die Richtung, in die der Strahl unterwegs war, als er die Zelle
    // erreichte — die tatsächlich berührte Seite des Prismas ist die ENTGEGENGESETZTE Richtung
    // (der Strahl kommt aus dem Nachbarn, der von hier aus in `travelDirection` liegt, also liegt
    // er selbst aus Prisma-Sicht in der Gegenrichtung). Wichtig für die neue Dreieck-Ecken-Regel
    // unten: die muss an der ECHTEN, sichtbaren Seite prüfen, nicht an der Lauf-Richtung.
    const side = oppositeDirection(travelDirection)

    // Beim Dreieck zählt JEDE der 3 Ecken als potenzieller Eingang (welche davon am Ende
    // tatsächlich Output wird, entscheidet sich erst NACH dem Durchlauf, siehe
    // `deriveTriangleOutputDirection()` in simulateLight()) — nur die 3 "Seiten"-Richtungen
    // werden hier schon ausgeschlossen.
    if (prism.prismKind === 'triangle' && !isTriangleCorner(prism.outputDirection, side)) return

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
  }

  for (const front of fronts) {
    if (front.cells.length > 1) {
      segments.push({ cells: front.cells, color: front.color, resourceId: front.resourceId, reachedEndpoint: front.reachedEndpoint })
    }
    if (front.hitPrism) registerHit(front.hitPrism.prism, front.hitPrism.fromDirection, front.resourceId, front.isRawSource)
    if (front.hitContainer) {
      addContainerRate(front.hitContainer, front.resourceId, front.rate)
      if (front.isRawSource && front.sourceId) activeSourceIds.add(front.sourceId)
    }
  }

  return { segments, prismCounts, prismColors, prismSides, containerRates, activeSourceIds }
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

export function simulateLight(grid: PlacementGrid, sources: LightSource[], mirrors: Mirror[], prisms: Prism[], containers: Container[]): SimulationResult {
  const lookup = buildLookup(sources, mirrors, prisms, containers)

  let prismOutputs = new Map<string, ResourceDefinition | null>(prisms.map((p) => [p.id, null]))
  // Effektive Output-Richtung je Prisma — Default = die per Klick gewählte Rotation
  // (`outputDirection`), beim Dreieck ab dem Auflösungs-Durchlauf ggf. durch die automatisch
  // abgeleitete freie Ecke überschrieben (siehe deriveTriangleOutputDirection()) und dann NIE
  // wieder geändert (dieselbe monotone Sperre wie bei `prismOutputs`, siehe Datei-Kommentar).
  let emitDirections = new Map<string, HexDirection>(prisms.map((p) => [p.id, p.outputDirection]))
  let pass = tracePass(grid, lookup, sources, prisms, prismOutputs, emitDirections)

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
    pass = tracePass(grid, lookup, sources, prisms, prismOutputs, emitDirections)
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

  const totalRates = new Map<string, number>()
  for (const perResource of pass.containerRates.values()) {
    for (const [resourceId, rate] of perResource) totalRates.set(resourceId, (totalRates.get(resourceId) ?? 0) + rate)
  }

  return { segments: pass.segments, prismStatus, containerRates: pass.containerRates, totalRates, activeSourceIds: pass.activeSourceIds }
}
