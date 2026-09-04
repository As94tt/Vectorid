// Jede zeichenbare Spiel-Entität (Gebäude, Turm, Gegner, Projektil, ...) reduziert sich
// auf diese gemeinsame Form. Form = Bedeutung, Farbe = Fraktion/Status, Größe = Stufe.

export type ShapeType = 'circle' | 'square' | 'rect' | 'triangle' | 'pentagon' | 'hexagon'

export interface Entity {
  shape: ShapeType
  x: number
  y: number
  size: number
  color: string
  rotation: number
  /** Glow-Intensität in Pixeln (shadowBlur). Default in shapes.ts, falls nicht gesetzt. */
  glow?: number
  /** Nur für shape: 'rect' relevant — Breite/Höhe statt einheitlicher Größe. */
  width?: number
  height?: number
}
