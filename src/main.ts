import { COLORS, readableTextColor } from './constants/colors'
import { startGameLoop } from './core/gameLoop'
import {
  BUILDING_COSTS,
  createLightSource,
  createMirror,
  createPrism,
  GENERATOR_MAX_LEVEL,
  generatorUpgradeCost,
  rotateMirror,
  rotatePrism,
  upgradeLightSource,
  type LightSource,
  type Mirror,
  type Prism,
} from './economy/buildings'
import { simulateLight, type SimulationResult } from './economy/lightSimulation'
import {
  cellAtPoint,
  cellCenter,
  cellKey,
  drawPlacementGrid,
  gridPixelHeight,
  gridPixelWidth,
  GRID_EXPAND_COST,
  hexColumnWidth,
  hexNeighbor,
  inBounds,
  nearestCell,
  type GridCoord,
  type HexDirection,
  type PlacementGrid,
} from './grid/placementGrid'
import { buildDefenseLookup, traceDefensePath, type Occupancy } from './grid/routing'
import { addToInventory, canAfford, cheatAddHundredToAll, createInventory, spend, type Inventory } from './economy/inventory'
import {
  buildPalette,
  drawBeamSegment,
  drawBeamTraveler,
  drawCellHighlight,
  drawLightSourceEntity,
  drawMaxLevelCellMarker,
  drawMirrorEntity,
  drawPaletteItem,
  drawPrismEntity,
  drawSelectedCellMarker,
  hitTestPalette,
  isSourceMaxed,
  paletteItemDescription,
  prismSize,
  sourceOuterRadius,
  sourceResourceIdForPalette,
  PRISM_COMPLEX_SIZE,
  PRISM_SIMPLE_SIZE,
  SOURCE_OUTER_SIZE,
  type PaletteItem,
  type PaletteKind,
} from './render/buildingRender'
import { buildHudButtons, drawHud, hitTestButton, HUD_HEIGHT, type HudButton } from './render/hud'
import {
  buildTowerPalette,
  drawTowerEntity,
  drawTowerLevelRing,
  drawTowerPaletteItem,
  drawTowerPreview,
  hitTestTowerPalette,
  towerPaletteItemDescription,
  TOWER_ICON_SIZE,
  type TowerPaletteItem,
} from './render/towerRender'
import { getEffectiveTowerStats, createTower, getTowerDefinition, loadoutKey, towerUpgradeCost, TOWER_DEFINITIONS, TOWER_MAX_LEVEL, type PlacedTower, type TowerKind } from './towerdefense/towers'
import { getResource, RESOURCES } from './data/resources'
import { drawLabel } from './render/shapes'
import { drawPath, pathTotalLength, type Point } from './towerdefense/path'
import { updateProjectiles, updateTowers, pruneVisualEffects, type Projectile, type VisualEffect } from './towerdefense/combat'
import { activeStackCounts, pruneEnemies, tickEnemy, type Enemy } from './towerdefense/enemies'
import { createWaveState, isBossWave, tickWaveSpawning, BOSS_LUMEN_MULTIPLIER, BOSS_WAVE_PAUSE_SECONDS, WAVE_PAUSE_SECONDS, type WaveState } from './towerdefense/waves'
import { drawEnemies, drawProjectiles, drawTowerCombatEffects, drawVisualEffects } from './render/combatRender'
import { drawColorGuideList, drawColorGuideSidebarTitle, drawWelcomePanel, hitTestReferencePanelClose } from './render/referencePanels'
import { drawCard, drawCurrencyIcon, drawHeartIcon, drawProgressBar, drawSkullIcon, healthFractionColor } from './render/ui'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = canvas.getContext('2d')
if (!ctx) throw new Error('Canvas 2D context is not supported')

let width = 0
let height = 0

// Info-Feld oben (Spielername/Level/Ressourcen/Einstellungen/Speichern/Cheat) + Bestand.
const inventory: Inventory = createInventory()
const playerName = 'Commander'
const playerLevel = 1
let hudButtons: HudButton[] = []
let paletteItems: PaletteItem[] = []


// Einmaliges Tutorial-Popup (User-Vorgabe: "beim ersten starten") — merkt sich per localStorage,
// ob es schon gezeigt wurde, damit es bei künftigen Besuchen nicht erneut aufploppt (versucht
// erst gar nicht, mehr als dieses eine Flag zu speichern — es gibt sonst kein Save-System).
const TUTORIAL_SEEN_KEY = 'vectoid-tutorial-seen'
function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEY) === '1'
  } catch {
    return false
  }
}
function markTutorialSeen() {
  try {
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1')
  } catch {
    // Private-Browsing o. Ä. — dann zeigt sich das Tutorial halt jedes Mal, kein Absturz nötig.
  }
}
let welcomeOpen = !hasSeenTutorial()

// Auswahl (Klick auf ein Gebäude/einen Turm): zeigt Name/Level/Produktionsdaten bzw.
// Name/Munition/Level in der "SELECTED"-Karte der rechten Seitenleiste (siehe drawRightSidebar())
// — anders als das frühere schwebende Info-Panel NICHT mehr blockierend, der Rest des Spiels
// bleibt bedienbar, solange etwas ausgewählt ist (User-Vorgabe, Referenzbild).
// User-Vorgabe: "ich möchte auch leere Felder auswählen können" — die SELECTED-Karte kann jetzt
// auch eine leere Rasterzelle beschreiben (kind: 'empty', per col/row statt einer Gebäude-Id, da
// eine leere Zelle keine hat). Mirror/Prisma bleiben weiterhin nie auswählbar (drehen sich
// stattdessen per Klick, siehe pendingPress-Logik) — das war so schon vor dieser Änderung.
type InfoTarget = { kind: 'source' | 'tower'; id: string } | { kind: 'empty'; col: number; row: number }
let infoTarget: InfoTarget | null = null

/** UPGRADE/SELL/Schließen-Knöpfe der "SELECTED"-Karte — wie `hudButtons` ein pro Frame beim
 * Zeichnen neu befülltes Array, in Bildschirm-Koordinaten (die Seitenleiste liegt außerhalb von
 * render()s Welt-ctx.translate), per hitTestButton() aus render/hud.ts wiederverwendet. */
interface SidebarButton {
  id: 'upgrade' | 'sell' | 'close'
  x: number
  y: number
  width: number
  height: number
}
let sidebarButtons: SidebarButton[] = []

// Abriss-Modus (User-Wunsch: Gebäude/Türme wieder löschen können, Lumen wird zurückerstattet).
// Ein Toggle-Icon in der Kauf-Leiste schaltet den Modus ein/aus — solange aktiv, löscht ein Klick
// auf ein Gebäude/einen Turm ihn sofort statt ihn auszuwählen/zu drehen.
let demolishMode = false

// User-Vorgabe: manuelle Spiel-Pause — stoppt NUR combatTick() (Wellen/Gegner/Türme), economyTick()
// (Licht-Simulation/Munitions-Zuweisung) läuft bewusst WEITER, damit Bauen/Umbauen während der
// Pause weiterhin live sichtbare Rückmeldung gibt. Wird per Klick auf den neuen Pause/Play-Button
// umgeschaltet (siehe handleHudButton()) UND automatisch gesetzt, sobald ein Spiegel auf den
// Gegner-Pfad gestellt wird (siehe finalizePlacement()/finalizeMove()) — muss danach manuell per
// Klick wieder aufgehoben werden (User-Vorgabe: "ich muss manuell wieder auf Start drücken").
let gamePaused = false

/** Klick vs. Halten+Ziehen auf Generator-Innenkreis/Producer-/Turm-Körper: erst nach dem
 * Loslassen entscheiden, ob es ein Klick (Info-Panel) oder ein Ziehen (Verschieben) war. */
interface PendingPress {
  kind: 'source' | 'mirror' | 'prism' | 'tower'
  id: string
  downPos: Point
}
let pendingPress: PendingPress | null = null
const PRESS_MOVE_THRESHOLD = 6

// Türme: eigener Abschnitt der kombinierten Kauf-Leiste (siehe buildScene()). Stehen wie jedes
// andere Gebäude auf dem gemeinsamen Raster (siehe placementGrid weiter unten).
let towers: PlacedTower[] = []
let towerPaletteItems: TowerPaletteItem[] = []
let towerCounter = 0
let placingTowerKind: TowerKind | null = null
let placingTowerCursor: Point | null = null

function nextTowerId(): string {
  towerCounter += 1
  return `tower-${towerCounter}`
}

/** EINE Reihe der kombinierten Kauf-Leiste (User-Vorgabe: wieder wie früher — Economy-Bauteile
 * links, Türme rechts, mit einem Trennstrich exakt in der Bildschirmmitte, statt der zwischen-
 * zeitlichen zwei übereinander gestapelten Reihen), Karten-Optik (siehe render/ui.ts drawCard())
 * bleibt unverändert. Der Trennstrich sitzt mittig zwischen dem letzten Economy- (Index
 * economyCount-1) und dem ersten Turm-Icon (Index economyCount). Zusätzlich zum normalen
 * `PALETTE_GAP` steht zwischen den beiden Gruppen `PALETTE_GROUP_GAP` extra Abstand (User-Vorgabe:
 * "schiebe beide Seiten... etwas mehr von der Mitte weg, damit diese klar getrennt sind") — je zur
 * Hälfte auf beide Seiten verteilt, damit der Mittelpunkt der beiden Randkarten (und damit der
 * Trennstrich) trotzdem exakt bei `width/2` bleibt, wo auch der Endpunkt-Stein fluchtet (siehe
 * buildWorld()). */
const PALETTE_GAP = 64
const PALETTE_GROUP_GAP = 48
const PALETTE_ROW_Y = HUD_HEIGHT + 44

function buildScene() {
  hudButtons = buildHudButtons(width)
  const economyCount = buildPalette(0, 0, PALETTE_GAP).length
  const startX = width / 2 - (economyCount - 0.5) * PALETTE_GAP - PALETTE_GROUP_GAP / 2
  const towerStartX = width / 2 + PALETTE_GAP / 2 + PALETTE_GROUP_GAP / 2
  paletteItems = buildPalette(startX, PALETTE_ROW_Y, PALETTE_GAP)
  towerPaletteItems = buildTowerPalette(towerStartX, PALETTE_ROW_Y, PALETTE_GAP)
}

// Das gemeinsame Raster (User-Vorgabe: "Instead of having the split between economy and defense,
// i want to have everything on one grid") — Lichtquellen/Spiegel/Prismen/Türme UND der Gegner-
// Spawn/-Pfad leben alle hier zusammen, teilen sich EINE Belegungs-Map. Ein Strahl muss jetzt in
// einem Turm ENDEN, um dessen Farbe als Munition zu liefern (siehe economy/lightSimulation.ts,
// economyTick() weiter unten) — kein Container-Bautyp mehr. Jedes Nicht-Spiegel-Gebäude blockiert
// den Gegner-Pfad genau wie früher nur ein Turm (siehe recomputeEnemyPath()); Spiegel lenken
// sowohl Licht ALS AUCH den Gegner-Pfad um (dieselben Objekte, siehe grid/routing.ts).
let placementGrid: PlacementGrid
let lightSources: LightSource[] = []
let mirrors: Mirror[] = []
let prisms: Prism[] = []
let occupancy: Occupancy = new Map()
let worldReady = false
let lightSimulation: SimulationResult = { segments: [], prismStatus: new Map(), towerAmmo: new Map(), activeSourceIds: new Set() }

