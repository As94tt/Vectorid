// Ressourcen-Wheel: Farbe = Ressource = Währung. Gebäude/Türme in einer bestimmten Farbe
// kosten/benötigen die jeweils gleichfarbige Ressource.
//
// Farbsystem (User-Vorgabe, ersetzt das frühere 3-Tier-System komplett — siehe CLAUDE.md
// "Farbsystem V2"): 5 Tiers statt 3, dafür insgesamt WENIGER Farben (17 statt 22) — jede
// Tier-1-Farbe wird gekauft/abgebaut, nicht gemischt; jede Farbe ab Tier 2 wird aus Farben
// NIEDRIGEREN Tiers gemischt (nicht zwingend aus Tier 1 — Rekursion ist jetzt ausdrücklich
// erlaubt, siehe economy/lightSimulation.ts). Alle Hex-Werte sind vom User exakt vorgegeben,
// keine Ableitung mehr über eine Ink-Formel nötig.
//
// Jede Farbe ab Tier 2 hat ZWEI alternative Misch-Rezepte (der Spieler kann sich für jede
// Farbe aussuchen, welchen Prisma-Typ er dafür baut):
//   - triangleRecipe: Dreieck-Prisma, mischt aus 2 (Brown: 3) fest benannten ANDEREN Farben
//     (können selbst wieder gemischte Farben sein, z. B. Teal = Blue + Green).
//   - pentagonRecipe: Fünfeck-Prisma, mischt direkt aus roher Cyan/Magenta/Yellow-Teile-Summe
//     (überspringt alle Zwischenfarben, wie im alten System).
// Black (Tier 5) ist ein Sonderfall: kein Dreieck-Rezept, das Fünfeck-Prisma braucht
// stattdessen 4 beliebige (unterschiedliche) Tier-4-Farben (siehe pentagonSpecial).

export type ResourceTier = 1 | 2 | 3 | 4 | 5 | 'special'

/** Rezept in CMY-"Teilen" (z. B. Teal = 2C+1M+1Y) — keine Anteile, die sich zu 1 summieren. */
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
  /** Dreieck-Prisma: genau diese Ressourcen-Ids müssen gleichzeitig ankommen (2, bei Brown 3).
   * Fehlt bei Tier 1 (wird gekauft, nicht gemischt) und bei Black (kein Dreieck-Rezept). */
  triangleRecipe?: string[]
  /** Fünfeck-Prisma: exakte Summe an roher Cyan/Magenta/Yellow-Teilen. Bei Tier 1 nur als
   * triviale 1-Teil-Zerlegung vorhanden (fürs Munitions-System, siehe towerdefense/ammoEffects.ts
   * — dort wird JEDE Ressource anhand ihres pentagonRecipe in C/M/Y zerlegt). Fehlt bei Black
   * (siehe pentagonSpecial statt dessen). */
  pentagonRecipe?: CmyParts
  /** Sonderfall Black: statt einer C/M/Y-Summe braucht das Fünfeck-Prisma `count` unterschiedliche
   * Farben aus Tier `tier` gleichzeitig anliegend. */
  pentagonSpecial?: { tier: ResourceTier; count: number }
}

function tier1(id: string, name: string, color: string, selfChannel: 'c' | 'm' | 'y'): ResourceDefinition {
  return {
    id,
    name,
    tier: 1,
    color,
    pentagonRecipe: { c: selfChannel === 'c' ? 1 : 0, m: selfChannel === 'm' ? 1 : 0, y: selfChannel === 'y' ? 1 : 0 },
  }
}

function mixed(
  id: string,
  name: string,
  tier: 2 | 3 | 4,
  color: string,
  triangleRecipe: string[],
  pentagonRecipe: CmyParts,
): ResourceDefinition {
  return { id, name, tier, color, triangleRecipe, pentagonRecipe }
}

export const RESOURCES: ResourceDefinition[] = [
  // Tier 1 — Grundfarben, werden gekauft/abgebaut, nicht gemischt.
  tier1('yellow', 'Yellow', '#FFFF00', 'y'),
  tier1('magenta', 'Magenta', '#FF00FF', 'm'),
  tier1('cyan', 'Cyan', '#00FFFF', 'c'),

  // Tier 2 — direkt aus je 2 (Brown: 3) Tier-1-Farben gemischt.
  mixed('blue', 'Blue', 2, '#0000FF', ['magenta', 'cyan'], { c: 2, m: 2, y: 0 }),
  mixed('red', 'Red', 2, '#FF0000', ['magenta', 'yellow'], { c: 0, m: 2, y: 2 }),
  mixed('green', 'Green', 2, '#00FF00', ['cyan', 'yellow'], { c: 2, m: 0, y: 2 }),
  mixed('brown', 'Brown', 2, '#663300', ['cyan', 'magenta', 'yellow'], { c: 1, m: 1, y: 1 }),

  // Tier 3 — aus je 2 Tier-2-Farben gemischt.
  mixed('teal', 'Teal', 3, '#008080', ['blue', 'green'], { c: 2, m: 1, y: 1 }),
  mixed('purple', 'Purple', 3, '#800080', ['red', 'blue'], { c: 1, m: 2, y: 1 }),
  mixed('olive', 'Olive', 3, '#808000', ['red', 'green'], { c: 1, m: 1, y: 2 }),

  // Tier 4 — aus je 1 Tier-2-Farbe + 1 Tier-1-Farbe gemischt.
  mixed('cerulean', 'Cerulean', 4, '#00AAFF', ['blue', 'cyan'], { c: 3, m: 1, y: 0 }),
  mixed('aquamarine', 'Aquamarine', 4, '#00FFAA', ['green', 'cyan'], { c: 3, m: 0, y: 1 }),
  mixed('violet', 'Violet', 4, '#AA00FF', ['blue', 'magenta'], { c: 1, m: 3, y: 0 }),
  mixed('fuchsia', 'Fuchsia', 4, '#FF00AA', ['red', 'magenta'], { c: 0, m: 3, y: 1 }),
  mixed('amber', 'Amber', 4, '#FFAA00', ['red', 'yellow'], { c: 0, m: 1, y: 3 }),
  mixed('chartreuse', 'Chartreuse', 4, '#AAFF00', ['green', 'yellow'], { c: 1, m: 0, y: 3 }),

  // Tier 5 — Krönung: kein Dreieck-Rezept, Fünfeck braucht 4 beliebige Tier-4-Farben statt
  // einer C/M/Y-Summe (siehe pentagonSpecial).
  { id: 'black', name: 'Black', tier: 5, color: '#000000', pentagonSpecial: { tier: 4, count: 4 } },

  // Spezial-Ressourcen — kein Teil des Farb-Wheels, kommen aus Kämpfen statt Wirtschaft.
  { id: 'lumen', name: 'Lumen', tier: 'special', color: '#ffffff' },
  { id: 'prisma', name: 'Prism', tier: 'special', color: '#e6d9ff' },
]

export function getResource(id: string): ResourceDefinition {
  const found = RESOURCES.find((r) => r.id === id)
  if (!found) throw new Error(`Unknown resource: ${id}`)
  return found
}

export function getResourcesByTier(tier: ResourceTier): ResourceDefinition[] {
  return RESOURCES.filter((r) => r.tier === tier)
}
