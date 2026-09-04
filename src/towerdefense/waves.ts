// Wellensystem (User-Vorgabe): jede Welle besteht aus 20 Gegnern, die im festen Abstand
// nacheinander spawnen. Sobald der letzte Gegner der Welle gespawnt ist, folgt eine 5-Sekunden-
// Pause, danach beginnt die nächste Welle. Jede Welle ist stärker als die vorige (siehe
// `statsForWave()` — eine reine Funktion der Wellennummer, damit ein Rücksetzen nach einem
// Fehlschlag exakt dieselbe Stärke reproduziert). Leakt während einer Welle mindestens ein
// Gegner bis zum Ziel durch (siehe `registerLeak()`), gilt die Welle als nicht geschafft: die
// nächste Welle ist dann `currentWave - 5` (min. 1) statt `currentWave + 1`. Jede 10. Welle
// spawnt zusätzlich (nicht statt) einen deutlich größeren/stärkeren Boss als 21. Gegner.

import { createEnemy, ENEMY_BASE_SIZE, type Enemy } from './enemies'

export const ENEMIES_PER_WAVE = 20
export const WAVE_SPAWN_INTERVAL = 0.5 // Sekunden zwischen 2 Spawns innerhalb einer Welle
export const WAVE_PAUSE_SECONDS = 5
/** Nach einer Boss-Welle (User-Vorgabe) länger Pause als sonst, damit man kurz durchatmen kann. */
export const BOSS_WAVE_PAUSE_SECONDS = 10
export const BOSS_WAVE_INTERVAL = 10
export const RETRY_SETBACK_WAVES = 5

// Platzhalter-Balancing (wie überall in diesem Projekt): reine Funktion der Wellennummer.
const BASE_HP = 30
const HP_GROWTH_PER_WAVE = 0.12
const BASE_ARMOR = 0.1
const ARMOR_GROWTH_PER_WAVE = 0.008
const MAX_ARMOR = 0.6
const BASE_SPEED = 28 // Pixel/Sekunde (siehe enemies.ts Enemy.baseSpeed) — Platzhalter-Balancing.
const SPEED_GROWTH_PER_WAVE = 0.01
const MAX_SPEED_MULTIPLIER = 2

const BOSS_SIZE_MULTIPLIER = 2.6
const BOSS_HP_MULTIPLIER = 18
const BOSS_ARMOR_BONUS = 0.15
const BOSS_SPEED_FACTOR = 0.55
/** Lumen-Belohnung eines Bosses relativ zu einem normalen Gegner derselben Welle (siehe main.ts
 * — ein flacher Kill-Bonus würde einen 18x so zähen Gegner nicht lohnender machen). */
export const BOSS_LUMEN_MULTIPLIER = 15

export function isBossWave(wave: number): boolean {
  return wave % BOSS_WAVE_INTERVAL === 0
}

function enemyCountForWave(wave: number): number {
  return isBossWave(wave) ? ENEMIES_PER_WAVE + 1 : ENEMIES_PER_WAVE
}

/** Für die HUD-Anzeige unter dem Wellenstand (siehe main.ts drawWaveStatus()): HP der normalen
 * Gegner dieser Welle, plus HP des Bosses, falls es sich um eine Boss-Welle handelt (siehe
 * isBossWave()) — dieselbe Formel wie `createRegularEnemyForWave()`/`createBossEnemyForWave()`,
 * nur ohne tatsächlich einen Gegner zu erzeugen. */
export function waveEnemyHp(wave: number): { regularHp: number; bossHp: number | null } {
  const { hp } = statsForWave(wave)
  return { regularHp: hp, bossHp: isBossWave(wave) ? hp * BOSS_HP_MULTIPLIER : null }
}

function statsForWave(wave: number): { hp: number; armor: number; baseSpeed: number } {
  const hp = BASE_HP * (1 + (wave - 1) * HP_GROWTH_PER_WAVE)
  const armor = Math.min(MAX_ARMOR, BASE_ARMOR + (wave - 1) * ARMOR_GROWTH_PER_WAVE)
  const speedMultiplier = Math.min(MAX_SPEED_MULTIPLIER, 1 + (wave - 1) * SPEED_GROWTH_PER_WAVE)
  return { hp, armor, baseSpeed: BASE_SPEED * speedMultiplier }
}