// Endpunkt-Stein (User-Vorgabe: "Der Endpunkt soll ein Stein sein, genau in der Mitte oberhalb dem
// Grid") — ein fester Punkt eine Zeile ÜBER dem eigentlichen Raster (row -1), horizontal zentriert.
// Anders als der frühere Spawn ist er NICHT verschiebbar, nur seine Abstrahlrichtung ist per Klick
// drehbar (`endpointDirection`). Da die Rasterbreite immer gerade ist (6/8/10/…/20, siehe
// expandGrid()), fällt die exakte Mitte zwischen zwei Spalten — row -1 hat ungerade Zeilen-Parität
// (siehe placementGrid.ts rowParity()), deren Verschiebung um eine halbe Spaltenbreite genau das
// ausgleicht: col = cols/2 - 1 (ganzzahlig) landet an derselben Pixel-Position wie "Spalte 2.5" in
// einer geraden Zeile — exakt die geometrische Mitte, unabhängig von der aktuellen Rasterbreite.
// User-Vorgabe: Standard-Abstrahlrichtung zeigt nach rechts statt links (die Startaufstellung
// sitzt links im Raster, siehe buildWorld() — Richtung 4 hätte den Pfad direkt in den Cluster
// hineinlaufen lassen, Richtung 5 führt stattdessen in die freie rechte Hälfte).
let endpointDirection: HexDirection = 5

function endpointNode(): GridCoord {
  return { col: placementGrid.cols / 2 - 1, row: -1 }
}

/** Nächste Richtung ab `from` (im Uhrzeigersinn), deren allererster Schritt tatsächlich ins Raster
 * hineinführt — Klick auf den Stein soll IMMER einen sichtbaren Pfad ergeben. Da der Stein eine
 * Zeile ÜBER dem Raster sitzt, führen nur 2 der 6 Richtungen überhaupt nach unten hinein (die
 * anderen 4 blieben in Zeile -1 oder gingen weiter nach oben weg) — ein simples "+1" würde also
 * die meiste Zeit in einem unsichtbaren Nullweg landen. */
function nextValidEndpointDirection(from: HexDirection): HexDirection {
  for (let i = 1; i <= 6; i++) {
    const candidate = ((from + i) % 6) as HexDirection
    if (inBounds(placementGrid, hexNeighbor(endpointNode(), candidate))) return candidate
  }
  return from
}

let enemyPathPixels: Point[] = []
/** Zellkette des aktuellen Gegner-Pfads (Reihenfolge Einlauf -> Stein, siehe recomputeEnemyPath())
 * — die Licht-Simulation braucht diese Rohdaten (nicht die Pixel-Version), um Strahlen zu
 * blockieren, die den Pfad kreuzen würden (siehe recomputeLightSimulation(), User-Vorgabe: "die
 * farbverbindungen sollen vom weg der enemies geblockt werden"). */
let enemyPathCells: GridCoord[] = []
/** Gesamtlänge des aktuellen Pfads in Pixeln — cached, damit tickEnemy() nicht jeden Frame für
 * jeden Gegner neu über den ganzen Pfad summieren muss (siehe recomputeEnemyPath()). */
let enemyPathLength = 0
/** Id des Gebäudes, an dem der aktuelle Gegner-Pfad einläuft (dynamische Spawn-Seite, siehe
 * recomputeEnemyPath()) — `null`, wenn er stattdessen an der bloßen Wand endet (noch kein
 * Hindernis im Weg). Nur für die Marker-Entscheidung in drawPath() gebraucht (siehe
 * grid/routing.ts DefensePathResult). */
let pathHitBlockerId: string | null = null
/** Schnelle Nachschlage-Menge für `isOnEnemyPath()` (dieselben Zellen wie `enemyPathCells`, nur
 * als Set der cellKey()-Strings) — wird zusammen mit `enemyPathCells` in recomputeEnemyPath()
 * neu aufgebaut. */
let enemyPathCellKeySet = new Set<string>()

/** Ob `cell` gerade Teil des aktuellen Gegner-Pfads ist (User-Vorgabe: "es soll nicht möglich
 * sein, Gebäude jeglicher Art auf den Weg der Enemies zu stellen") — Spiegel sind die einzige
 * Ausnahme (siehe finalizePlacement()/finalizeMove()/finalizeTowerPlacement()/finalizeTowerMove()),
 * da sie den Pfad ohnehin nur umlenken statt ihn zu blockieren. */
function isOnEnemyPath(cell: GridCoord): boolean {
  return enemyPathCellKeySet.has(cellKey(cell))
}

function rebuildOccupancy() {
  occupancy = new Map()
  for (const b of [...lightSources, ...mirrors, ...prisms, ...towers]) occupancy.set(cellKey({ col: b.col, row: b.row }), b.id)
}

/** Licht-Simulation: der aktuelle Gegner-Pfad (`enemyPathCells`) blockiert Strahlen genau wie ein
 * Gebäude (User-Vorgabe: "die farbverbindungen sollen vom weg der enemies geblockt werden und
 * nicht anders herum") — Spiegel-Zellen bleiben davon ausgenommen (siehe simulateLight()), da der
 * Pfad durch sie hindurch umgelenkt wird, genau wie Licht. Muss NACH recomputeEnemyPath()
 * aufgerufen werden, damit `enemyPathCells` aktuell ist. */
function recomputeLightSimulation() {
  lightSimulation = simulateLight(placementGrid, lightSources, mirrors, prisms, towers, enemyPathCells)
}

/** Gegner-Pfad: strahlt ab dem festen Endpunkt-Stein (`endpointNode()`) los, statt wie zuvor vom
 * Spawn (User-Vorgabe: "die Linie wird vom Endpunkt und nicht vom Startpunkt erzeugt"). Spiegel
 * lenken um, JEDES andere Gebäude (Lichtquelle/Prisma/Turm) beendet den Pfad dort — Lichtstrahlen
 * selbst blockieren den Pfad NICHT (umgekehrt: der Pfad blockiert SIE, siehe
 * recomputeLightSimulation()). Das Ergebnis wird anschließend umgedreht: `traceDefensePath()`
 * liefert die Zellkette vom Stein WEG, aber Gegner sollen ja ZUM Stein laufen — nach dem Reverse
 * ist `enemyPathPixels[0]` die dynamische Einlauf-Stelle (progress 0) und das letzte Element der
 * feste Stein (progress 1), identisch zum bisherigen "0 = Spawn, 1 = Basis"-Vertrag (siehe
 * towerdefense/path.ts). Muss nach JEDER Änderung an Spiegeln/Lichtquellen/Prismen/Türmen neu
 * aufgerufen werden (danach immer auch recomputeLightSimulation(), damit Strahlen den NEUEN Pfad
 * berücksichtigen). */
function recomputeEnemyPath() {
  const blockers = [...lightSources, ...prisms, ...towers].map((b) => ({ id: b.id, col: b.col, row: b.row }))
  const lookup = buildDefenseLookup(mirrors, blockers)
  const maxSteps = (placementGrid.cols + placementGrid.rows) * 4 // Sicherheitsbremse gg. Spiegel-Endlosschleife
  const { cells, hitBlockerId } = traceDefensePath(placementGrid, lookup, endpointNode(), endpointDirection, maxSteps)
  enemyPathCells = [...cells].reverse()
  enemyPathCellKeySet = new Set(enemyPathCells.map((c) => cellKey(c)))
  enemyPathPixels = enemyPathCells.map((c) => cellCenter(placementGrid, c))
  enemyPathLength = pathTotalLength(enemyPathPixels)
  pathHitBlockerId = hitBlockerId
  recomputeLightSimulation() // Strahlen müssen den ggf. geänderten Pfad sofort als Blocker sehen
}

function buildingCenter(b: { col: number; row: number }) {
  return cellCenter(placementGrid, { col: b.col, row: b.row })
}

/** Gültige Zelle fürs Platzieren/Verschieben irgendeines Gebäudes/Spiegels/Turms — frei ODER vom
 * gezogenen Gebäude selbst (`ignoreId`) belegt. Ein Tausch (siehe finalizeMove()) entscheidet sich
 * NICHT hier, sondern beim Aufrufer (dieser Check lässt jede belegte Zelle als "gültiges Ziel"
 * durch, `ignoreId` betrifft nur das Sonderfall "eigene alte Zelle"). */
function canPlaceAt(cell: GridCoord): boolean {
  return inBounds(placementGrid, cell)
}

function buildWorld() {
  const cellSize = 34
  placementGrid = { cols: 6, rows: 6, cellSize, originX: 0, originY: HUD_HEIGHT + 120 }
  // User-Vorgabe: der Endpunkt-Stein soll exakt mit dem Kauf-Leisten-Trennstrich fluchten, beide
  // exakt bildschirmmittig — NICHT die Rasterbox selbst zentrieren (das wäre ein anderer Punkt,
  // siehe endpointNode()-Kommentar: `endpointX = originX + hexColumnWidth*cols/2`, aufgelöst nach
  // `originX`). Das Raster selbst verschiebt sich dadurch minimal (~1/4 Spaltenbreite) mit.
  placementGrid.originX = width / 2 - hexColumnWidth(placementGrid) * (placementGrid.cols / 2)

  // User-Vorgabe: feste Startaufstellung nach exakter Zellen-Vorgabe (0-indiziert: Zeile1 ->
  // row0, Spalte1 -> col0):
  //   Reihe1: leer, Cyan-Generator(col1), Rapid-Turm(col2), leer, leer, leer
  //   Reihe2: Spiegel(col0), Dreieck-Prisma(col1), leer, leer, leer, leer
  //   Reihe3: leer, Yellow-Generator(col1), leer, Pulse-Turm(col3), leer, leer
  // Cyan strahlt (wie jede Lichtquelle gleichzeitig in alle 6 Richtungen) sowohl direkt in den
  // Rapid-Turm als auch direkt ins Prisma (2 verschiedene der 6 Richtungen) — der Spiegel liegt
  // ebenfalls auf einer von Cyans Richtungen, sein umgelenkter Strahl trifft dabei zufällig auf
  // keine gültige Prisma-Ecke (rein dekorativ, zeigt "Verbindung ohne Ziel" halbtransparent).
  // Yellow strahlt direkt ins Prisma UND (2 Zellen weiter in derselben Richtung) in den
  // Pulse-Turm. Prisma-Anker bleibt beim Default (0) stehen — Cyans und Yellows direkte Ecken
  // (2 bzw. 4) liegen beide im selben Ecken-Set {0,2,4}, das Rezept Cyan+Yellow=Green löst also auf.
  lightSources = [createLightSource(1, 0, 'cyan'), createLightSource(1, 2, 'yellow')]
  mirrors = [createMirror(0, 1)]
  prisms = [createPrism(1, 1, 'triangle')]
  towers = [createTower(nextTowerId(), 'rapid', 2, 0), createTower(nextTowerId(), 'pulse', 3, 2)]
  enemies = []
  waveState = createWaveState()

  rebuildOccupancy()
  worldReady = true
  recomputeEnemyPath() // ruft am Ende auch recomputeLightSimulation() auf (siehe dort)
}

/** Erweitert das gemeinsame Raster (User-Vorgabe: "6x6 starten, bis 20x20 — pro Kauf 1 Spalte
 * LINKS + 1 Spalte RECHTS + 2 Zeilen UNTEN. Ab 20x20 nur noch 1 Zeile unten dran, Breite bleibt
 * bei 20 begrenzt, nach unten nicht"). Die neue Spalte RECHTS + die 2 neuen Zeilen UNTEN brauchen
 * keine Anpassung (höhere Indizes sind ohnehin frei) — die neue Spalte LINKS dagegen verschiebt
 * JEDES bestehende Gebäude um genau 1 Spalte nach rechts (`col += 1`), kompensiert durch
 * `originX -= hexColumnWidth(...)`, damit sich keine einzige Gebäude-Pixelposition ändert (User-
 * Vorgabe aus der letzten Runde: "die Gebäude rutschen nach außen" sollte NICHT mehr passieren). */
function expandGrid() {
  if (!canAfford(inventory, 'prisma', GRID_EXPAND_COST)) return
  spend(inventory, 'prisma', GRID_EXPAND_COST)
  if (placementGrid.cols < 20) {
    placementGrid = { ...placementGrid, cols: Math.min(20, placementGrid.cols + 2), rows: Math.min(20, placementGrid.rows + 2) }
    placementGrid.originX -= hexColumnWidth(placementGrid)
    for (const b of [...lightSources, ...mirrors, ...prisms, ...towers]) b.col += 1
    rebuildOccupancy()
  } else {
    placementGrid = { ...placementGrid, rows: placementGrid.rows + 1 }
  }
  // Der Pfad kann bisher an der jetzt verschobenen Wand geendet haben — mit mehr Platz läuft er
  // ggf. weiter, bis er ein Hindernis trifft oder die NEUE (weiter entfernte) Wand erreicht.
  recomputeEnemyPath()
}

