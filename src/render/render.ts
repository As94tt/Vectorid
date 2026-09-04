import type { Entity } from '../entities/types'
import { drawCircle, drawHexagon, drawPentagon, drawRect, drawSquare, drawTriangle } from './shapes'

/** Zentrale Render-Funktion: zeichnet eine Entität anhand ihres shape-Typs. */
export function drawEntity(ctx: CanvasRenderingContext2D, entity: Entity) {
  const { shape, x, y, size, color, rotation, glow } = entity

  switch (shape) {
    case 'circle':
      drawCircle(ctx, x, y, size, color, glow)
      return
    case 'square':
      drawSquare(ctx, x, y, size, color, rotation, glow)
      return
    case 'rect':
      drawRect(ctx, x, y, entity.width ?? size * 2, entity.height ?? size, color, rotation, glow)
      return
    case 'triangle':
      drawTriangle(ctx, x, y, size, color, rotation, glow)
      return
    case 'pentagon':
      drawPentagon(ctx, x, y, size, color, rotation, glow)
      return
    case 'hexagon':
      drawHexagon(ctx, x, y, size, color, rotation, glow)
      return
    default: {
      const _exhaustive: never = shape
      throw new Error(`Unknown shape type: ${_exhaustive}`)
    }
  }
}

export function drawEntities(ctx: CanvasRenderingContext2D, entities: Entity[]) {
  for (const entity of entities) drawEntity(ctx, entity)
}
