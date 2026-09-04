// Zentrale Neon/Cyberpunk-Palette für allgemeine UI-/Szene-Elemente (Hintergrund, Grid,
// Pfad, Basis, generische Gegner-Kennfarbe). Für Ressourcen-Farben (Economy) siehe
// src/data/resources.ts — die nutzt bewusst reines CMY statt dieser Brand-Töne, damit die
// Misch-Rezepte exakt aufgehen (siehe Kommentar dort).

export const COLORS = {
  background: '#111111', // Brand-Vorgabe, nicht verändern
  gridLine: 'rgba(0, 255, 213, 0.07)',
  gridLineStrong: 'rgba(0, 255, 213, 0.18)',

  base: '#b026ff', // Spielerbasis / Kern — eigenständiges Landmark, kein Ressourcen-Tier
  // Achtung: nicht zu verwechseln mit der Lvl-2-Ressource "Purple" (#800080) in resources.ts —
  // gleicher Name, andere Bedeutung (Landmark-Farbe vs. Wirtschafts-Ressource).
  enemy: '#ff2daa', // generische Gegner-Kennfarbe, unabhängig vom Ressourcen-Wheel
  buildEmpty: 'rgba(0, 255, 213, 0.25)', // leerer Bauplatz (Outline)

  path: 'rgba(255, 45, 170, 0.45)',
  pathGlow: 'rgba(255, 45, 170, 0.9)',

  textDim: '#7d7d87',
  textMid: '#c7c7d1',
  textBright: '#eafffa',
} as const

export type ColorToken = (typeof COLORS)[keyof typeof COLORS]

/** Für Text/Text-Icons, die sonst 1:1 in einer Ressourcenfarbe eingefärbt würden (siehe
 * render/referencePanels.ts, render/colorWheelPanel.ts): sehr dunkle Farben wie Black (#000000)
 * oder Blue (#0000FF) wären auf dem fast-schwarzen Panel-Hintergrund unlesbar — fällt dann auf
 * `textBright` zurück, sonst bleibt die Ressourcenfarbe erhalten. */
export function readableTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance < 0.35 ? COLORS.textBright : hex
}