// Kampf-Simulation: Gegner spawnen wellenweise (siehe towerdefense/waves.ts — 20 Gegner/Welle, 5s
// Pause danach (10s nach einer Boss-Welle), jede Welle stärker, Boss alle 10 Wellen, Wellen laufen
// immer vorwärts), Türme feuern automatisch auf Gegner in Reichweite (siehe towerdefense/
// combat.ts). Munition kommt direkt aus der Licht-Simulation (siehe economyTick()) — kein
// globaler Ratenpool, keine manuelle Auswahl mehr.
let enemies: Enemy[] = []
let projectiles: Projectile[] = []
let visualEffects: VisualEffect[] = []
let waveState: WaveState = createWaveState()
/** Schaden je Turm-Konfiguration (Turmart + Munitionsfarbe, siehe towerdefense/towers.ts
 * loadoutKey()) NUR für die aktuell laufende Welle (User-Vorgabe, Referenzbild: "TOWER DAMAGE
 * (THIS WAVE)") — wird bei jedem Wellenwechsel geleert (siehe combatTick(), tickWaveSpawning()
 * gibt bei einem Wellenwechsel `true` zurück). */
let damageByLoadout = new Map<string, number>()
const LUMEN_PER_KILL = 2

// Basis-HP (User-Vorgabe, ersetzt die frühere "Welle nicht geschafft -> 5 Wellen zurück"-Mechanik
// komplett): jeder durchgekommene Gegner zieht HP ab (Boss deutlich mehr), Wellen laufen dabei
// immer normal weiter. Bei 0 HP: kurzer Hinweis, dann weicher Reset auf Welle 1 mit voller HP
// (siehe softResetRun()) — Gebäude/Türme/Lumen/Prisma-Bestand bleiben dabei erhalten.
const BASE_MAX_HP = 30
const DAMAGE_PER_LEAK = 1
const DAMAGE_PER_BOSS_LEAK = 5
let baseHp = BASE_MAX_HP
/** Wie viele Gegner der aktuellen Welle bereits "erledigt" sind (getötet ODER durchgekommen) —
 * für die "N remaining"-Anzeige im HUD (siehe drawRightSidebar()), zusammen mit
 * `waveState.totalInWave`. Wird bei jedem Wellenwechsel wie `damageByLoadout` geleert. */
let enemiesResolvedInWave = 0
/** Kurzer, nicht-blockierender Hinweis nach einem Basis-HP-Reset (siehe softResetRun()) — läuft
 * einfach nach ein paar Sekunden ab, kein Klick zum Schließen nötig. */
let baseDestroyedMessageUntil = 0

/** Weicher Reset nach 0 Basis-HP (User-Vorgabe: "Reset auf Welle 1 ... Gebäude/Türme UND Lumen/
 * Prisma-Bestand bleiben erhalten, nur der Wellen-Fortschritt setzt zurück") — rührt bewusst
 * NICHT an lightSources/mirrors/prisms/towers/inventory. Kein Neu-Berechnen von Pfad/Licht nötig,
 * die hängen nur an Gebäuden+Raster, nicht an enemies/Wellenstand. */
function softResetRun() {
  waveState = createWaveState()
  enemies = []
  projectiles = []
  visualEffects = []
  damageByLoadout = new Map()
  enemiesResolvedInWave = 0
  baseHp = BASE_MAX_HP
  baseDestroyedMessageUntil = elapsedSeconds + 3
}

// Vertikales Scrollen (User-Vorgabe: "ich muss mit dem Mausrad hoch und runter scrollen können,
// wenn das Feld größer wird als der Bildschirm") — das Raster kann nach unten unbegrenzt wachsen
// (siehe expandGrid()), der Canvas aber nicht. `cameraOffsetY` verschiebt nur die RENDER-/HIT-TEST-
// Sicht auf die "Welt" (Raster/Gebäude/Pfad/Gegner) nach unten, während Kauf-Leiste/HUD/Modals
// (bildschirmfest) unverändert bleiben — siehe render() (ctx.translate) und worldPointerPos().
let cameraOffsetY = 0
const BOTTOM_SCROLL_MARGIN = 150

function maxScrollY(): number {
  return Math.max(0, placementGrid.originY + gridPixelHeight(placementGrid) + BOTTOM_SCROLL_MARGIN - height)
}

function resize() {
  const dpr = window.devicePixelRatio || 1
  width = window.innerWidth
  height = window.innerHeight
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
  buildScene()
  if (!worldReady) buildWorld()
  cameraOffsetY = Math.max(0, Math.min(maxScrollY(), cameraOffsetY))
}

window.addEventListener('resize', resize)
resize()

canvas.addEventListener(
  'wheel',
  (e) => {
    const pos = pointerPos(e)
    const sidebar = leftSidebarListBounds()
    // User-Vorgabe: Farb-Guide links soll ebenfalls scrollbar sein — übers Mausrad, exakt wie das
    // Raster, nur mit eigenem Offset (leftSidebarScrollY) und nur, solange der Zeiger über der
    // Seitenleiste steht; sonst wie gehabt das Raster scrollen (cameraOffsetY).
    if (pos.x >= sidebar.x && pos.x <= sidebar.x + sidebar.width && pos.y >= sidebar.y && pos.y <= sidebar.y + sidebar.height) {
      leftSidebarScrollY = Math.max(0, Math.min(leftSidebarMaxScroll, leftSidebarScrollY + e.deltaY))
    } else {
      cameraOffsetY = Math.max(0, Math.min(maxScrollY(), cameraOffsetY + e.deltaY))
    }
    e.preventDefault()
  },
  { passive: false },
)

// --- Interaktion ---
// Lichtquelle/Prisma/Turm halten+ziehen = verschieben, kurz antippen = Info-Panel. Spiegel
// antippen dreht ihn sofort (kein Info-Panel dafür, siehe User-Vorgabe) — halten+ziehen verschiebt
// ihn trotzdem. Der Endpunkt-Stein ist dagegen fix positioniert (kein Ziehen) — ein Antippen dreht
// direkt seine Abstrahlrichtung. Kauf-Leiste anfassen = neues Gebäude ziehen und aufs Raster
// fallen lassen (kostet Lumen) bzw. Raster erweitern (kostet Prisma, sofortige Aktion statt Drag).

