// Gemeinsames Hexfeld-Raster-System — genutzt von der Economy-Licht-Wirtschaft UND vom
// Defense-Knotenraster (Turmplatzierung + Gegner-Pfad-Routing). Rein geometrisch, kennt nichts
// von Gebäuden/Türmen selbst. Sechseckig statt quadratisch (User-Vorgabe, beide Seiten) —
// "odd-r"-Offset-Koordinaten (ungerade Zeilen um einen halben Feld-Durchmesser nach rechts
// verschoben), Spitze-oben-Ausrichtung (deckt sich mit `getPolygonVertices()` in shapes.ts,
// dieselbe Konvention wie die bereits vorhandene Sechseck-Form z. B. beim Rapid-Turm).

export interface PlacementGrid {
  cols: number
  rows: number
  /** Radius eines Hexfelds (Mittelpunkt bis Ecke) in Pixeln — ersetzt die frühere Quadrat-Seitenlänge. */
  cellSize: number
  originX: number
  originY: number
}

export const ECONOMY_STARTING_GRID_SIZE = 4
export const DEFENSE_STARTING_GRID_SIZE = 5
/** Kosten in Prisma, um ein Raster (Economy ODER Defense) um je 1 Spalte + 1 Zeile zu
 * erweitern — Platzhalter-Wert, für beide Seiten gleich. */
export const GRID_EXPAND_COST = 5

export interface GridCoord {
  col: number
  row: number
}

export function cellKey(cell: GridCoord): string {
  return `${cell.col},${cell.row}`
}

export function inBounds(grid: PlacementGrid, cell: GridCoord): boolean {
  return cell.col >= 0 && cell.row >= 0 && cell.col < grid.cols && cell.row < grid.rows
}

/** Einer von 6 Nachbarn eines Hexfelds — welches Zell-Delta das ist, hängt (bei Offset-
 * Koordinaten) von der Zeilen-Parität ab. Reihenfolge ist winkeltreu (je 60° weiter), das
 * nutzt die Spiegel-Reflexion in economy/buildings.ts aus (`reflect()`). */
export type HexDirection = 0 | 1 | 2 | 3 | 4 | 5

const EVEN_ROW_DELTAS: { dc: number; dr: number }[] = [
  { dc: 1, dr: 0 },
  { dc: 0, dr: -1 },
  { dc: -1, dr: -1 },
  { dc: -1, dr: 0 },
  { dc: -1, dr: 1 },
  { dc: 0, dr: 1 },
]
const ODD_ROW_DELTAS: { dc: number; dr: number }[] = [
  { dc: 1, dr: 0 },
  { dc: 1, dr: -1 },
  { dc: 0, dr: -1 },
  { dc: -1, dr: 0 },
  { dc: 0, dr: 1 },
  { dc: 1, dr: 1 },
]

function rowParity(row: number): number {
  return ((row % 2) + 2) % 2
}

export function hexNeighbor(cell: GridCoord, direction: HexDirection): GridCoord {
  const delta = (rowParity(cell.row) === 0 ? EVEN_ROW_DELTAS : ODD_ROW_DELTAS)[direction]
  return { col: cell.col + delta.dc, row: cell.row + delta.dr }
}

const SQRT3 = Math.sqrt(3)

/** Pixel-Breite einer Spalte (horizontaler Mittelpunktsabstand zweier Felder derselben Zeile). */
export function hexColumnWidth(grid: PlacementGrid): number {
  return grid.cellSize * SQRT3
}

/** Pixel-Höhe einer Zeile (vertikaler Mittelpunktsabstand zweier Felder benachbarter Zeilen). */
export function hexRowHeight(grid: PlacementGrid): number {
  return grid.cellSize * 1.5
}

/** Gesamtbreite/-höhe des Rasters in Pixeln — für Layout-Berechnungen (z. B. Panel-Ausrichtung
 * in main.ts), da sich das nicht mehr trivial aus `cols`/`rows` * `cellSize` ergibt. */
export function gridPixelWidth(grid: PlacementGrid): number {
  return hexColumnWidth(grid) * (grid.cols + 0.5)
}
export function gridPixelHeight(grid: PlacementGrid): number {
  return hexRowHeight(grid) * grid.rows + grid.cellSize * 0.5
}

export function cellCenter(grid: PlacementGrid, cell: GridCoord): { x: number; y: number } {
  const colWidth = hexColumnWidth(grid)
  const shift = rowParity(cell.row) === 1 ? colWidth / 2 : 0
  return {
    x: grid.originX + colWidth / 2 + cell.col * colWidth + shift,
    y: grid.originY + grid.cellSize + cell.row * hexRowHeight(grid),
  }
}

/** Rundet (nicht-ganzzahlige) Achsial-Koordinaten korrekt auf ein Hexfeld (Standard-Verfahren
 * über Würfel-Koordinaten — naives Runden von q/r alleinträfe an manchen Feldgrenzen daneben). */
function roundAxial(q: number, r: number): { q: number; r: number } {
  const x = q
  const z = r
  const y = -x - z
  let rx = Math.round(x)
  let ry = Math.round(y)
  let rz = Math.round(z)
  const dx = Math.abs(rx - x)
  const dy = Math.abs(ry - y)
  const dz = Math.abs(rz - z)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy > dz) ry = -rx - rz
  else rz = -rx - ry
  return { q: rx, r: rz }
}

/** Pixel-Koordinaten -> nächstgelegenes Hexfeld (Offset-Koordinaten), OHNE Rasterbegrenzung. */
function pixelToNearestOffset(grid: PlacementGrid, x: number, y: number): GridCoord {
  const size = grid.cellSize
  const px = x - grid.originX - hexColumnWidth(grid) / 2
  const py = y - grid.originY - size
  const rFloat = py / (size * 1.5)
  const qFloat = px / hexColumnWidth(grid) - rFloat / 2
  const { q, r } = roundAxial(qFloat, rFloat)
  const parity = rowParity(r)
  return { col: q + (r - parity) / 2, row: r }
}

/** Rasterzelle unter Pixel-Koordinaten, oder null wenn außerhalb des Rasters. */
export function cellAtPoint(grid: PlacementGrid, x: number, y: number): GridCoord | null {
  const cell = pixelToNearestOffset(grid, x, y)
  return inBounds(grid, cell) ? cell : null
}

/** Nächstgelegener Knotenpunkt zu Pixel-Koordinaten, geklemmt aufs Raster (nie null). */
export function nearestCell(grid: PlacementGrid, x: number, y: number): GridCoord {
  const cell = pixelToNearestOffset(grid, x, y)
  return {
    col: Math.max(0, Math.min(grid.cols - 1, cell.col)),
    row: Math.max(0, Math.min(grid.rows - 1, cell.row)),
  }
}

export function drawPlacementGrid(ctx: CanvasRenderingContext2D, grid: PlacementGrid, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const { x, y } = cellCenter(grid, { col, row })
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 90)
        const px = x + grid.cellSize * Math.cos(angle)
        const py = y + grid.cellSize * Math.sin(angle)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
    }
  }
  ctx.stroke()
  ctx.restore()
}
