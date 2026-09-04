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
// Zwei grundverschiedene Prisma-Typen (Form = Misch-METHODE, keine Tier-Obergrenze mehr):
//   - Dreieck (triangle): exaktes Set von 2 (Brown: 3) fest benannten Eingangsfarben.
//   - Fünfeck (pentagon): exakte rohe Cyan/Magenta/Yellow-Teile-Summe (ignoriert gemischte
//     Farben komplett) — außer beim Sonderfall Black, der stattdessen 4 unterschiedliche
//     Tier-4-Farben braucht (siehe resources.ts: pentagonSpecial).
// Ein aufgelöstes Prisma strahlt seine Ausgabe NUR NOCH in seine eine dedizierte `outputDirection`
// ab (User-Vorgabe, per Klick drehbar wie ein Spiegel — siehe buildings.ts `rotatePrism()`),
// nicht mehr in alle 6 Richtungen gleichzeitig. Die übrigen 5 Seiten bleiben normale Eingänge.
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
import { reflect, type Container, type EconomyBuilding, type LightColor, type LightSource, type Mirror, type Prism } from './buildings'

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

  // Ein aufgelöstes Prisma strahlt nur noch in seine EINE dedizierte outputDirection (User-
  // Vorgabe, per Klick drehbar wie ein Spiegel) — nicht mehr in alle 6 Richtungen gleichzeitig.
  for (const prism of prisms) {
    const output = prismOutputs.get(prism.id)
    if (!output) continue
    fronts.push({
      cells: [{ col: prism.col, row: prism.row }],
      direction: prism.outputDirection,
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
    perResource.set(resourceId, (perResource.get(resourceId) ?? 0) + rate)
    containerRates.set(container.id, perResource)
  }

  function registerHit(prism: Prism, fromDirection: HexDirection, resourceId: string, isRawSource: boolean) {
    if (isRawSource) {
      const counts = prismCounts.get(prism.id) ?? { c: 0, m: 0, y: 0 }
      counts[channelFor(resourceId as LightColor)] += 1
      prismCounts.set(prism.id, counts)
    }
    const colors = prismColors.get(prism.id) ?? new Set<string>()
    colors.add(resourceId)
    prismColors.set(prism.id, colors)
    const sides = prismSides.get(prism.id) ?? new Set<HexDirection>()
    sides.add(fromDirection)
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

function resolvePentagonOutput(counts: { c: number; m: number; y: number }, presentColors: Set<string>): ResourceDefinition | null {
  const distinctChannels = [counts.c, counts.m, counts.y].filter((n) => n > 0).length
  if (distinctChannels >= 2) {
    const ratioMatch = RESOURCES.find(
      (r) => r.tier !== 1 && r.pentagonRecipe && r.pentagonRecipe.c === counts.c && r.pentagonRecipe.m === counts.m && r.pentagonRecipe.y === counts.y,
    )
    if (ratioMatch) return ratioMatch
  }
  const special = RESOURCES.find((r) => r.pentagonSpecial)
  if (special?.pentagonSpecial) {
    const { tier, count } = special.pentagonSpecial
    const matchingCount = [...presentColors].filter((id) => getResource(id).tier === tier).length
    if (matchingCount >= count) return special
  }
  return null
}

export function simulateLight(grid: PlacementGrid, sources: LightSource[], mirrors: Mirror[], prisms: Prism[], containers: Container[]): SimulationResult {
  const lookup = buildLookup(sources, mirrors, prisms, containers)

  let prismOutputs = new Map<string, ResourceDefinition | null>(prisms.map((p) => [p.id, null]))
  let pass = tracePass(grid, lookup, sources, prisms, prismOutputs)

  // Obergrenze rein aus der Anzahl der Prismen abgeleitet: dank der monotonen Sperre (siehe
  // Datei-Kommentar) muss JEDER Durchlauf, der überhaupt noch etwas ändert, mindestens ein
  // weiteres Prisma neu auflösen — mehr als `prisms.length` solcher Durchläufe kann es also nie
  // geben, unabhängig von der Tier-Tiefe der tatsächlich gebauten Kette.
  const maxPasses = prisms.length + 1
  for (let i = 0; i < maxPasses; i++) {
    let changed = false
    const nextOutputs = new Map(prismOutputs)
    for (const prism of prisms) {
      if (prismOutputs.get(prism.id)) continue // bereits aufgelöst -> gesperrt, siehe Datei-Kommentar
      const counts = pass.prismCounts.get(prism.id) ?? { c: 0, m: 0, y: 0 }
      const colors = pass.prismColors.get(prism.id) ?? new Set<string>()
      const resolved = prism.prismKind === 'triangle' ? resolveTriangleOutput(colors) : resolvePentagonOutput(counts, colors)
      if (resolved) {
        nextOutputs.set(prism.id, resolved)
        changed = true
      }
    }
    prismOutputs = nextOutputs
    if (!changed) break
    pass = tracePass(grid, lookup, sources, prisms, prismOutputs)
  }

  const prismStatus = new Map<string, PrismStatus>()
  for (const prism of prisms) {
    prismStatus.set(prism.id, {
      counts: pass.prismCounts.get(prism.id) ?? { c: 0, m: 0, y: 0 },
      presentColors: pass.prismColors.get(prism.id) ?? new Set(),
      sides: pass.prismSides.get(prism.id) ?? new Set(),
      output: prismOutputs.get(prism.id) ?? null,
    })
  }

  const totalRates = new Map<string, number>()
  for (const perResource of pass.containerRates.values()) {
    for (const [resourceId, rate] of perResource) totalRates.set(resourceId, (totalRates.get(resourceId) ?? 0) + rate)
  }

  return { segments: pass.segments, prismStatus, containerRates: pass.containerRates, totalRates, activeSourceIds: pass.activeSourceIds }
}