/** Bildschirm-Koordinaten (für HUD/Kauf-Leiste/Modals, die beim Scrollen fest stehen bleiben). */
function pointerPos(e: { clientX: number; clientY: number }): Point {
  const rect = canvas.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

/** "Welt"-Koordinaten (für alles auf dem Raster: Gebäude/Türme/Endpunkt/Platzieren/Verschieben) —
 * dieselbe Umrechnung wie render()s ctx.translate(0, -cameraOffsetY), nur umgekehrt. */
function worldPointerPos(e: PointerEvent): Point {
  const pos = pointerPos(e)
  return { x: pos.x, y: pos.y + cameraOffsetY }
}

interface EconomyHit {
  kind: 'source' | 'mirror' | 'prism'
  id: string
}

function hitTestEconomyBuilding(x: number, y: number): EconomyHit | null {
  for (const source of lightSources) {
    if (Math.hypot(buildingCenter(source).x - x, buildingCenter(source).y - y) <= sourceOuterRadius(source) + 6) return { kind: 'source', id: source.id }
  }
  for (const mirror of mirrors) {
    if (Math.hypot(buildingCenter(mirror).x - x, buildingCenter(mirror).y - y) <= placementGrid.cellSize * 0.45) return { kind: 'mirror', id: mirror.id }
  }
  for (const prism of prisms) {
    if (Math.hypot(buildingCenter(prism).x - x, buildingCenter(prism).y - y) <= prismSize(prism) + 6) return { kind: 'prism', id: prism.id }
  }
  return null
}

function towerCenter(tower: PlacedTower) {
  return cellCenter(placementGrid, { col: tower.col, row: tower.row })
}

function hitTestTower(x: number, y: number): PlacedTower | null {
  return towers.find((t) => Math.hypot(towerCenter(t).x - x, towerCenter(t).y - y) <= TOWER_ICON_SIZE + 6) ?? null
}

/** Endpunkt-Stein anfassen — anders als früher beim Spawn kein Halten+Ziehen mehr (er ist fix
 * positioniert, siehe endpointNode()), ein Klick dreht direkt seine Abstrahlrichtung (wie ein
 * Prisma), ohne den pendingPress-Umweg über Klick-vs-Ziehen. */
function hitTestEndpoint(x: number, y: number): boolean {
  const center = cellCenter(placementGrid, endpointNode())
  return Math.hypot(center.x - x, center.y - y) <= 20
}

/** Löscht ein Gebäude (Lichtquelle/Spiegel/Prisma) und erstattet seinen Lumen-Baukosten zurück
 * (User-Wunsch) — jedes davon kann den Gegner-Pfad blockiert haben, daher immer beide Neu-
 * Berechnungen (Belegung + Pfad) danach. */
function demolishEconomyBuilding(hit: EconomyHit) {
  if (hit.kind === 'source') {
    lightSources = lightSources.filter((s) => s.id !== hit.id)
    addToInventory(inventory, 'lumen', BUILDING_COSTS.source)
  } else if (hit.kind === 'mirror') {
    mirrors = mirrors.filter((m) => m.id !== hit.id)
    addToInventory(inventory, 'lumen', BUILDING_COSTS.mirror)
  } else {
    const prism = prisms.find((p) => p.id === hit.id)
    prisms = prisms.filter((p) => p.id !== hit.id)
    if (prism) addToInventory(inventory, 'lumen', prism.prismKind === 'triangle' ? BUILDING_COSTS.prismSimple : BUILDING_COSTS.prismComplex)
  }
  rebuildOccupancy()
  recomputeEnemyPath()
  if (infoTarget && infoTarget.kind !== 'empty' && infoTarget.id === hit.id) infoTarget = null
}

/** Levelt das Gebäude/den Turm hinter `target` um 1 hoch, sofern noch nicht maximal und die
 * Lumen-Kosten (siehe economy/buildings.ts generatorUpgradeCost()/towerdefense/towers.ts
 * towerUpgradeCost()) bezahlt werden können — ausgelöst durch Klick auf die "Level"-Zeile im
 * Info-Panel (siehe pointerdown). Prismen/Spiegel haben kein Level und daher auch kein Info-Panel
 * — Klick dreht sie stattdessen (siehe pendingPress-Logik). */
function attemptLevelUp(target: InfoTarget) {
  if (target.kind === 'empty') return // leere Zelle hat nichts zum Hochleveln
  if (target.kind === 'source') {
    const source = lightSources.find((s) => s.id === target.id)
    if (!source || source.level >= GENERATOR_MAX_LEVEL) return
    const cost = generatorUpgradeCost(source.level + 1)
    if (!canAfford(inventory, 'lumen', cost)) return
    spend(inventory, 'lumen', cost)
    upgradeLightSource(source)
  } else {
    const tower = towers.find((t) => t.id === target.id)
    if (!tower || tower.level >= TOWER_MAX_LEVEL) return
    const cost = towerUpgradeCost(getTowerDefinition(tower.kind), tower.level + 1)
    if (!canAfford(inventory, 'lumen', cost)) return
    spend(inventory, 'lumen', cost)
    tower.level += 1
  }
}

/** "SELL"-Knopf der Seitenleisten-Auswahlkarte (siehe drawRightSidebar()) — dispatcht auf die
 * jeweils passende, schon vorhandene Abriss-Funktion. Spiegel/Prismen haben nie ein `infoTarget`
 * (sie drehen sich stattdessen per Klick, siehe pointerup), brauchen hier also keinen Zweig. */
function sellSelected(target: InfoTarget) {
  if (target.kind === 'empty') return // leere Zelle hat nichts zum Verkaufen
  if (target.kind === 'source') {
    demolishEconomyBuilding({ kind: 'source', id: target.id })
  } else {
    const tower = towers.find((t) => t.id === target.id)
    if (tower) demolishTower(tower)
  }
}

/** Löscht einen Turm und erstattet seinen Lumen-Baukosten zurück (User-Wunsch). */
function demolishTower(tower: PlacedTower) {
  towers = towers.filter((t) => t.id !== tower.id)
  addToInventory(inventory, 'lumen', getTowerDefinition(tower.kind).cost)
  rebuildOccupancy()
  recomputeEnemyPath()
  if (infoTarget && infoTarget.kind !== 'empty' && infoTarget.id === tower.id) infoTarget = null
}

let placingNewKind: PaletteKind | null = null
let placingCursor: Point | null = null
let hoveredEconomyItem: PaletteItem | null = null
let hoveredTowerItem: TowerPaletteItem | null = null
let movingBuildingId: string | null = null
let movingKind: 'source' | 'mirror' | 'prism' | 'tower' | null = null
let movingCursor: Point | null = null

function handleHudButton(id: HudButton['id']) {
  if (id === 'cheat') cheatAddHundredToAll(inventory)
  else if (id === 'demolish') demolishMode = !demolishMode
  else if (id === 'pause') gamePaused = !gamePaused
  // 'settings', 'save' und 'menu': absichtlich ohne Funktion (User-Wunsch — noch keine Logik dahinter).
}

canvas.addEventListener('pointerdown', (e) => {
  const pos = pointerPos(e)
  const worldPos = worldPointerPos(e)

  // Tutorial-Popup blockiert alles andere, solange offen (nur beim allerersten Start).
  if (welcomeOpen) {
    if (hitTestReferencePanelClose(width, height, pos.x, pos.y)) {
      welcomeOpen = false
      markTutorialSeen()
    }
    return
  }

  const button = hudButtons.find((b) => hitTestButton(b, pos.x, pos.y))
  if (button) {
    handleHudButton(button.id)
    return
  }

  // "SELECTED TOWER/SOURCE"-Karte in der rechten Seitenleiste (User-Vorgabe, Referenzbild) — löst
  // NICHT mehr alle anderen Interaktionen aus (anders als das frühere schwebende Info-Panel):
  // Bauen/Platzieren/Scrollen bleiben möglich, solange etwas ausgewählt ist.
  const sidebarButton = sidebarButtons.find((b) => hitTestButton(b, pos.x, pos.y))
  if (sidebarButton) {
    if (infoTarget) {
      if (sidebarButton.id === 'upgrade') attemptLevelUp(infoTarget)
      else if (sidebarButton.id === 'sell') sellSelected(infoTarget)
      else if (sidebarButton.id === 'close') infoTarget = null
    }
    return
  }

  const paletteItem = hitTestPalette(paletteItems, pos.x, pos.y)
  if (paletteItem) {
    // Grid-Erweiterung ist wie ihr früheres Pendant auf der Turm-Seite eine sofortige Aktion,
    // kein Ziehen-aufs-Raster (siehe PaletteItem-Kommentar in render/buildingRender.ts).
    if (paletteItem.kind === 'expand-grid') expandGrid()
    else {
      placingNewKind = paletteItem.kind
      placingCursor = worldPos
    }
    return
  }

  const towerPaletteItem = hitTestTowerPalette(towerPaletteItems, pos.x, pos.y)
  if (towerPaletteItem) {
    placingTowerKind = towerPaletteItem.kind
    placingTowerCursor = worldPos
    return
  }

  const existingTower = hitTestTower(worldPos.x, worldPos.y)
  if (existingTower) {
    if (demolishMode) {
      demolishTower(existingTower)
      return
    }
    pendingPress = { kind: 'tower', id: existingTower.id, downPos: worldPos }
    return
  }

  if (hitTestEndpoint(worldPos.x, worldPos.y)) {
    // Kein Halten+Ziehen und kein Abriss für den Endpunkt-Stein (fix positioniert, immer genau 1)
    // — ein Klick dreht direkt seine Abstrahlrichtung, ohne den pendingPress-Umweg.
    endpointDirection = nextValidEndpointDirection(endpointDirection)
    recomputeEnemyPath()
    return
  }

  const economyHit = hitTestEconomyBuilding(worldPos.x, worldPos.y)
  if (economyHit) {
    if (demolishMode) {
      demolishEconomyBuilding(economyHit)
      return
    }
    pendingPress = { kind: economyHit.kind, id: economyHit.id, downPos: worldPos }
    return
  }

  // User-Vorgabe: "ich möchte auch leere Felder auswählen können" — trifft der Klick keine der
  // obigen Interaktionen (Button/Leiste/Turm/Endpunkt/Gebäude), aber eine gültige (leere)
  // Rasterzelle, wird DIE ausgewählt (mit Info, dass sie leer ist, siehe selectedRows()). Nicht im
  // Abriss-Modus (da gäbe es ohnehin nichts abzureißen, ein Klick soll dort nicht versehentlich
  // eine Auswahl auslösen).
  if (!demolishMode) {
    const cell = cellAtPoint(placementGrid, worldPos.x, worldPos.y)
    if (cell) infoTarget = { kind: 'empty', col: cell.col, row: cell.row }
  }
})

canvas.addEventListener('pointermove', (e) => {
  const pos = pointerPos(e)
  const worldPos = worldPointerPos(e)
  if (welcomeOpen) return

  hoveredEconomyItem = hitTestPalette(paletteItems, pos.x, pos.y)
  hoveredTowerItem = hitTestTowerPalette(towerPaletteItems, pos.x, pos.y)

  if (pendingPress) {
    const dist = Math.hypot(worldPos.x - pendingPress.downPos.x, worldPos.y - pendingPress.downPos.y)
    if (dist > PRESS_MOVE_THRESHOLD) {
      // Genug bewegt -> jetzt erst als Ziehen (Verschieben) werten, nicht als Klick.
      movingBuildingId = pendingPress.id
      movingKind = pendingPress.kind
      movingCursor = worldPos
      pendingPress = null
    }
  }

  if (placingNewKind) placingCursor = worldPos
  if (movingBuildingId) movingCursor = worldPos
  if (placingTowerKind) placingTowerCursor = worldPos
})

/** Bug-Fix (User-Report): stand `infoTarget` auf `{kind:'empty', col, row}` und genau DIESE Zelle
 * bekommt jetzt ein Gebäude (Neubau, Verschieben ODER Tausch) — die SELECTED-Karte zeigte bis
 * eben weiter "Empty Cell", obwohl längst etwas dort steht. Aktualisiert die Auswahl auf das neue
 * Ziel (bzw. löscht sie, wenn dort ein Mirror/Prisma landet — die haben nie ein `infoTarget`). Ein
 * Selektions-Stand für eine ANDERE Zelle bleibt unangetastet. */
function updateInfoTargetForCell(col: number, row: number, next: InfoTarget | null) {
  if (infoTarget && infoTarget.kind === 'empty' && infoTarget.col === col && infoTarget.row === row) infoTarget = next
}

function finalizePlacement(pos: Point) {
  const kind = placingNewKind
  if (!kind) return
  const cell = cellAtPoint(placementGrid, pos.x, pos.y)
  if (!cell || occupancy.has(cellKey(cell))) return
  // User-Vorgabe: "es soll nicht möglich sein, Gebäude jeglicher Art auf den Weg der Enemies zu
  // stellen, diese sollen blockiert werden, lediglich Mirrors können dort platziert werden" — der
  // Pfad selbst lenkt Spiegel schon um (siehe recomputeEnemyPath()), sie sind also die einzige
  // Ausnahme. Ein frisch platzierter Spiegel AUF dem (alten) Pfad pausiert danach automatisch das
  // Spiel (siehe unten) — muss der Spieler bewusst per Klick auf den Pause/Play-Button wieder
  // aufheben ("ich muss manuell wieder auf Start drücken").
  const onPath = isOnEnemyPath(cell)
  if (onPath && kind !== 'mirror') return

  if (kind === 'mirror') {
    if (!canAfford(inventory, 'lumen', BUILDING_COSTS.mirror)) return
    spend(inventory, 'lumen', BUILDING_COSTS.mirror)
    mirrors.push(createMirror(cell.col, cell.row))
    updateInfoTargetForCell(cell.col, cell.row, null)
  } else if (kind === 'prism-simple' || kind === 'prism-complex') {
    const cost = kind === 'prism-simple' ? BUILDING_COSTS.prismSimple : BUILDING_COSTS.prismComplex
    if (!canAfford(inventory, 'lumen', cost)) return
    spend(inventory, 'lumen', cost)
    prisms.push(createPrism(cell.col, cell.row, kind === 'prism-simple' ? 'triangle' : 'hexagon'))
    updateInfoTargetForCell(cell.col, cell.row, null)
  } else {
    const resourceId = sourceResourceIdForPalette(kind)
    if (!resourceId) return
    if (!canAfford(inventory, 'lumen', BUILDING_COSTS.source)) return
    spend(inventory, 'lumen', BUILDING_COSTS.source)
    const source = createLightSource(cell.col, cell.row, resourceId)
    lightSources.push(source)
    updateInfoTargetForCell(cell.col, cell.row, { kind: 'source', id: source.id })
  }
  rebuildOccupancy()
  recomputeEnemyPath()
  if (onPath && kind === 'mirror') gamePaused = true
}

/** Irgendein Lichtquelle/Spiegel/Prisma (unabhängig vom Typ) anhand seiner Id finden — fürs
 * generische Verschieben/Tauschen, das nicht wissen muss, in welchem der 3 Arrays es steckt. */
function findEconomyBuilding(id: string): { col: number; row: number } | null {
  return lightSources.find((s) => s.id === id) ?? mirrors.find((m) => m.id === id) ?? prisms.find((p) => p.id === id) ?? null
}

/** Kein explizites Neu-Routen der Licht-Simulation nötig — die wird jeden Frame komplett neu aus
 * den aktuellen Positionen berechnet (siehe recomputeLightSimulation()), verschobene Bauwerke
 * wirken sich also automatisch auf den nächsten Frame aus. Der Gegner-Pfad dagegen wird NUR bei
 * Bedarf neu verfolgt (siehe recomputeEnemyPath()) — jedes dieser 3 Gebäude kann ihn blockieren.
 *
 * Ziel-Zelle bereits belegt (durch ein ANDERES Gebäude als das gezogene) -> statt die Bewegung
 * abzulehnen, werden beide Gebäude getauscht (User-Wunsch: "Gebäude aufeinander ziehen und
 * loslassen tauscht sie"). */
function finalizeMove(pos: Point) {
  const cell = cellAtPoint(placementGrid, pos.x, pos.y)
  if (!cell || !movingBuildingId) return
  const moving = findEconomyBuilding(movingBuildingId)
  if (!moving) return
  // Dieselbe Pfad-Sperre wie beim Neu-Platzieren (siehe finalizePlacement()) — gilt auch fürs
  // Verschieben eines bestehenden Gebäudes, sonst wäre "woanders bauen, dann auf den Pfad ziehen"
  // ein Schlupfloch. `movingKind` verfolgt main.ts pointerdown/pointermove bereits mit.
  const onPath = isOnEnemyPath(cell)
  if (onPath && movingKind !== 'mirror') return

  const occupantId = occupancy.get(cellKey(cell))
  // Bug-Fix (User-Report): ein Tausch mit einem Spiegel, der GERADE auf dem Pfad steht, konnte den
  // Tausch-Partner unbemerkt auf dessen (alten) Pfad-Platz setzen — der obige Check prüft nur das
  // Ziel-Feld (`cell`), nicht die alte Zelle des gezogenen Gebäudes, auf der nach einem Tausch der
  // PARTNER landet. Kein Blockieren mehr dafür (User-Vorgabe): stattdessen pausiert das genauso wie
  // eine direkte Spiegel-Platzierung auf dem Pfad.
  const originalCol = moving.col
  const originalRow = moving.row
  let otherId: string | null = null
  if (occupantId && occupantId !== movingBuildingId) {
    const other = findEconomyBuilding(occupantId) ?? towers.find((t) => t.id === occupantId)
    if (!other) return
    moving.col = other.col
    moving.row = other.row
    other.col = originalCol
    other.row = originalRow
    otherId = occupantId
  } else {
    moving.col = cell.col
    moving.row = cell.row
  }
  rebuildOccupancy()
  recomputeEnemyPath()
  if (onPath && movingKind === 'mirror') gamePaused = true
  if (otherId && !mirrors.some((m) => m.id === otherId) && isOnEnemyPath({ col: originalCol, row: originalRow })) gamePaused = true

  if (movingKind === 'source') updateInfoTargetForCell(cell.col, cell.row, { kind: 'source', id: movingBuildingId })
  else if (movingKind === 'mirror' || movingKind === 'prism') updateInfoTargetForCell(cell.col, cell.row, null)
}

/** Turm verschieben: snapt auf den nächsten freien Knotenpunkt (oder tauscht mit dessen Besitzer,
 * siehe finalizeMove() — dieselbe Logik gilt jetzt einheitlich für jeden Gebäudetyp). Ungültiges
 * Ziel (außerhalb des Rasters) -> Turm bleibt an alter Position. */
function finalizeTowerMove(pos: Point) {
  const tower = towers.find((t) => t.id === movingBuildingId)
  if (!tower) return
  const cell = nearestCell(placementGrid, pos.x, pos.y)
  // Türme dürfen NIE auf den Gegner-Pfad — anders als Mirror keine Ausnahme (siehe isOnEnemyPath()).
  if (!canPlaceAt(cell) || isOnEnemyPath(cell)) return

  const occupantId = occupancy.get(cellKey(cell))
  if (occupantId && occupantId !== tower.id) {
    const other = findEconomyBuilding(occupantId) ?? towers.find((t) => t.id === occupantId)
    if (other) {
      const originalCol = tower.col
      const originalRow = tower.row
      tower.col = other.col
      tower.row = other.row
      other.col = originalCol
      other.row = originalRow
    }
  } else if (!occupantId) {
    tower.col = cell.col
    tower.row = cell.row
  }
  rebuildOccupancy()
  recomputeEnemyPath()
  updateInfoTargetForCell(cell.col, cell.row, { kind: 'tower', id: tower.id })
}

function finalizeTowerPlacement(pos: Point) {
  const kind = placingTowerKind
  if (!kind) return
  const cell = nearestCell(placementGrid, pos.x, pos.y)
  // Türme dürfen NIE auf den Gegner-Pfad — anders als Mirror keine Ausnahme (siehe isOnEnemyPath()).
  if (!canPlaceAt(cell) || occupancy.has(cellKey(cell)) || isOnEnemyPath(cell)) return

  const def = getTowerDefinition(kind)
  if (!canAfford(inventory, 'lumen', def.cost)) return
  spend(inventory, 'lumen', def.cost)
  const tower = createTower(nextTowerId(), kind, cell.col, cell.row)
  towers.push(tower)
  rebuildOccupancy()
  recomputeEnemyPath()
  updateInfoTargetForCell(cell.col, cell.row, { kind: 'tower', id: tower.id })
}

window.addEventListener('pointerup', (e) => {
  const pos = worldPointerPos(e)

  if (placingNewKind) {
    finalizePlacement(pos)
    placingNewKind = null
    placingCursor = null
  }

  if (movingBuildingId) {
    if (movingKind === 'tower') finalizeTowerMove(pos)
    else finalizeMove(pos)
    movingBuildingId = null
    movingKind = null
    movingCursor = null
  }

  if (placingTowerKind) {
    finalizeTowerPlacement(pos)
    placingTowerKind = null
    placingTowerCursor = null
  }

  if (pendingPress) {
    // Nie über die Bewegungsschwelle hinaus gezogen -> war ein Klick, kein Ziehen. Bei einem
    // Spiegel ODER einem Prisma dreht ein Klick es direkt (User-Vorgabe: "Prismen müssen auch
    // gedreht werden können, wie Spiegel") statt ein Info-Panel zu öffnen. Ein Spiegel dreht sowohl
    // Licht- als auch Gegner-Pfad-Richtung (dieselben Objekte, siehe recomputeEnemyPath()).
    if (pendingPress.kind === 'mirror') {
      const mirror = mirrors.find((m) => m.id === pendingPress!.id)
      if (mirror) {
        rotateMirror(mirror)
        recomputeEnemyPath()
      }
    } else if (pendingPress.kind === 'prism') {
      const prism = prisms.find((p) => p.id === pendingPress!.id)
      if (prism) rotatePrism(prism)
    } else {
      infoTarget = { kind: pendingPress.kind, id: pendingPress.id }
    }
    pendingPress = null
  }
})

function drawEconomyPalette() {
  for (const item of paletteItems) {
    drawPaletteItem(ctx!, item, canAfford(inventory, item.costResourceId, item.cost))
  }
}

function drawTowerPalette() {
  for (const item of towerPaletteItems) {
    drawTowerPaletteItem(ctx!, item, canAfford(inventory, 'lumen', item.cost))
  }
}

/** Feiner Trennstrich zwischen Economy- (Generatoren/Prisma/Mirror/Grid) und Turm-Hälfte der
 * kombinierten Kauf-Leiste (User-Vorgabe: wieder wie früher) — mittig zwischen dem letzten
 * Economy- und dem ersten Turm-Icon, exakt in der Bildschirmmitte (siehe buildScene()). Spannt
 * etwas über die Kartenränder hinaus (Karten sind 30px über/44px unter `item.y`, siehe
 * render/buildingRender.ts paletteCardBounds()). */
function drawPaletteDivider() {
  const lastEconomy = paletteItems[paletteItems.length - 1]
  const firstTower = towerPaletteItems[0]
  if (!lastEconomy || !firstTower) return
  const x = (lastEconomy.x + lastEconomy.radius + (firstTower.x - firstTower.radius)) / 2
  ctx!.save()
  ctx!.strokeStyle = COLORS.gridLineStrong
  ctx!.lineWidth = 1
  ctx!.beginPath()
  ctx!.moveTo(x, PALETTE_ROW_Y - 34)
  ctx!.lineTo(x, PALETTE_ROW_Y + 48)
  ctx!.stroke()
  ctx!.restore()
}

/** Hover-Tooltip über einem Kauf-Leisten-Icon — Name + kurzer Zweck, siehe
 * paletteItemDescription()/towerPaletteItemDescription(). Nutzt denselben Chip-Look wie die
 * übrigen Panels (drawLabel(), aus shapes.ts). */
function drawPaletteTooltips() {
  // Sobald das Tutorial-Popup offen ist, aktualisiert pointermove hoveredEconomyItem/
  // hoveredTowerItem nicht mehr (siehe early return dort) — ohne diese Sperre würde sonst ein
  // stehen gebliebenes Tooltip sichtbar bleiben. Eine Auswahl (infoTarget) blockiert das
  // Tooltip-Hovern absichtlich NICHT mehr (User-Vorgabe: nicht-blockierende Auswahl).
  if (welcomeOpen) return
  if (hoveredEconomyItem) {
    const item = hoveredEconomyItem
    drawLabel(ctx!, paletteItemDescription(item.kind), item.x, item.y - item.radius - 14, '12px monospace', COLORS.textBright, 15)
  }
  if (hoveredTowerItem) {
    const item = hoveredTowerItem
    drawLabel(ctx!, `${item.name} — ${towerPaletteItemDescription(item.kind)}`, item.x, item.y - item.radius - 14, '12px monospace', COLORS.textBright, 15)
  }
}

function drawTowerPlacementPreview() {
  if (!placingTowerKind || !placingTowerCursor) return
  const cell = nearestCell(placementGrid, placingTowerCursor.x, placingTowerCursor.y)
  const center = cellCenter(placementGrid, cell)

  const valid = canPlaceAt(cell) && !occupancy.has(cellKey(cell)) && !isOnEnemyPath(cell)
  if (!valid) {
    ctx!.save()
    ctx!.globalAlpha = 0.35
    ctx!.fillStyle = '#ff3355'
    ctx!.beginPath()
    ctx!.arc(center.x, center.y, TOWER_ICON_SIZE + 10, 0, Math.PI * 2)
    ctx!.fill()
    ctx!.restore()
  }

  ctx!.save()
  ctx!.globalAlpha = 0.7
  drawTowerPreview(ctx!, placingTowerKind, center)
  ctx!.restore()
}

/** User-Vorgabe: deutlich stärkerer Kontrast zwischen aktiv/inaktiv als zuvor (0.4) — ein
 * unterversorgter Turm soll klar erkennbar "abgeschaltet" wirken. Gilt NUR für "verkabelt, aber zu
 * schwach versorgt" (starved) — ein UNVERKABELTER Turm feuert bewusst weiter mit voller Deckkraft
 * (siehe hasAmmoAvailable()-Kommentar: das ist die absichtliche "Klarschuss ohne Effekt"-Baseline,
 * kein Fehlerzustand). */
const INACTIVE_ALPHA = 0.18

function drawTowers() {
  for (const tower of towers) {
    const starved = tower.resourceId !== null && !hasAmmoAvailable(tower)
    if (starved) {
      ctx!.save()
      ctx!.globalAlpha = INACTIVE_ALPHA
    }
    const center = towerCenter(tower)
    drawTowerEntity(ctx!, tower, center)
    drawTowerLevelRing(ctx!, tower, center)
    if (starved) ctx!.restore()
  }
}

/** Zelle des aktuell ausgewählten Gebäudes/Turms/leeren Felds (siehe `infoTarget`), oder `null` —
 * Mirror/Prisma haben nie ein `infoTarget` (siehe sellSelected()-Kommentar), daher hier nicht
 * behandelt. */
function selectedCell(): GridCoord | null {
  if (!infoTarget) return null
  if (infoTarget.kind === 'empty') return { col: infoTarget.col, row: infoTarget.row }
  if (infoTarget.kind === 'source') {
    const sourceId = infoTarget.id
    const source = lightSources.find((s) => s.id === sourceId)
    return source ? { col: source.col, row: source.row } : null
  }
  const towerId = infoTarget.id
  const tower = towers.find((t) => t.id === towerId)
  return tower ? { col: tower.col, row: tower.row } : null
}

/** Roter Rahmen um die Zelle des ausgewählten Gebäudes/Turms (User-Vorgabe: "wenn ein Gebäude
 * ausgewählt ist, soll der Rahmen rot markiert werden") — nach den Gebäuden/Türmen selbst
 * gezeichnet, damit er sichtbar über ihnen liegt statt darunter verdeckt zu werden. */
function drawSelectionHighlight() {
  const cell = selectedCell()
  if (cell) drawSelectedCellMarker(ctx!, placementGrid, cell)
}

interface LoadoutSummaryEntry {
  kind: TowerKind
  resourceId: string
  count: number
  damage: number
}

/** Aktuell platzierte Türme, gruppiert nach Konfiguration (Turmart + Munitionsfarbe, siehe
 * towerdefense/towers.ts loadoutKey()) — EIN Eintrag je Konfiguration, unabhängig davon, wie
 * viele Türme genau dieser Art/Farbe gerade stehen (User-Vorgabe: "nur 1x pro Art"). Türme ohne
 * aktuelle Munition zählen nicht mit (haben noch keine "Konfiguration"). Sortiert nach Turmart
 * (Reihenfolge der Kauf-Leiste) dann Ressourcen-Tier, für eine stabile, nicht "springende"
 * Reihenfolge zwischen Frames. */
function currentLoadoutSummary(): LoadoutSummaryEntry[] {
  const byKey = new Map<string, LoadoutSummaryEntry>()
  for (const tower of towers) {
    if (!tower.resourceId) continue
    const key = loadoutKey(tower.kind, tower.resourceId)
    const existing = byKey.get(key)
    if (existing) existing.count += 1
    else byKey.set(key, { kind: tower.kind, resourceId: tower.resourceId, count: 1, damage: damageByLoadout.get(key) ?? 0 })
  }
  const kindOrder = TOWER_DEFINITIONS.map((d) => d.kind)
  const resourceOrder = RESOURCES.map((r) => r.id)
  return [...byKey.values()].sort((a, b) => {
    const kindDiff = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind)
    return kindDiff !== 0 ? kindDiff : resourceOrder.indexOf(a.resourceId) - resourceOrder.indexOf(b.resourceId)
  })
}

