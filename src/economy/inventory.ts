import { RESOURCES } from '../data/resources'

// Ressourcen-Bestand (akkumulierte Einheiten je Ressource, nicht nur Produktionsraten).
// Startkapital ist reine Platzhalter-Balance, damit sich sofort etwas kaufen/testen lässt.

export type Inventory = Map<string, number>

const STARTING_BALANCE: Record<string, number> = {
  lumen: 20,
  prisma: 5,
}

export function createInventory(): Inventory {
  const inventory = new Map<string, number>()
  for (const resource of RESOURCES) inventory.set(resource.id, STARTING_BALANCE[resource.id] ?? 0)
  return inventory
}

export function getBalance(inventory: Inventory, resourceId: string): number {
  return inventory.get(resourceId) ?? 0
}

export function addToInventory(inventory: Inventory, resourceId: string, amount: number) {
  inventory.set(resourceId, getBalance(inventory, resourceId) + amount)
}

export function canAfford(inventory: Inventory, resourceId: string, amount: number): boolean {
  return getBalance(inventory, resourceId) >= amount
}

export function spend(inventory: Inventory, resourceId: string, amount: number): boolean {
  if (!canAfford(inventory, resourceId, amount)) return false
  inventory.set(resourceId, getBalance(inventory, resourceId) - amount)
  return true
}

/** Cheat: +10 Einheiten auf jede Ressource (Grund- und hergestellte Farben, Lumen, Prisma). */
export function cheatAddTenToAll(inventory: Inventory) {
  for (const resource of RESOURCES) addToInventory(inventory, resource.id, 10)
}
