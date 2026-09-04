import { reflect, type Mirror } from '../economy/buildings'
import { cellKey, hexNeighbor, inBounds, type GridCoord, type HexDirection, type PlacementGrid } from './placementGrid'

// Defense-Gegner-Pfad: seit dieser Runde KEIN kürzester BFS-Weg mehr zwischen Spawn und einem
// separat platzierten Ziel-Knoten (User-Vorgabe: "ich möchte nicht, dass der kürzeste Weg
// genommen wird"). Stattdessen strahlt der Spawn wie eine Lichtquelle/ein Prisma auf der
// Economy-Seite EINEN Strahl in eine dedizierte, per Klick drehbare Richtung ab — Spiegel
// (identisches Datenmodell wie auf der Economy-Seite, siehe economy/buildings.ts) lenken ihn um,
// er läuft dabei unbegrenzt weiter ("unendlich lang"), bis er entweder den Rasterrand ("Wand")
// oder einen Turm trifft — GENAU DORT ist dann das Ziel, kein separat platzierbarer Knoten mehr.

/** Zelle -> Id des dort platzierten Gebäudes/Turms (weiterhin generisch für Belegungs-Checks
 * auf beiden Seiten genutzt — die eigentliche Pfadfindung braucht diesen Typ nicht mehr). */
export type Occupancy = Map<string, string>

export type DefenseOccupant = { kind: 'mirror'; orientation: Mirror['orientation'] } | { kind: 'tower'; id: string }

/** Baut die Zell-Lookup für `traceDefensePath()` aus den aktuellen Spiegeln + Türmen. */
export function buildDefenseLookup(mirrors: Mirror[], towers: { id: string; col: number; row: number }[]): Map<string, DefenseOccupant> {
  const map = new Map<string, DefenseOccupant>()
  for (const m of mirrors) map.set(cellKey(m), { kind: 'mirror', orientation: m.orientation })
  for (const t of towers) map.set(cellKey({ col: t.col, row: t.row }), { kind: 'tower', id: t.id })
  return map
}

export interface DefensePathResult {
  /** Zellpfad inkl. Spawn-Zelle, in Durchlaufreihenfolge. */
  cells: GridCoord[]
  /** Id des Turms, an dem der Pfad geendet hat — `null`, wenn er stattdessen am Rasterrand
   * ("Wand") oder an der Sicherheits-Obergrenze `maxSteps` (Spiegel-Endlosschleife) endete. */
  hitTowerId: string | null
}

/** Strahlverfolgung für den Gegner-Pfad: läuft ab `spawn` in `direction` los, lenkt an Spiegeln
 * um (`reflect()`, identische Formel wie auf der Economy-Seite), bis sie einen Turm trifft (Ziel
 * erreicht) oder den Rasterrand verlässt (Wand). `maxSteps` ist eine reine Sicherheitsbremse
 * gegen eine vom Spieler selbst gebaute Spiegel-Endlosschleife — die eigentliche Reichweite ist
 * bewusst unbegrenzt (User-Vorgabe: "dieser ist unendlich lang"). */
export function traceDefensePath(grid: PlacementGrid, lookup: Map<string, DefenseOccupant>, spawn: GridCoord, direction: HexDirection, maxSteps: number): DefensePathResult {
  const cells: GridCoord[] = [spawn]
  let cell = spawn
  let dir = direction
  let hitTowerId: string | null = null

  for (let step = 0; step < maxSteps; step++) {
    const next = hexNeighbor(cell, dir)
    if (!inBounds(grid, next)) break // Wand

    const occupant = lookup.get(cellKey(next))
    if (occupant?.kind === 'tower') {
      cells.push(next)
      hitTowerId = occupant.id
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

  return { cells, hitTowerId }
}