// User-Vorgabe: Farb-Guide + Turmregeln (immer sichtbar, kein Popup mehr) links vom Raster, Wave-/
// Boss-/Schadens-Infos (vormals oben rechts bzw. unter dem Raster) rechts vom Raster — beide
// Seitenleisten bildschirmfest (NICHT Teil von render()s Welt-ctx.translate), damit sie beim
// Scrollen des (ggf. sehr hohen) Rasters sichtbar bleiben. Horizontal an den aktuellen Rasterkanten
// verankert (originX bzw. originX+gridPixelWidth), wächst/schrumpft also mit dem Raster mit.
const SIDE_PANEL_WIDTH = 260
const SIDE_PANEL_MARGIN = 24
const SIDE_PANEL_TOP = HUD_HEIGHT + 120

const ALL_GUIDE_COLORS = RESOURCES.filter((r) => r.tier !== 'special')

// User-Vorgabe: "mach den Teil links... auch scrollbar" — der Farb-Guide ist mit allen 5 Tiers oft
// höher als der verfügbare Platz (siehe drawColorGuideList()s eigene "Sicherheitsbremse", die
// sonst einfach abschneidet). Eigenes Scroll-Offset + Mausrad-Handling (siehe canvas
// 'wheel'-Listener), unabhängig von `cameraOffsetY` (das Raster scrollt separat, siehe dort).
let leftSidebarScrollY = 0
let leftSidebarMaxScroll = 0

