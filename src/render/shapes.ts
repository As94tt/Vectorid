// Zeichenfunktionen für die geometrischen Grundformen. Neue Form -> eigene Funktion hier,
// niemals inline im Render-Loop (render.ts).

const DEFAULT_GLOW = 14

function withGlow(ctx: CanvasRenderingContext2D, color: string, glow: number, draw: () => void) {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  ctx.fillStyle = color
  ctx.strokeStyle = color
  draw()
  ctx.restore()
}

const ROUNDED_POLYLINE_CORNER_RADIUS = 9

/**
 * Gerade Segmente mit abgerundeten Ecken (ctx.arcTo an jedem Zwischenpunkt) — der
 * einheitliche Linien-Look für Verbindungen (Economy) UND den Gegner-Pfad (Defense).
 */
export function strokeRoundedPolyline(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  color: string,
  alpha = 1,
  dashed = false,
) {
  if (points.length < 2) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 8
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.setLineDash(dashed ? [6, 5] : [])
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length - 1; i++) {
    ctx.arcTo(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, ROUNDED_POLYLINE_CORNER_RADIUS)
  }
  const last = points[points.length - 1]
  ctx.lineTo(last.x, last.y)
  ctx.stroke()
  ctx.restore()
}

/**
 * Eckpunkte eines regelmäßigen Polygons — auch außerhalb des Renderns nützlich, z. B. um
 * Verbindungs-Snap-Ports an den Ecken von Synthesizer/Refiner zu verankern (buildingRender.ts).
 */
export function getPolygonVertices(
  x: number,
  y: number,
  radius: number,
  sides: number,
  rotation: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < sides; i++) {
    // -90° Offset, damit z. B. Dreiecke/Fünfecke mit einer Spitze nach oben starten.
    const angle = rotation + (Math.PI / 2) * -1 + (i * 2 * Math.PI) / sides
    points.push({ x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) })
  }
  return points
}

function regularPolygonPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  sides: number,
  rotation: number,
) {
  const points = getPolygonVertices(x, y, radius, sides, rotation)
  ctx.beginPath()
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  })
  ctx.closePath()
}

export function drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  glow = DEFAULT_GLOW,
) {
  withGlow(ctx, color, glow, () => {
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
  })
}

export function drawSquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  rotation = 0,
  glow = DEFAULT_GLOW,
) {
  withGlow(ctx, color, glow, () => {
    ctx.translate(x, y)
    ctx.rotate(rotation)
    ctx.fillRect(-size, -size, size * 2, size * 2)
  })
}

export function drawRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  rotation = 0,
  glow = DEFAULT_GLOW,
) {
  withGlow(ctx, color, glow, () => {
    ctx.translate(x, y)
    ctx.rotate(rotation)
    ctx.fillRect(-width / 2, -height / 2, width, height)
  })
}

export function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  rotation = 0,
  glow = DEFAULT_GLOW,
) {
  withGlow(ctx, color, glow, () => {
    regularPolygonPath(ctx, x, y, size, 3, rotation)
    ctx.fill()
  })
}

export function drawPentagon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  rotation = 0,
  glow = DEFAULT_GLOW,
) {
  withGlow(ctx, color, glow, () => {
    regularPolygonPath(ctx, x, y, size, 5, rotation)
    ctx.fill()
  })
}

export function drawHexagon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  rotation = 0,
  glow = DEFAULT_GLOW,
) {
  withGlow(ctx, color, glow, () => {
    regularPolygonPath(ctx, x, y, size, 6, rotation)
    ctx.fill()
  })
}

/** Nur Outline statt Füllung — z. B. fürs "Raster erweitern"-Icon, das dieselbe Farbe wie die
 * echten (ebenfalls nur umrissenen) Hex-Rasterzellen tragen soll. */
export function drawHexagonOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  lineWidth = 1.5,
) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  regularPolygonPath(ctx, x, y, size, 6, 0)
  ctx.stroke()
  ctx.restore()
}

/** Nur Outline statt Füllung — z. B. für leere Bauplätze im Economy-Grid. */
export function drawSquareOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  lineWidth = 1.5,
) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.strokeRect(x - size, y - size, size * 2, size * 2)
  ctx.restore()
}

/** Halbkreis/Arc, z. B. für den Flamethrower-Turm. `rotation` zeigt die Richtung der Wölbung. */
export function drawHalfCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  rotation = 0,
  glow = DEFAULT_GLOW,
) {
  withGlow(ctx, color, glow, () => {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.arc(x, y, size, rotation - Math.PI / 2, rotation + Math.PI / 2)
    ctx.closePath()
    ctx.fill()
  })
}

/** 5-zackiger Stern, z. B. für den Burst-Turm. */
export function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  rotation = 0,
  glow = DEFAULT_GLOW,
  points = 5,
) {
  withGlow(ctx, color, glow, () => {
    const innerRadius = size * 0.45
    ctx.beginPath()
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? size : innerRadius
      const angle = rotation - Math.PI / 2 + (i * Math.PI) / points
      const px = x + radius * Math.cos(angle)
      const py = y + radius * Math.sin(angle)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
  })
}

/** Nur Outline statt Füllung — z. B. für den hohlen Außenring eines Generators. */
export function drawCircleOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  lineWidth = 2.5,
  glow = DEFAULT_GLOW,
) {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  ctx.arc(x, y, size, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}
