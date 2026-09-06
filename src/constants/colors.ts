// Zentrale Neon/Cyberpunk-Palette für allgemeine UI-/Szene-Elemente (Hintergrund, Grid,
// Pfad, Basis, generische Gegner-Kennfarbe). Für Ressourcen-Farben (Economy) siehe
// src/data/resources.ts — die nutzt bewusst reines CMY statt dieser Brand-Töne, damit die
// Misch-Rezepte exakt aufgehen (siehe Kommentar dort).

export const COLORS = {
  background: '#111111', // Brand-Vorgabe, nicht verändern
  gridLine: 'rgba(0, 255, 213, 0.07)',
  gridLineStrong: 'rgba(0, 255, 213, 0.18)',

  base: '#b026ff', // Spielerbasis / Kern — eigenständiges Landmark, kein Ressourcen-Tier
  enemy: '#ff2daa', // generische Gegner-Kennfarbe, unabhängig vom Ressourcen-Wheel
  buildEmpty: 'rgba(0, 255, 213, 0.25)', // leerer Bauplatz (Outline)

  path: 'rgba(255, 45, 170, 0.45)',
  pathGlow: 'rgba(255, 45, 170, 0.9)',

  // User-Vorgabe: "die Schriftart ist überall etwas zu dunkel" — textDim/textMid angehoben (waren
  // #7d7d87/#c7c7d1), textBright war schon nahe Weiß und bleibt unverändert.
  textDim: '#9c9ca8',
  textMid: '#d8d8e2',
  textBright: '#eafffa',

  // User-Vorgabe: UI komplett auf den Karten-Look des Referenzbilds umstellen (siehe render/ui.ts
  // drawCard()) — Panel-Hintergrund etwas heller als die Bühne dahinter, dazu ein dünner,
  // cyan-getönter Rahmen (heller/"active", wenn ausgewählt/hover). `accent` ist der durchgehende
  // Haupt-Akzent für Fortschrittsbalken/aktive Rahmen, bewusst derselbe Farbton wie gridLineStrong,
  // nur undurchsichtig.
  panelBg: '#0d131c',
  panelBorder: 'rgba(0, 255, 213, 0.25)',
  panelBorderActive: '#00fff2',
  accent: '#00fff2',
} as const

/** Für Text/Text-Icons, die sonst 1:1 in einer Ressourcenfarbe eingefärbt würden (siehe
 * render/referencePanels.ts): sehr dunkle Farben wie Black (#000000) oder Blue (#0000FF) wären
 * auf dem fast-schwarzen Panel-Hintergrund unlesbar — fällt dann auf `textBright` zurück, sonst
 * bleibt die Ressourcenfarbe erhalten. */
function luminanceOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

export function readableTextColor(hex: string): string {
  return luminanceOf(hex) < 0.35 ? COLORS.textBright : hex
}

/** Für gefüllte Formen, die sonst 1:1 in einer Ressourcenfarbe gerendert würden (siehe
 * render/buildingRender.ts drawPrismEntity()): eine Füllung + gleichfarbiger Glow in Black
 * (#000000) ist auf dem fast-schwarzen Hintergrund praktisch unsichtbar — ein "aktiv, aber man
 * sieht es nicht"-Zustand, der wie "nichts passiert" aussieht. Solche Fälle brauchen einen
 * zusätzlichen, farbunabhängigen Akzent-Rahmen. */
export function isColorDark(hex: string): boolean {
  return luminanceOf(hex) < 0.35
}