/** Bildschirm-Bounds des scrollbaren Farb-Guide-Bereichs (OHNE Titel/Unterzeile darüber) — sowohl
 * fürs Zeichnen (drawLeftSidebar()) als auch fürs Mausrad-Hittesting (siehe 'wheel'-Listener)
 * genutzt, damit beide garantiert dieselbe Fläche meinen. */
function leftSidebarListBounds() {
  const x = Math.max(16, placementGrid.originX - SIDE_PANEL_MARGIN - SIDE_PANEL_WIDTH)
  const y = SIDE_PANEL_TOP + 34
  const bottom = height - 20
  return { x, y, width: SIDE_PANEL_WIDTH, height: Math.max(0, bottom - y) }
}

/** Linke Seitenleiste: Farb-Guide, tier-gruppiert (Trennlinie + Tier-Label zwischen jeder
 * Tierklasse, User-Vorgabe), mit immer sichtbarer Rezept+Effekt-Beschreibung je Farbe (User-
 * Vorgabe: "ich will weiter die Beschreibung... links beschrieben haben") — keine Turmregeln mehr
 * ("brauche ich nicht"), der Farb-Guide hat dadurch den vollen Platz für sich. Jetzt scrollbar
 * (User-Vorgabe): eigener Clip-Bereich + `leftSidebarScrollY`-Versatz. `drawColorGuideList()`
 * bekommt bewusst eine praktisch unbegrenzte Höhe übergeben, damit SIE nicht mehr selbst
 * abschneidet — die eigentliche Begrenzung übernimmt der ctx-Clip hier, die zurückgegebene
 * Gesamthöhe dient nur noch der Scroll-Obergrenze. */
function drawLeftSidebar() {
  const bounds = leftSidebarListBounds()
  drawColorGuideSidebarTitle(ctx!, bounds.x, SIDE_PANEL_TOP)

  ctx!.save()
  ctx!.beginPath()
  ctx!.rect(bounds.x, bounds.y, bounds.width, bounds.height)
  ctx!.clip()
  ctx!.translate(0, -leftSidebarScrollY)
  const contentBottom = drawColorGuideList(ctx!, bounds.x, bounds.y, bounds.width, 100000, ALL_GUIDE_COLORS)
  ctx!.restore()

  leftSidebarMaxScroll = Math.max(0, contentBottom - bounds.y - bounds.height)
  leftSidebarScrollY = Math.min(leftSidebarScrollY, leftSidebarMaxScroll)
}

const CARD_PADDING = 14
const CARD_GAP = 14

/** Wave-Karte: Titel (+ Boss-Hinweis), Spawn-Fortschrittsbalken (füllt sich auch während der
 * Pause weiter, siehe Kommentar unten), "N remaining" mit Totenkopf-Symbol (User-Vorgabe,
 * Referenzbild) — `totalInWave - enemiesResolvedInWave` (getötet + durchgekommen seit Wellen-
 * beginn, siehe combatTick()), NICHT einfach `totalInWave - enemiesSpawnedInWave`, da bereits
 * gespawnte, aber noch lebende Gegner ja ebenfalls noch "übrig" sind — und, falls gerade ein Boss
 * lebt, dessen aktuelle Stacks (siehe towerdefense/enemies.ts activeStackCounts(), je Stack eine
 * eigene Zeile statt nebeneinander, die Spalte ist hier schmal). Gibt die Y-Position nach der
 * Karte zurück (Aufrufer reiht die nächste Karte direkt danach). */
function drawWaveCard(x: number, y: number): number {
  const bossEnemy = enemies.find((e) => e.isBoss)
  const stacks = bossEnemy ? activeStackCounts(bossEnemy, elapsedSeconds) : []
  const height = CARD_PADDING * 2 + 16 + 8 + 10 + 18 + stacks.length * 14
  drawCard(ctx!, x, y, SIDE_PANEL_WIDTH, height)
  let cursorY = y + CARD_PADDING + 12

  const boss = isBossWave(waveState.currentWave)
  ctx!.save()
  ctx!.textAlign = 'left'
  ctx!.textBaseline = 'alphabetic'
  ctx!.font = 'bold 14px monospace'
  ctx!.fillStyle = boss ? '#ffcc33' : COLORS.textBright
  ctx!.fillText(boss ? `WAVE ${waveState.currentWave} — BOSS` : `WAVE ${waveState.currentWave}`, x + CARD_PADDING, cursorY)
  cursorY += 20

  // Während des Spawnens: Anteil bereits gespawnter Gegner. Während der Pause: Anteil der
  // verstrichenen Pausenzeit (füllt sich also weiter Richtung "voll", statt einzufrieren) —
  // dieselbe Pausendauer wie towerdefense/waves.ts tickWaveSpawning() (Boss-Welle = länger).
  const pauseDuration = isBossWave(waveState.currentWave) ? BOSS_WAVE_PAUSE_SECONDS : WAVE_PAUSE_SECONDS
  const fraction =
    waveState.phase === 'spawning' ? waveState.enemiesSpawnedInWave / waveState.totalInWave : 1 - waveState.pauseTimer / pauseDuration
  drawProgressBar(ctx!, x + CARD_PADDING, cursorY, SIDE_PANEL_WIDTH - CARD_PADDING * 2, 8, fraction, COLORS.accent)
  cursorY += 24

  const remaining = Math.max(0, waveState.totalInWave - enemiesResolvedInWave)
  drawSkullIcon(ctx!, x + CARD_PADDING + 6, cursorY - 4, 7, COLORS.textMid)
  ctx!.fillStyle = COLORS.textMid
  ctx!.font = '12px monospace'
  ctx!.fillText(`${remaining} remaining`, x + CARD_PADDING + 18, cursorY)
  cursorY += 18

  for (const s of stacks) {
    const resource = getResource(s.resourceId)
    ctx!.fillStyle = readableTextColor(resource.color)
    ctx!.fillText(`${resource.name} x${s.count}`, x + CARD_PADDING, cursorY)
    cursorY += 14
  }
  ctx!.restore()

  return y + height
}

/** Basis-HP-Karte: Herz-Symbol + Fortschrittsbalken (grün/gelb/rot je Füllstand, siehe
 * render/ui.ts healthFractionColor()) + "aktuell/max"-Text (User-Vorgabe, Referenzbild). */
function drawBaseHpCard(x: number, y: number): number {
  const height = CARD_PADDING * 2 + 16 + 8 + 18
  drawCard(ctx!, x, y, SIDE_PANEL_WIDTH, height)
  let cursorY = y + CARD_PADDING + 12

  drawHeartIcon(ctx!, x + CARD_PADDING + 7, cursorY - 5, 7, '#ff3355')
  ctx!.save()
  ctx!.textAlign = 'left'
  ctx!.textBaseline = 'alphabetic'
  ctx!.font = 'bold 13px monospace'
  ctx!.fillStyle = COLORS.textBright
  ctx!.fillText('BASE HP', x + CARD_PADDING + 20, cursorY)
  cursorY += 22

  const fraction = baseHp / BASE_MAX_HP
  drawProgressBar(ctx!, x + CARD_PADDING, cursorY, SIDE_PANEL_WIDTH - CARD_PADDING * 2, 8, fraction, healthFractionColor(fraction))
  cursorY += 22

  ctx!.textAlign = 'right'
  ctx!.font = '12px monospace'
  ctx!.fillStyle = COLORS.textMid
  ctx!.fillText(`${Math.max(0, Math.round(baseHp))}/${BASE_MAX_HP}`, x + SIDE_PANEL_WIDTH - CARD_PADDING, cursorY)
  ctx!.restore()

  return y + height
}

/** Schadens-Karte — je Turm-Konfiguration Anzahl + Schaden NUR DIESE WELLE (User-Vorgabe,
 * Referenzbild "TOWER DAMAGE (THIS WAVE)"; siehe combatTick(), das `damageByLoadout` bei jedem
 * Wellenwechsel leert). */
function drawTowerDamageCard(x: number, y: number, entries: LoadoutSummaryEntry[]): number {
  const height = CARD_PADDING * 2 + 18 + entries.length * 20
  drawCard(ctx!, x, y, SIDE_PANEL_WIDTH, height)
  let cursorY = y + CARD_PADDING + 12

  ctx!.save()
  ctx!.textAlign = 'left'
  ctx!.textBaseline = 'alphabetic'
  ctx!.fillStyle = COLORS.textDim
  ctx!.font = 'bold 11px monospace'
  ctx!.fillText('TOWER DAMAGE (THIS WAVE)', x + CARD_PADDING, cursorY)
  cursorY += 22

  for (const entry of entries) {
    const resource = getResource(entry.resourceId)
    const def = getTowerDefinition(entry.kind)

    ctx!.fillStyle = resource.color
    ctx!.beginPath()
    ctx!.arc(x + CARD_PADDING + 5, cursorY - 4, 5, 0, Math.PI * 2)
    ctx!.fill()

    ctx!.textAlign = 'left'
    ctx!.fillStyle = COLORS.textBright
    ctx!.font = '13px monospace'
    ctx!.fillText(`${entry.count}x ${resource.name} ${def.name}`, x + CARD_PADDING + 16, cursorY)

    ctx!.textAlign = 'right'
    ctx!.fillStyle = COLORS.textMid
    ctx!.fillText(`${Math.round(entry.damage)} dmg`, x + SIDE_PANEL_WIDTH - CARD_PADDING, cursorY)

    cursorY += 20
  }
  ctx!.restore()
  return y + height
}

const SIDEBAR_BUTTON_HEIGHT = 30

/** "UPGRADE (10⚡)" als eine um `centerX` zentrierte Gruppe aus Text+Preis+Währungssymbol —
 * render/ui.ts drawCostTag()/drawCenteredCostTag() sind selbst linksbündig (reiner Kosten-Text
 * ohne umgebendes Label), deshalb hier von Hand zusammengesetzt. Erwartet aktives
 * `textBaseline = 'middle'` (so wie im Aufrufer gesetzt) — `y` ist daher die TEXT-Mitte, nicht
 * die Baseline, weshalb das Symbol (anders als in drawCostTag) ohne vertikalen Offset auf `y`
 * zentriert wird. */
