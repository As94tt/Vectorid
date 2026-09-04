// Zeigt die vom User bereitgestellten Referenzbilder (Assets/InfoColors.png, Assets/
// ColorEffects.png) 1:1 als Info-Seiten an, statt sie als Canvas nachzubauen — User-Vorgabe:
// "just use the .png picture provided in the asset folder as info pages, no need to recreate
// them". Skaliert nur (Seitenverhältnis erhalten), sonst unverändert.

import colorEffectsUrl from '../../Assets/ColorEffects.png'
import infoColorsUrl from '../../Assets/InfoColors.png'
import { COLORS } from '../constants/colors'

const PANEL_FILL = '#0b0d12'
const CLOSE_BUTTON_SIZE = 26

export type InfoImageKind = 'colors' | 'effects'

function loadImage(src: string): HTMLImageElement {
  const img = new Image()
  img.src = src
  return img
}

const IMAGES: Record<InfoImageKind, HTMLImageElement> = {
  colors: loadImage(infoColorsUrl),
  effects: loadImage(colorEffectsUrl),
}

interface ImagePanelBounds {
  x: number
  y: number
  width: number
  height: number
  closeButton: { x: number; y: number; size: number }
}

function panelBounds(width: number, height: number, img: HTMLImageElement): ImagePanelBounds {
  const maxW = width - 80
  const maxH = height - 60
  const naturalW = img.naturalWidth || 1456
  const naturalH = img.naturalHeight || 1088
  const scale = Math.min(maxW / naturalW, maxH / naturalH)
  const w = naturalW * scale
  const h = naturalH * scale
  const x = (width - w) / 2
  const y = (height - h) / 2
  return { x, y, width: w, height: h, closeButton: { x: x + w - CLOSE_BUTTON_SIZE - 8, y: y + 8, size: CLOSE_BUTTON_SIZE } }
}

export function hitTestInfoImageClose(kind: InfoImageKind, width: number, height: number, x: number, y: number): boolean {
  const b = panelBounds(width, height, IMAGES[kind]).closeButton
  return x >= b.x && x <= b.x + b.size && y >= b.y && y <= b.y + b.size
}

export function drawInfoImagePanel(ctx: CanvasRenderingContext2D, width: number, height: number, kind: InfoImageKind) {
  const img = IMAGES[kind]

  ctx.save()
  ctx.fillStyle = 'rgba(3, 4, 6, 0.92)'
  ctx.fillRect(0, 0, width, height)
  ctx.restore()

  if (!img.complete || img.naturalWidth === 0) return // Bild lädt noch (sehr kurzes Zeitfenster)

  const bounds = panelBounds(width, height, img)

  ctx.save()
  ctx.shadowColor = COLORS.gridLineStrong
  ctx.shadowBlur = 20
  ctx.drawImage(img, bounds.x, bounds.y, bounds.width, bounds.height)
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = COLORS.gridLineStrong
  ctx.lineWidth = 2
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
  ctx.restore()

  const close = bounds.closeButton
  ctx.save()
  ctx.fillStyle = PANEL_FILL
  ctx.fillRect(close.x, close.y, close.size, close.size)
  ctx.strokeStyle = COLORS.textBright
  ctx.lineWidth = 1.5
  ctx.strokeRect(close.x, close.y, close.size, close.size)
  ctx.beginPath()
  ctx.moveTo(close.x + 7, close.y + 7)
  ctx.lineTo(close.x + close.size - 7, close.y + close.size - 7)
  ctx.moveTo(close.x + close.size - 7, close.y + 7)
  ctx.lineTo(close.x + 7, close.y + close.size - 7)
  ctx.stroke()
  ctx.restore()
}