function createRegularEnemyForWave(wave: number): Enemy {
  const { hp, armor, baseSpeed } = statsForWave(wave)
  return createEnemy({ hp, armor, baseSpeed, size: ENEMY_BASE_SIZE })
}

function createBossEnemyForWave(wave: number): Enemy {
  const { hp, armor, baseSpeed } = statsForWave(wave)
  return createEnemy({
    hp: hp * BOSS_HP_MULTIPLIER,
    armor: Math.min(MAX_ARMOR, armor + BOSS_ARMOR_BONUS),
    baseSpeed: baseSpeed * BOSS_SPEED_FACTOR,
    size: ENEMY_BASE_SIZE * BOSS_SIZE_MULTIPLIER,
    isBoss: true,
  })
}

export interface WaveState {
  currentWave: number
  /** Wie viele der `totalInWave` Gegner der aktuellen Welle bereits gespawnt wurden. */
  enemiesSpawnedInWave: number
  /** 20, oder 21 auf einer Boss-Welle (siehe `isBossWave()`). */
  totalInWave: number
  /** Wie viele Gegner der aktuellen Welle bis zum Ziel durchgekommen sind — >0 am Ende der
   * Welle bedeutet "nicht geschafft" (siehe `tickWaveSpawning()`). */
  waveLeaks: number
  spawnTimer: number
  pauseTimer: number
  phase: 'spawning' | 'pause'
}

export function createWaveState(startWave = 1): WaveState {
  return {
    currentWave: startWave,
    enemiesSpawnedInWave: 0,
    totalInWave: enemyCountForWave(startWave),
    waveLeaks: 0,
    spawnTimer: 0,
    pauseTimer: 0,
    phase: 'spawning',
  }
}

/** Vom Aufrufer bei jedem Gegner aufzurufen, der das Ziel erreicht hat (siehe main.ts
 * pruneEnemies()'s `arrived`) — zählt für die Erfolgs-/Fehlschlag-Entscheidung am Ende der
 * aktuellen Welle. */
export function registerLeak(state: WaveState) {
  state.waveLeaks += 1
}

/**
 * Pro Frame: spawnt ggf. den nächsten Gegner der aktuellen Welle (neue Gegner werden in
 * `enemies` gepusht, Aufrufer hält die Referenz — wie überall sonst in diesem Projekt) bzw.
 * zählt während der Pause runter und entscheidet danach, ob die nächste Welle vorwärts
 * (`currentWave + 1`) oder nach einem Fehlschlag zurückgesetzt (`currentWave - 5`, min. 1)
 * weitergeht.
 */
export function tickWaveSpawning(state: WaveState, dt: number, enemies: Enemy[]) {
  if (state.phase === 'spawning') {
    state.spawnTimer -= dt
    if (state.spawnTimer <= 0) {
      const spawningBoss = isBossWave(state.currentWave) && state.enemiesSpawnedInWave === ENEMIES_PER_WAVE
      enemies.push(spawningBoss ? createBossEnemyForWave(state.currentWave) : createRegularEnemyForWave(state.currentWave))
      state.enemiesSpawnedInWave += 1
      state.spawnTimer = WAVE_SPAWN_INTERVAL

      if (state.enemiesSpawnedInWave >= state.totalInWave) {
        state.phase = 'pause'
        state.pauseTimer = isBossWave(state.currentWave) ? BOSS_WAVE_PAUSE_SECONDS : WAVE_PAUSE_SECONDS
      }
    }
    return
  }

  state.pauseTimer -= dt
  if (state.pauseTimer > 0) return

  const nextWave = state.waveLeaks > 0 ? Math.max(1, state.currentWave - RETRY_SETBACK_WAVES) : state.currentWave + 1
  state.currentWave = nextWave
  state.enemiesSpawnedInWave = 0
  state.totalInWave = enemyCountForWave(nextWave)
  state.waveLeaks = 0
  state.spawnTimer = 0
  state.phase = 'spawning'
}
