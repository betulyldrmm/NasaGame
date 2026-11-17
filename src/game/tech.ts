/**
 * Teknoloji ağacı kaldırıldı: tüm roket parçaları baştan açıktır, üs yapıları ise
 * kolonideki ilerlemeye göre açılır (bkz. base.ts → moduleTier).
 * Bu dosya yalnızca eski çağrı noktalarıyla uyumluluk için duruyor.
 */
import { BODIES, type BodyId } from '../nasa/bodies'
import type { GameState } from './types'

export const INITIAL_TECH = 'basic-rocketry'
export const isPartUnlocked = (_gs: GameState, _partId: string) => true
export const isModuleUnlocked = (_gs: GameState, _moduleId: string) => true
export const hasAutoLandTech = (_gs: GameState) => true
export const requiredTechForPart = (_partId: string): { name: string } | null => null
export const requiredTechForModule = (_moduleId: string): { name: string } | null => null
export const baseIncomeMultiplier = (_gs: GameState, bodyId: BodyId) => BODIES[bodyId]?.incomeMult || 1
export const orePriceMultiplier = (_gs: GameState) => 1
