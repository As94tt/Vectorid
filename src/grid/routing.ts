import { reflect, type Mirror } from '../economy/buildings'
import { cellKey, hexNeighbor, inBounds, type GridCoord, type HexDirection, type PlacementGrid } from './placementGrid'

// Gegner-Pfad: seit dieser Runde KEIN kürzester BFS-Weg mehr zwischen Spawn und einem separat
// platzierten Ziel-Knoten (User-Vorgabe: "ich möchte nicht, dass der kürzeste Weg genommen
// wird"). Stattdessen strahlt der Spawn wie eine Lichtquelle/ein Prisma EINEN Strahl in eine
// dedizierte, per Klick drehbare Richtung ab — Spiegel (identisches Datenmodell wie bei der
// Licht-Wirtschaft, siehe economy/buildings.ts — seit der Zusammenlegung auf EIN gemeinsames
// Raster sogar dieselben Spiegel-Objekte) lenken ihn um, er läuft dabei unbegrenzt weiter
// ("unendlich lang"), bis er entweder den Rasterrand ("Wand") oder ein "Hindernis" trifft — GENAU
// DORT ist dann das Ziel, kein separat platzierbarer Knoten mehr. Ein Hindernis ist JEDES
// nicht-Spiegel-Gebäude auf dem gemeinsamen Raster (Lichtquelle, Prisma, ODER Turm — User-
// Vorgabe: "jedes gebäude blockiert den Weg wie ein Turm"), nicht mehr nur ein Turm.

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

/** Strahlverfolgung für den Gegner-Pfad: läuft ab `spawn` in `direction` los, lenkt an Spiegeln
 * um (`reflect()`, identische Formel wie bei der Licht-Wirtschaft), bis sie ein Hindernis trifft
 * (Ziel erreicht) oder den Rasterrand verlässt (Wand). `maxSteps` ist eine reine Sicherheitsbremse
 * gegen eine vom Spieler selbst gebaute Spiegel-Endlosschleife — die eigentliche Reichweite ist
 * bewusst unbegrenzt (User-Vorgabe: "dieser ist unendlich lang"). */
export function traceDefensePath(grid: PlacementGrid, lookup: Map<string, DefenseOccupant>, spawn: GridCoord, direction: HexDirection, maxSteps: number): DefensePathResult {
  const cells: GridCoord[] = [spawn]
  let cell = spawn
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
