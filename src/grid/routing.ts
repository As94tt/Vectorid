import { reflect, type Mirror } from '../economy/buildings'
import { cellKey, hexNeighbor, inBounds, type GridCoord, type HexDirection, type PlacementGrid } from './placementGrid'

// Gegner-Pfad: seit dieser Runde KEIN kürzester BFS-Weg mehr zwischen zwei fest platzierten
// Knoten (User-Vorgabe: "ich möchte nicht, dass der kürzeste Weg genommen wird"). Stattdessen
// strahlt der feste Endpunkt-Stein (siehe main.ts endpointNode() — eine Zeile ÜBER dem
// eigentlichen Raster, horizontal zentriert) wie eine Lichtquelle/ein Prisma EINEN Strahl in eine
// dedizierte, per Klick drehbare Richtung ab (User-Vorgabe: "die Linie wird vom Endpunkt und nicht
// vom Startpunkt erzeugt") — Spiegel (identisches Datenmodell wie bei der Licht-Wirtschaft, siehe
// economy/buildings.ts) lenken ihn um, er läuft dabei unbegrenzt weiter ("unendlich lang"), bis er
// entweder den Rasterrand ("Wand") oder ein "Hindernis" trifft — GENAU DORT tauchen dann die
// Gegner auf (main.ts dreht die zurückgegebene Zellkette um, sodass sie ZUM Stein laufen, nicht
// von ihm weg). Ein Hindernis ist JEDES nicht-Spiegel-Gebäude auf dem gemeinsamen Raster
// (Lichtquelle, Prisma, ODER Turm) — Lichtstrahlen selbst blockieren den Pfad NICHT (User-Vorgabe:
// "die Farbverbindungen sollen vom Weg der Enemies geblockt werden, nicht andersherum" — es ist
// umgekehrt: der fertige Pfad blockiert SIE, siehe economy/lightSimulation.ts `enemyPathCells`).

/** Zelle -> Id des dort platzierten Gebäudes/Turms (weiterhin generisch für Belegungs-Checks
 * genutzt — die eigentliche Pfadfindung braucht diesen Typ nicht mehr). */
export type Occupancy = Map<string, string>

export type DefenseOccupant = { kind: 'mirror'; orientation: Mirror['orientation'] } | { kind: 'blocker'; id: string }

/** Baut die Zell-Lookup für `traceDefensePath()` aus den aktuellen Spiegeln + allen übrigen
 * Gebäuden (Lichtquellen/Prismen/Türme — main.ts übergibt hier alles außer den Spiegeln selbst). */
export function buildDefenseLookup(mirrors: Mirror[], blockers: { id: string; col: number; row: number }[]): Map<string, DefenseOccupant> {
  const map = new Map<string, DefenseOccupant>()
  for (const m of mirrors) map.set(cellKey(m), { kind: 'mirror', orientation: m.orientation })
  for (const b of blockers) map.set(cellKey({ col: b.col, row: b.row }), { kind: 'blocker', id: b.id })
  return map
}

export interface DefensePathResult {
  /** Zellpfad inkl. Spawn-Zelle, in Durchlaufreihenfolge. */
  cells: GridCoord[]
  /** Id des Gebäudes, an dem der Pfad geendet hat — `null`, wenn er stattdessen am Rasterrand
   * ("Wand") oder an der Sicherheits-Obergrenze `maxSteps` (Spiegel-Endlosschleife) endete. Nur
   * für die Entscheidung gebraucht, ob `drawPath()` noch einen eigenen "Wand"-Marker zeichnen muss
   * (ein getroffenes Gebäude ist ja schon selbst sichtbar) — main.ts braucht die genaue Art des
   * Gebäudes dafür nicht. */
  hitBlockerId: string | null
}

/** Strahlverfolgung für den Gegner-Pfad: läuft ab `origin` (dem Endpunkt-Stein, siehe main.ts
 * endpointNode()) in `direction` los, lenkt an Spiegeln um (`reflect()`, identische Formel wie bei
 * der Licht-Wirtschaft), bis sie ein Hindernis trifft (Ziel erreicht) oder den Rasterrand verlässt
 * (Wand). `maxSteps` ist eine reine Sicherheitsbremse gegen eine vom Spieler selbst gebaute
 * Spiegel-Endlosschleife — die eigentliche Reichweite ist bewusst unbegrenzt (User-Vorgabe: "dieser
 * ist unendlich lang"). Liefert die Zellkette in Abstrahl-Reihenfolge (vom Stein WEG) — main.ts
 * dreht sie für die tatsächliche Gegner-Bewegung um. */
export function traceDefensePath(grid: PlacementGrid, lookup: Map<string, DefenseOccupant>, origin: GridCoord, direction: HexDirection, maxSteps: number): DefensePathResult {
  const cells: GridCoord[] = [origin]
  let cell = origin
  let dir = direction
  let hitBlockerId: string | null = null

  for (let step = 0; step < maxSteps; step++) {
    const next = hexNeighbor(cell, dir)
    if (!inBounds(grid, next)) break // Wand

    const occupant = lookup.get(cellKey(next))
    if (occupant?.kind === 'blocker') {
      cells.push(next)
      hitBlockerId = occupant.id
      break
    }
    if (occupant?.kind === 'mirror') {
      cells.push(next)
      cell = next
      dir = reflect(dir, occupant.orientation)
      continue
    }
    cells.push(next)
    cell = next
  }

  return { cells, hitBlockerId }
}