function drawUpgradeCostLabel(ctx: CanvasRenderingContext2D, centerX: number, y: number, cost: number, color: string) {
  const prefix = 'UPGRADE ('
  const suffix = ')'
  const costText = `${cost}`
  const fontSize = 11
  const iconRadius = fontSize * 0.4
  const gap = 5
  ctx.save()
  ctx.textAlign = 'left'
  const prefixWidth = ctx.measureText(prefix).width
  const costWidth = ctx.measureText(costText).width
  const suffixWidth = ctx.measureText(suffix).width
  const totalWidth = prefixWidth + costWidth + gap + iconRadius * 2 + suffixWidth
  let cursor = centerX - totalWidth / 2
  ctx.fillStyle = color
  ctx.fillText(prefix, cursor, y)
  cursor += prefixWidth
  ctx.fillText(costText, cursor, y)
  cursor += costWidth + gap
  drawCurrencyIcon(ctx, cursor + iconRadius, y, 'lumen', color, iconRadius)
  cursor += iconRadius * 2
  ctx.fillText(suffix, cursor, y)
  ctx.restore()
}

/** "SELECTED"-Karte: Name + Kennzahlen des ausgewählten Gebäudes/Turms (siehe selectedRows()),
 * plus UPGRADE/SELL-Knöpfe. Baut `sidebarButtons` neu auf (pointerdown hittestet dagegen) — leert
 * es zuerst, damit nach einem Deselect keine toten Knöpfe hängen bleiben. */
function drawSelectedCard(x: number, y: number) {
  sidebarButtons = []
  if (!infoTarget) return
  const selected = selectedRows(infoTarget)
  if (!selected) {
    infoTarget = null
    return
  }

  const rowHeight = 18
  // User-Vorgabe: eine leere Zelle ist nicht upgrade-/verkaufbar (`selected.interactive === false`,
  // siehe selectedRows()) — dafür bekommt die Karte auch keine Knopf-Zeile, entsprechend kürzer.
  const height = CARD_PADDING * 2 + 20 + selected.rows.length * rowHeight + (selected.interactive ? 10 + SIDEBAR_BUTTON_HEIGHT : 0)
  drawCard(ctx!, x, y, SIDE_PANEL_WIDTH, height, true)
  let cursorY = y + CARD_PADDING + 12

  ctx!.save()
  ctx!.textAlign = 'left'
  ctx!.textBaseline = 'alphabetic'
  ctx!.fillStyle = COLORS.textDim
  ctx!.font = 'bold 11px monospace'
  ctx!.fillText('SELECTED', x + CARD_PADDING, cursorY)
  ctx!.fillStyle = COLORS.textBright
  ctx!.font = 'bold 14px monospace'
  ctx!.fillText(selected.title, x + CARD_PADDING, cursorY + 18)
  cursorY += 34

  ctx!.font = '12px monospace'
  ctx!.textBaseline = 'middle'
  for (const row of selected.rows) {
    ctx!.fillStyle = COLORS.textDim
    ctx!.textAlign = 'left'
    ctx!.fillText(row.label, x + CARD_PADDING, cursorY)
    ctx!.fillStyle = COLORS.textBright
    ctx!.textAlign = 'right'
    ctx!.fillText(row.value, x + SIDE_PANEL_WIDTH - CARD_PADDING, cursorY)
    cursorY += rowHeight
  }
  ctx!.restore()

  if (!selected.interactive) return // leere Zelle: keine Upgrade-/Sell-Knöpfe (siehe height oben)

  cursorY += 10
  const buttonGap = 8
  const buttonWidth = (SIDE_PANEL_WIDTH - CARD_PADDING * 2 - buttonGap) / 2
  const canUpgrade = selected.upgradeCost !== null

  const upgradeButton = { id: 'upgrade' as const, x: x + CARD_PADDING, y: cursorY, width: buttonWidth, height: SIDEBAR_BUTTON_HEIGHT }
  const sellButton = { id: 'sell' as const, x: upgradeButton.x + buttonWidth + buttonGap, y: cursorY, width: buttonWidth, height: SIDEBAR_BUTTON_HEIGHT }
  sidebarButtons.push(upgradeButton, sellButton)

  ctx!.save()
  ctx!.textAlign = 'center'
  ctx!.textBaseline = 'middle'
  ctx!.font = '11px monospace'

  drawCard(ctx!, upgradeButton.x, upgradeButton.y, upgradeButton.width, upgradeButton.height, canUpgrade)
  const upgradeTextColor = canUpgrade ? COLORS.accent : COLORS.textDim
  const upgradeCenterX = upgradeButton.x + upgradeButton.width / 2
  const upgradeTextY = upgradeButton.y + upgradeButton.height / 2 + 1
  // User-Vorgabe: der Preis soll direkt auf dem Knopf stehen (nicht nur in der Level-Zeile), UND
  // jetzt auch mit Währungssymbol (siehe drawUpgradeCostLabel()) — bei MAX-Level gibt es keinen
  // Preis, daher nur der Klartext ohne Symbol.
  if (canUpgrade) drawUpgradeCostLabel(ctx!, upgradeCenterX, upgradeTextY, selected.upgradeCost!, upgradeTextColor)
  else {
    ctx!.fillStyle = upgradeTextColor
    ctx!.fillText('UPGRADE (MAX)', upgradeCenterX, upgradeTextY)
  }

  drawCard(ctx!, sellButton.x, sellButton.y, sellButton.width, sellButton.height)
  ctx!.fillStyle = '#ff3355'
  ctx!.fillText('SELL', sellButton.x + sellButton.width / 2, sellButton.y + sellButton.height / 2 + 1)
  ctx!.restore()
}

/** Rechte Seitenleiste: Wave-Fortschritt, Basis-HP, Turm-Schaden (diese Welle), und — falls
 * gerade ein Gebäude/Turm ausgewählt ist — die "SELECTED"-Karte mit Upgrade/Sell (User-Vorgabe,
 * Referenzbild). */
/** Kurzer, nicht-blockierender Hinweis nach einem Basis-HP-Reset (siehe softResetRun()) — fährt
 * sich über BASE_DESTROYED_MESSAGE_SECONDS automatisch aus, kein Klick zum Schließen nötig (User-
 * Vorgabe: "nur pausieren"-Modal war NICHT die gewählte Option — weicher Reset statt Blockade). */
function drawBaseDestroyedMessage() {
  if (elapsedSeconds >= baseDestroyedMessageUntil) return
  const remaining = baseDestroyedMessageUntil - elapsedSeconds
  const alpha = Math.min(1, remaining)
  ctx!.save()
  ctx!.globalAlpha = alpha
  ctx!.textAlign = 'center'
  ctx!.font = 'bold 16px monospace'
  ctx!.fillStyle = '#ff3355'
  ctx!.fillText('BASE DESTROYED — RESETTING TO WAVE 1', width / 2, SIDE_PANEL_TOP - 24)
  ctx!.restore()
}

function drawRightSidebar() {
  const x = placementGrid.originX + gridPixelWidth(placementGrid) + SIDE_PANEL_MARGIN
  let y = SIDE_PANEL_TOP

  y = drawWaveCard(x, y) + CARD_GAP
  y = drawBaseHpCard(x, y) + CARD_GAP

  const entries = currentLoadoutSummary()
  if (entries.length > 0) y = drawTowerDamageCard(x, y, entries) + CARD_GAP

  drawSelectedCard(x, y)
}

interface SelectedRow {
  label: string
  value: string
  action?: 'level'
}

/** Name + Kennzahlen für die "SELECTED"-Karte der rechten Seitenleiste (siehe drawRightSidebar())
 * — dieselben Felder wie das frühere schwebende Info-Panel, nur ohne Layout/Zeichnen (das
 * übernimmt jetzt die Seitenleiste). `upgradeCost` (null, wenn schon Max-Level) lässt den
 * UPGRADE-Knopf seinen Preis direkt anzeigen (User-Vorgabe), statt ihn nur in der Level-Zeile zu
 * verstecken. Gibt `null` zurück, wenn das Ziel inzwischen weg ist (z. B. gerade abgerissen) —
 * Aufrufer räumt dann `infoTarget` auf. */
function selectedRows(target: InfoTarget): { title: string; rows: SelectedRow[]; upgradeCost: number | null; interactive: boolean } | null {
  if (target.kind === 'empty') {
    const onPath = isOnEnemyPath({ col: target.col, row: target.row })
    return {
      title: 'Empty Cell',
      upgradeCost: null,
      interactive: false,
      rows: [
        { label: 'Status', value: 'Nothing built here' },
        { label: 'Enemy Path', value: onPath ? 'Yes (mirrors only)' : 'No' },
      ],
    }
  }
  if (target.kind === 'source') {
    const source = lightSources.find((s) => s.id === target.id)
    if (!source) return null
    const active = lightSimulation.activeSourceIds.has(source.id)
    const maxed = source.level >= GENERATOR_MAX_LEVEL
    const upgradeCost = maxed ? null : generatorUpgradeCost(source.level + 1)
    return {
      title: 'Light Source',
      upgradeCost,
      interactive: true,
      rows: [
        { label: 'Color', value: getResource(source.resourceId).name },
        { label: 'Level', value: maxed ? `${source.level}/${GENERATOR_MAX_LEVEL} (max)` : `${source.level}/${GENERATOR_MAX_LEVEL} (Lv.${source.level + 1})`, action: maxed ? undefined : 'level' },
        { label: 'Range', value: `${source.range} cells` },
        { label: 'Status', value: active ? 'Delivering' : 'Idle (no tower in range)' },
      ],
    }
  }
  const tower = towers.find((t) => t.id === target.id)
  if (!tower) return null
  const def = getTowerDefinition(tower.kind)
  const stats = getEffectiveTowerStats(tower)
  const ammo = lightSimulation.towerAmmo.get(tower.id)
  const ammoLabel = tower.resourceId ? `${getResource(tower.resourceId).name} (strength ${ammo?.strength ?? 0})` : '— (not connected)'
  const maxed = tower.level >= TOWER_MAX_LEVEL
  const upgradeCost = maxed ? null : towerUpgradeCost(def, tower.level + 1)
  return {
    title: def.name,
    upgradeCost,
    interactive: true,
    rows: [
      { label: 'Ammo', value: tower.resourceId && !hasAmmoAvailable(tower) ? `${ammoLabel} (Shortage!)` : ammoLabel },
      { label: 'Level', value: maxed ? `${tower.level}/${TOWER_MAX_LEVEL} (max)` : `${tower.level}/${TOWER_MAX_LEVEL}`, action: maxed ? undefined : 'level' },
      { label: 'Damage', value: stats.damage.toFixed(1) },
      { label: 'Range', value: `${(stats.range / hexColumnWidth(placementGrid)).toFixed(1)} cells` },
      { label: 'Attack Speed', value: `${(1 / stats.fireInterval).toFixed(2)}/s` },
      { label: 'Projectile Speed', value: stats.projectileSpeed ? `${stats.projectileSpeed.toFixed(0)}px/s` : '—' },
      { label: 'Consumption', value: `${stats.consumption.toFixed(1)}/s` },
    ],
  }
}

/** `kind` ist hier nie `'expand-grid'` — das wird in pointerdown() als Sofort-Aktion abgefangen,
 * bevor `placingNewKind` überhaupt gesetzt wird (kein Ziehen-aufs-Raster dafür). */
function placementCost(kind: PaletteKind): number {
  if (kind === 'mirror') return BUILDING_COSTS.mirror
  if (kind === 'prism-simple') return BUILDING_COSTS.prismSimple
  if (kind === 'prism-complex') return BUILDING_COSTS.prismComplex
  return BUILDING_COSTS.source
}

function drawPlacementPreview() {
  if (!placingNewKind || !placingCursor) return
  const cell = cellAtPoint(placementGrid, placingCursor.x, placingCursor.y)
  const valid =
    !!cell &&
    !occupancy.has(cellKey(cell)) &&
    canAfford(inventory, 'lumen', placementCost(placingNewKind)) &&
    (placingNewKind === 'mirror' || !isOnEnemyPath(cell))
  if (cell) drawCellHighlight(ctx!, placementGrid, cell, valid ? '#39ff8f' : '#ff3355', 0.3)

  const previewPos = cell ? cellCenter(placementGrid, cell) : placingCursor
  drawPaletteGhost(placingNewKind, previewPos)
}

