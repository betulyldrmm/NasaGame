import type { BodyId } from '../nasa/bodies'

/** Birimler: kütle ton (t), itki kilonewton (kN), uzunluk metre, 1 grid karesi = 1 m. */
export type PartKind =
  | 'command'
  | 'nose'
  | 'tank'
  | 'engine'
  | 'decoupler'
  | 'radialDecoupler'
  | 'chute'
  | 'leg'
  | 'rcs'
  | 'solar'
  | 'rtg'
  | 'battery'
  | 'cargo'

export type PartCategory = 'Komuta' | 'Yakıt' | 'Motorlar' | 'Kademe' | 'Güç' | 'İniş' | 'Kargo'

export interface PartDef {
  id: string
  name: string
  kind: PartKind
  category: PartCategory
  /** grid karesi cinsinden boyut */
  w: number
  h: number
  /** kuru kütle (t) */
  mass: number
  cost: number
  desc: string
  /** tank: yakıt kapasitesi (t) */
  fuel?: number
  /** motor: vakum itkisi (kN) */
  thrust?: number
  /** motor: özgül itki (s) vakumda / deniz seviyesinde */
  ispVac?: number
  ispSL?: number
  /** iyon motoru: elektrik tüketimi (birim/s) */
  ecUse?: number
  /** batarya / komuta: elektrik kapasitesi */
  ecCap?: number
  /** güneş paneli: 1 AU'da üretim (birim/s) */
  ecGen?: number
  /** kargo gövdesi: kapasite (t) */
  cargoCap?: number
  /** iniş ayağı: dayanılabilir hız (m/s) */
  legTolerance?: number
}

export interface PartInst {
  def: string
  x: number
  y: number
  /** tank: kalan yakıt (t) */
  fuel?: number
  /** motor açık/kapalı */
  on?: boolean
  /** paraşüt / güneş paneli / iniş ayağı açık mı */
  deployed?: boolean
}

export type SasMode = 'off' | 'prograde' | 'retrograde' | 'radial'

export interface Cargo {
  modules: Record<string, number>
  ore: number
  oreFrom: BodyId | null
}

export interface Vessel {
  id: number
  name: string
  parts: PartInst[]
  bodyId: BodyId
  /** gök cismine göre konum (m) ve hız (m/s); eksenler dönmez */
  pos: { x: number; y: number }
  vel: { x: number; y: number }
  /** burnun baktığı yön (rad) */
  angle: number
  angVel: number
  landed: boolean
  throttle: number
  ec: number
  cargo: Cargo
  rcsOn: boolean
  sas: SasMode
  visited: BodyId[]
  /** yerçekimi sapanı takibi: SOI'ye girişteki ebeveyn-çerçevesi hızı */
  assist: { bodyId: BodyId; speedIn: number; dvIn: number } | null
  dvUsed: number
  /** teknoloji ile açılan otomatik iniş asistanı */
  autoLand?: boolean
}

export interface Base {
  modules: Record<string, number>
  ore: number
  /** üssün yüzeydeki açısal konumu (rad) */
  siteAngle: number
  earned: number
}

export interface ShipSlot {
  name: string
  design: PartInst[]
  cargo: Record<string, number>
}

export interface GameState {
  /** oyun saati (s) */
  time: number
  money: number
  vessels: Vessel[]
  activeId: number | null
  nextId: number
  bases: Partial<Record<BodyId, Base>>
  missionsDone: string[]
  techDone: string[]
  design: PartInst[]
  designCargo: Record<string, number>
  /** oyuncunun kayıtlı gemi tasarımları (boş slot = null) */
  shipSlots?: (ShipSlot | null)[]
  targetBody?: BodyId | null
  lastSavedAt?: number
}

export type GameEvent =
  | { type: 'toast'; text: string }
  | { type: 'crash'; name: string; wasActive: boolean; reason: string }
  | { type: 'mission'; id: string; title: string; reward: number }
  | { type: 'soi'; from: BodyId; to: BodyId }
