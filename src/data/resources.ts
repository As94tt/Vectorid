// Ressourcen-Wheel: Farbe = Ressource = Währung. Gebäude/Türme in einer bestimmten Farbe
// kosten/benötigen die jeweils gleichfarbige Ressource.
//
// Farbsystem V3 (User-Vorgabe, ersetzt V2 komplett): 5 Tiers, aber WENIGER Farben (14 statt 17)
// und neu zugeschnitten — jede Tier-1-Farbe wird gekauft/abgebaut, nicht gemischt; jede Farbe ab
// Tier 2 wird aus Farben NIEDRIGEREN Tiers gemischt. Alle Hex-Werte sind vom User exakt
// vorgegeben, keine Ableitung mehr über eine Ink-Formel nötig.
//
// Jede Farbe ab Tier 2 hat ZWEI alternative Misch-Rezepte (der Spieler kann sich für jede
// Farbe aussuchen, welchen Prisma-Typ er dafür baut):
//   - triangleRecipe: Dreieck-Prisma, mischt aus 2 fest benannten ANDEREN Farben (können selbst
//     wieder gemischte Farben sein, z. B. Cerulean = Blue + Green).
//   - hexagonRecipe: Hexagon-Prisma (ersetzt das frühere Fünfeck), mischt direkt aus roher
//     Cyan/Magenta/Yellow-Teile-Summe (überspringt alle Zwischenfarben).
// Black/White (Tier 5) sind Sonderfälle: kein Dreieck-Rezept, das Hexagon-Prisma braucht
// stattdessen 3 fest benannte Tier-3/4-Farben (siehe hexagonNamedRecipe) statt einer C/M/Y-Summe.

export type ResourceTier = 1 | 2 | 3 | 4 | 5 | 'special'

/** Rezept in CMY-"Teilen" (z. B. Cerulean = 2C+1M+1Y) — keine Anteile, die sich zu 1 summieren. */
export interface CmyParts {
  c: number
  m: number
  y: number
}

export interface ResourceDefinition {
  id: string
  name: string
  tier: ResourceTier
  color: string
  /** Dreieck-Prisma: genau diese Ressourcen-Ids müssen gleichzeitig ankommen. Fehlt bei Tier 1
   * (wird gekauft, nicht gemischt) und bei Tier 5 (kein Dreieck-Rezept, nur Hexagon). */
  triangleRecipe?: string[]
  /** Hexagon-Prisma: exakte Summe an roher Cyan/Magenta/Yellow-Teilen. Bei Tier 1 nur als
   * triviale 1-Teil-Zerlegung vorhanden (fürs Munitions-System, siehe towerdefense/ammoEffects.ts
   * — dort wird JEDE Ressource anhand ihres hexagonRecipe in C/M/Y zerlegt). Fehlt bei Tier 5
   * (siehe hexagonNamedRecipe stattdessen). */
  hexagonRecipe?: CmyParts
  /** Sonderfall Tier 5 (Black/White): statt einer C/M/Y-Summe braucht das Hexagon-Prisma genau
   * diese fest benannten Ressourcen-Ids gleichzeitig anliegend (wie triangleRecipe, aber am
   * Hexagon-Prisma statt am Dreieck aufgelöst). */
  hexagonNamedRecipe?: string[]
}

function tier1(id: string, name: string, color: string, selfChannel: 'c' | 'm' | 'y'): ResourceDefinition {
  return {
    id,
    name,
    tier: 1,
    color,
    hexagonRecipe: { c: selfChannel === 'c' ? 1 : 0, m: selfChannel === 'm' ? 1 : 0, y: selfChannel === 'y' ? 1 : 0 },
  }
}

function mixed(
  id: string,
  name: string,
  tier: 2 | 3 | 4,
  color: string,
  triangleRecipe: string[],
  hexagonRecipe: CmyParts,
): ResourceDefinition {
  return { id, name, tier, color, triangleRecipe, hexagonRecipe }
}

export const RESOURCES: ResourceDefinition[] = [
  // Tier 1 — Grundfarben, werden gekauft/abgebaut, nicht gemischt.
  tier1('yellow', 'Yellow', '#FFFF00', 'y'),
  tier1('magenta', 'Magenta', '#FF00FF', 'm'),
  tier1('cyan', 'Cyan', '#00FFFF', 'c'),

  // Tier 2 — direkt aus je 2 Tier-1-Farben gemischt.
  mixed('blue', 'Blue', 2, '#0000FF', ['magenta', 'cyan'], { c: 2, m: 2, y: 0 }),
  mixed('red', 'Red', 2, '#FF0000', ['magenta', 'yellow'], { c: 0, m: 2, y: 2 }),
  mixed('green', 'Green', 2, '#00FF00', ['cyan', 'yellow'], { c: 2, m: 0, y: 2 }),

  // Tier 3 — aus je 2 Tier-2-Farben gemischt.
  mixed('cerulean', 'Cerulean', 3, '#00FFAA', ['blue', 'green'], { c: 2, m: 1, y: 1 }),
  mixed('violet', 'Violet', 3, '#AA00FF', ['red', 'blue'], { c: 1, m: 2, y: 1 }),
  mixed('chartreuse', 'Chartreuse', 3, '#AAFF00', ['green', 'red'], { c: 1, m: 1, y: 2 }),

  // Tier 4 — aus je 1 Tier-3-Farbe + 1 Tier-1-Farbe gemischt.
  mixed('aquamarine', 'Aquamarine', 4, '#00AAFF', ['cerulean', 'cyan'], { c: 3, m: 1, y: 1 }),
  mixed('fuchsia', 'Fuchsia', 4, '#FF00AA', ['violet', 'magenta'], { c: 1, m: 3, y: 1 }),
  mixed('amber', 'Amber', 4, '#FFAA00', ['chartreuse', 'yellow'], { c: 1, m: 1, y: 3 }),

  // Tier 5 — Krönung: kein Dreieck-Rezept, Hexagon braucht ALLE 3 Farben des jeweils
  // niedrigeren Tiers statt einer C/M/Y-Summe (Black = alle Tier-3-Farben, White = alle
  // Tier-4-Farben, siehe hexagonNamedRecipe).
  { id: 'black', name: 'Black', tier: 5, color: '#000000', hexagonNamedRecipe: ['cerulean', 'violet', 'chartreuse'] },
  { id: 'white', name: 'White', tier: 5, color: '#FFFFFF', hexagonNamedRecipe: ['aquamarine', 'fuchsia', 'amber'] },

  // Spezial-Ressourcen — kein Teil des Farb-Wheels, kommen aus Kämpfen statt Wirtschaft.
  { id: 'lumen', name: 'Lumen', tier: 'special', color: '#fff2b0' }, // eigener Ton, damit es sich vom neuen Tier-5 "White" (#FFFFFF) unterscheidet
  { id: 'prisma', name: 'Prism', tier: 'special', color: '#e6d9ff' },
]

export function getResource(id: string): ResourceDefinition {
  const found = RESOURCES.find((r) => r.id === id)
  if (!found) throw new Error(`Unknown resource: ${id}`)
  return found
}
