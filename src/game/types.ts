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
  | 'station'

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
  /** İniş ayağı açılma animasyonunun 0..1 ilerlemesi. */
  deployProgress?: number
}

export type SasMode = 'off' | 'prograde' | 'retrograde' | 'radial'
export type AutopilotMode = 'off' | 'orbit' | 'transfer' | 'land'

export interface Cargo {
  modules: Record<string, number>
  ore: number
  oreFrom: BodyId | null
}

export interface Vessel {
  id: number
  name: string
  /** Çok oyunculu hazırlığı: aracın sahibi oyuncu kimliği */
  ownerId?: string
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
  /** aktif otopilot modu ('orbit', 'transfer', 'land' vb.) */
  autopilot?: AutopilotMode
  /** otopilotun oyuncuya gösterdiği tek satırlık durum */
  autopilotNote?: string
  /** hedefe yaklaşıldığında otomatik iniş yoksa verilen yakınlaşma uyarısı */
  approachWarn?: BodyId | null
  /** çarpışma sonrası parça parça dağılma durumu */
  breaking?: { left: number; timer: number; reason: string }
  /** yörünge istasyonu (ISS): silinemez, kurtarılamaz */
  station?: boolean
  /** çarpışmadan kopan parça: kendi fiziğiyle savrulur, yere değince patlar */
  debris?: { ttl: number }
  /** yörünge yakalama yanışı başladı: bitene kadar kesilmez (titreşimi önler) */
  captureLatch?: boolean
}

export type TileKind = 'fog' | 'clear' | 'crater' | 'vein' | 'built'

export interface PlanetTile {
  x: number
  y: number
  kind: TileKind
  /** sis kalkınca açılacak zemin */
  under?: 'clear' | 'crater' | 'vein'
  moduleId?: string
  level?: number
  /** çok oyunculu hazırlığı: kareyi kuran oyuncu */
  ownerId?: string
}

export interface Base {
  modules: Record<string, number>
  ore: number
  /** üssün yüzeydeki açısal konumu (rad) */
  siteAngle: number
  earned: number
  /** koloni yuvaları: her yuvada bir yapı kimliği ya da boş */
  sites?: (string | null)[]
  /** kargoyla getirilip henüz kurulmamış yapılar */
  stock?: Record<string, number>
  /** eski 4×4 grid (yalnızca eski kayıtları okumak için) */
  grid?: PlanetTile[]
  /** tamamlanan sektör tarama sayısı (her temizlikte artar) */
  sectorLevel?: number
  /** çok oyunculu hazırlığı: üs sahibi oyuncu kimliği */
  ownerId?: string
}

export interface ShipSlot {
  name: string
  design: PartInst[]
  cargo: Record<string, number>
}

export interface PlayerMeta {
  id: string
  username: string
  color?: string
}

export interface GameState {
  /** oyun saati (s) */
  time: number
  /** deterministik adım sayacı (çok oyunculu senkron hazırlığı) */
  tick?: number
  protocolVersion?: number
  ownerId?: string
  players?: Record<string, PlayerMeta>
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
  /** kazanılan başarımlar (easter egg'ler dahil) */
  achievements?: string[]
  /** gizli "Simit & Çay" modu */
  teaMode?: boolean
  /** yakıt verimi bonusunun bittiği an (ms, Date.now) */
  buffUntil?: number
  issDeliveries?: number
}

/** Çok oyunculu hazırlığı: serileştirilebilir oyuncu komutları. */
export type GameCommand =
  | { type: 'launch' }
  | { type: 'stage'; vesselId: number }
  | { type: 'dock'; vesselId: number; targetId: number }
  | { type: 'deleteVessel'; vesselId: number }
  | { type: 'recoverVessel'; vesselId: number }
  | { type: 'setTarget'; bodyId: BodyId }
  | { type: 'setAutopilot'; vesselId: number; mode: AutopilotMode }
  | { type: 'setSas'; vesselId: number; sas: SasMode }
  | { type: 'toggleRcs'; vesselId: number }
  | { type: 'togglePartKind'; vesselId: number; kind: 'solar' | 'leg' | 'chute' }
  | { type: 'deployModules'; vesselId: number }
  | { type: 'loadOre'; vesselId: number }
  | { type: 'refuelAtBase'; vesselId: number }
  | { type: 'buyModule'; bodyId: BodyId; moduleId: string }
  | { type: 'placeGridModule'; bodyId: BodyId; x: number; moduleId: string }
  | { type: 'removeGridModule'; bodyId: BodyId; x: number }
  | { type: 'rendezvous'; vesselId: number }

export type GameEvent =
  | { type: 'toast'; text: string }
  | { type: 'crash'; name: string; wasActive: boolean; reason: string }
  | { type: 'mission'; id: string; title: string; reward: number }
  | { type: 'soi'; from: BodyId; to: BodyId }
  | { type: 'explosion'; size: number }
  | { type: 'achievement'; id: string; title: string; text: string }