function drawPaletteGhost(kind: PaletteKind, pos: Point) {
  ctx!.save()
  ctx!.globalAlpha = 0.6
  const resourceId = sourceResourceIdForPalette(kind)
  if (resourceId) {
    ctx!.strokeStyle = getResource(resourceId).color
    ctx!.lineWidth = 2
    ctx!.beginPath()
    ctx!.arc(pos.x, pos.y, SOURCE_OUTER_SIZE, 0, Math.PI * 2)
    ctx!.stroke()
  } else if (kind === 'mirror') {
    const half = placementGrid.cellSize * 0.55
    const angle = (Math.PI / 180) * -30 // Default-Achse (Orientierung 0), siehe buildingRender.ts
    const dx = half * Math.cos(angle)
    const dy = half * Math.sin(angle)
    ctx!.strokeStyle = '#eafffa'
    ctx!.lineWidth = 3
    ctx!.lineCap = 'round'
    ctx!.beginPath()
    ctx!.moveTo(pos.x - dx, pos.y - dy)
    ctx!.lineTo(pos.x + dx, pos.y + dy)
    ctx!.stroke()
  } else if (kind === 'prism-simple' || kind === 'prism-complex') {
    const size = kind === 'prism-simple' ? PRISM_SIMPLE_SIZE : PRISM_COMPLEX_SIZE
    const sides = kind === 'prism-simple' ? 3 : 6
    ctx!.strokeStyle = '#ffffff'
    ctx!.lineWidth = 2
    ctx!.beginPath()
    for (let i = 0; i < sides; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides
      const px = pos.x + size * Math.cos(angle)
      const py = pos.y + size * Math.sin(angle)
      if (i === 0) ctx!.moveTo(px, py)
      else ctx!.lineTo(px, py)
    }
    ctx!.closePath()
    ctx!.stroke()
  }
  ctx!.restore()
}

function drawMovePreview() {
  if (!movingBuildingId || !movingCursor) return

  if (movingKind === 'tower') {
    const tower = towers.find((t) => t.id === movingBuildingId)
    if (!tower) return
    const cell = nearestCell(placementGrid, movingCursor.x, movingCursor.y)
    const valid = canPlaceAt(cell) && !isOnEnemyPath(cell)
    const center = cellCenter(placementGrid, cell)
    if (!valid) {
      ctx!.save()
      ctx!.globalAlpha = 0.35
      ctx!.fillStyle = '#ff3355'
      ctx!.beginPath()
      ctx!.arc(center.x, center.y, TOWER_ICON_SIZE + 10, 0, Math.PI * 2)
      ctx!.fill()
      ctx!.restore()
    }
    ctx!.save()
    ctx!.globalAlpha = 0.7
    const color = tower.resourceId ? getResource(tower.resourceId).color : undefined
    drawTowerPreview(ctx!, tower.kind, center, color)
    ctx!.restore()
    return
  }

  const cell = cellAtPoint(placementGrid, movingCursor.x, movingCursor.y)
  let valid = false
  let kind: PaletteKind | null = null

  if (movingKind === 'source') {
    const source = lightSources.find((s) => s.id === movingBuildingId)
    if (!source) return
    valid = !!cell && (!occupancy.has(cellKey(cell)) || occupancy.get(cellKey(cell)) === source.id) && !isOnEnemyPath(cell)
    kind = source.resourceId === 'cyan' ? 'source-cyan' : source.resourceId === 'magenta' ? 'source-magenta' : 'source-yellow'
  } else if (movingKind === 'mirror') {
    const mirror = mirrors.find((m) => m.id === movingBuildingId)
    if (!mirror) return
    // Mirror: keine Pfad-Sperre (siehe finalizeMove()) — die einzige Ausnahme.
    valid = !!cell && (!occupancy.has(cellKey(cell)) || occupancy.get(cellKey(cell)) === mirror.id)
    kind = 'mirror'
  } else if (movingKind === 'prism') {
    const prism = prisms.find((p) => p.id === movingBuildingId)
    if (!prism) return
    valid = !!cell && (!occupancy.has(cellKey(cell)) || occupancy.get(cellKey(cell)) === prism.id) && !isOnEnemyPath(cell)
    kind = prism.prismKind === 'triangle' ? 'prism-simple' : 'prism-complex'
  }
  if (!kind) return

  if (cell) drawCellHighlight(ctx!, placementGrid, cell, valid ? '#39ff8f' : '#ff3355', 0.3)
  const previewPos = cell ? cellCenter(placementGrid, cell) : movingCursor
  drawPaletteGhost(kind, previewPos)
}

/** Das gemeinsame Raster: Rasterlinien + Gegner-Pfad (inkl. Endpunkt-Stein + Einlauf-Marker) + Lichtstrahlen +
 * Max-Level-Marker + alle Gebäude (Lichtquellen/Spiegel/Prismen) — Türme werden separat danach
 * gezeichnet (siehe drawTowers(), für die richtige Ziel-Priorität beim Klicken sowie den
 * "Shortage"-Alpha-Effekt). */
function drawWorld() {
  drawPlacementGrid(ctx!, placementGrid, COLORS.gridLineStrong)

  drawPath(ctx!, enemyPathPixels, pathHitBlockerId !== null)

  // User-Vorgabe: Verbindungen ohne Prisma/Turm als Ziel (reachedEndpoint=false — lief in eine
  // Wand, den Reichweiten-Rand, eine Kollision, oder wurde vom Gegner-Pfad geblockt) wirken deutlich
  // gedimmt, analog zum INACTIVE_ALPHA eines unterversorgten Turms (drawTowers()).
  for (const segment of lightSimulation.segments) drawBeamSegment(ctx!, placementGrid, segment, segment.reachedEndpoint ? 0.8 : INACTIVE_ALPHA)
  for (const segment of lightSimulation.segments) {
    if (segment.reachedEndpoint) drawBeamTraveler(ctx!, placementGrid, segment, elapsedSeconds)
  }

  drawPlacementPreview()
  drawMovePreview()

  for (const source of lightSources) {
    if (isSourceMaxed(source)) drawMaxLevelCellMarker(ctx!, placementGrid, { col: source.col, row: source.row })
  }
  // User-Vorgabe: Max-Level-Türme sollen denselben goldenen Rasterfeld-Marker bekommen wie
  // Economy-Gebäude — NICHT (wie zuvor) einen Kreis um das Turm-Icon selbst. Hier statt in
  // drawTowers() gezeichnet, damit er wie bei den Gebäuden als Hintergrund-Glühen UNTER dem
  // Turm-Icon liegt (drawTowers() läuft erst danach).
  for (const tower of towers) {
    if (tower.level >= TOWER_MAX_LEVEL) drawMaxLevelCellMarker(ctx!, placementGrid, { col: tower.col, row: tower.row })
  }

  for (const source of lightSources) drawLightSourceEntity(ctx!, source, buildingCenter(source), elapsedSeconds, lightSimulation.activeSourceIds.has(source.id))
  for (const mirror of mirrors) drawMirrorEntity(ctx!, mirror, buildingCenter(mirror), placementGrid.cellSize)
  for (const prism of prisms) {
    const status = lightSimulation.prismStatus.get(prism.id)
    if (status) drawPrismEntity(ctx!, prism, buildingCenter(prism), status, elapsedSeconds)
  }
}

let elapsedSeconds = 0

/** Ob ein Turm gerade tatsächlich feuern kann: ohne Verkabelung immer ja (Klarschuss ohne
 * Effekt), verkabelt nur, solange die ankommende Strahl-Stärke seine `consumption` deckt — geht
 * die Strahl-Stärke unter den Bedarf, hört der Turm auf zu schießen, statt weiter "auf Kredit" zu
 * feuern (siehe economy/lightSimulation.ts für die Stärke-Berechnung). */
function hasAmmoAvailable(tower: PlacedTower): boolean {
  if (!tower.resourceId) return true
  const ammo = lightSimulation.towerAmmo.get(tower.id)
  return (ammo?.strength ?? 0) >= getEffectiveTowerStats(tower).consumption
}

function economyTick(dt: number) {
  elapsedSeconds += dt
  recomputeLightSimulation()
  // Munition kommt jetzt live aus der Strahl-Verkabelung (User-Vorgabe) — kein manuelles
  // Zuweisen mehr, kein globaler Ratenpool: jeder Turm übernimmt jeden Frame direkt, welche Farbe
  // (falls überhaupt eine) ihn gerade erreicht (siehe economy/lightSimulation.ts towerAmmo).
  for (const tower of towers) {
    tower.resourceId = lightSimulation.towerAmmo.get(tower.id)?.resourceId ?? null
  }
}

function combatTick(dt: number) {
  if (!worldReady || gamePaused) return

  // tickWaveSpawning() gibt `true` GENAU im Frame des Wellenwechsels zurück (Pause -> Spawning,
  // siehe towerdefense/waves.ts) — daran hängen die "pro Welle"-Zähler, statt separat auf eine
  // geänderte Wellennummer zu diffen.
  if (tickWaveSpawning(waveState, dt, enemies)) {
    damageByLoadout = new Map()
    enemiesResolvedInWave = 0
  }

  for (const enemy of enemies) tickEnemy(enemy, dt, elapsedSeconds, enemyPathLength)

  updateTowers(towers, enemies, dt, elapsedSeconds, enemyPathPixels, towerCenter, hasAmmoAvailable, projectiles, visualEffects, damageByLoadout)
  projectiles = updateProjectiles(projectiles, enemies, dt, elapsedSeconds, enemyPathPixels, visualEffects, damageByLoadout)
  visualEffects = pruneVisualEffects(visualEffects, elapsedSeconds)

  const { remaining, killed, arrived } = pruneEnemies(enemies)
  enemies = remaining
  enemiesResolvedInWave += killed.length + arrived.length
  if (killed.length > 0) {
    const lumen = killed.reduce((sum, e) => sum + LUMEN_PER_KILL * (e.isBoss ? BOSS_LUMEN_MULTIPLIER : 1), 0)
    addToInventory(inventory, 'lumen', lumen)
  }
  // User-Vorgabe: ein durchgekommener Gegner kostet jetzt Basis-HP statt die Welle scheitern zu
  // lassen (siehe BASE_MAX_HP-Kommentar weiter oben) — ein Boss-Leak kostet deutlich mehr.
  if (arrived.length > 0) {
    const damage = arrived.reduce((sum, e) => sum + (e.isBoss ? DAMAGE_PER_BOSS_LEAK : DAMAGE_PER_LEAK), 0)
    baseHp = Math.max(0, baseHp - damage)
    if (baseHp <= 0) softResetRun()
  }
}

function render(_dt: number) {
  ctx!.fillStyle = COLORS.background
  ctx!.fillRect(0, 0, width, height)

  // Alles auf dem Raster (Gebäude/Türme/Pfad/Gegner/Projektile) lebt in "Welt"-Koordinaten und
  // wird um cameraOffsetY nach oben verschoben gezeichnet (siehe worldPointerPos() fürs Hit-Testing
  // in Gegenrichtung) — Kauf-Leiste/HUD/Modals bleiben bewusst AUSSERHALB dieses Blocks, damit sie
  // beim Scrollen bildschirmfest stehen bleiben.
  ctx!.save()
  ctx!.translate(0, -cameraOffsetY)
  drawWorld()
  drawTowers()
  drawSelectionHighlight()
  drawTowerCombatEffects(ctx!, towers, enemies, enemyPathPixels, towerCenter)
  drawTowerPlacementPreview()
  drawEnemies(ctx!, enemies, enemyPathPixels, elapsedSeconds)
  drawProjectiles(ctx!, projectiles)
  drawVisualEffects(ctx!, visualEffects, elapsedSeconds)
  ctx!.restore()

  drawEconomyPalette()
  drawTowerPalette()
  drawPaletteDivider()
  drawPaletteTooltips()
  drawLeftSidebar()
  drawRightSidebar()
  drawBaseDestroyedMessage()
  drawHud(ctx!, width, inventory, playerName, playerLevel, hudButtons, demolishMode, gamePaused)

  if (welcomeOpen) drawWelcomePanel(ctx!, width, height)
}

startGameLoop({ economyTick, combatTick, render })
