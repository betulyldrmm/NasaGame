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
  | 'weapon'
  | 'armor'
  | 'shield'

export type PartCategory = 'Komuta' | 'Yakıt' | 'Motorlar' | 'Kademe' | 'Güç' | 'İniş' | 'Kargo' | 'Silahlar' | 'Savunma'

export type WeaponKind =
  | 'ballistic'
  | 'flak'
  | 'railgun'
  | 'beam'
  | 'plasma'
  | 'rocket'
  | 'missile'
  | 'torpedo'
  | 'emp'

export interface WeaponSpec {
  kind: WeaponKind
  /** 1: Toplar/Lazer · 2: Füzeler/Roketler · 3: Kuşatma/EMP */
  group: 1 | 2 | 3
  dmg: number
  /** Koloni yapılarına karşı hasar çarpanı (varsayılan 1) */
  colonyMult?: number
  /** Enerji kalkanlarına karşı hasar çarpanı */
  shieldMult?: number
  /** Kalkanı delen hasar oranı (0..1) */
  shieldPierce?: number
  /** Atışlar arası bekleme (s) */
  cooldown: number
  /** Namlu çıkış hızı (m/s), beam için 0 */
  speed: number
  /** Anlık ışın menzili (m) */
  range?: number
  /** Mermi ömrü (s) */
  ttl: number
  /** Patlama etki yarıçapı (m) */
  splash?: number
  /** Saçma sayısı (flak için) */
  pellets?: number
  /** Namlu dağılımı (rad) */
  spread?: number
  /** Başlangıç cephanesi (undefined = sınırsız, yalnızca elektrik harcar) */
  ammo?: number
  /** Atış başına elektrik tüketimi */
  ecUse?: number
  /** Geri tepme itkisi (kN·s) */
  recoil?: number
  /** Buruna göre taret dönüş açısı sınırı (rad) */
  gimbal?: number
  /** Güdümlü füze dönüş hızı (rad/s) */
  turnRate?: number
  /** Yerçekimi çarpanı (0 = düz gider, 1 = tam yerçekimi) */
  gravityScale?: number
  /** Vurulan araçtan çekilen elektrik */
  empDrain?: number
  /** Vurulan araç/taret devre dışı kalma süresi (s) */
  empStun?: number
  /** Yakınlık tapası tetikleme mesafesi (m) */
  proximity?: number
  /** Tetik tutma şarj süresi (s) — raylı top / ölüm lazeri için */
  chargeTime?: number
  /** Şarj sonrası kesintisiz ışın süresi (s; 0/tanımsız = basılı tutulduğu sürece) */
  beamDuration?: number
  /** Basılı tutarken kesintisiz ışın yakar (Odak Lazeri) */
  beamSustain?: boolean
  /** Işın kalınlığı (m) */
  beamWidth?: number
  /** Tek atışta delip geçeceği parça/bina sayısı */
  overpenetrate?: number
  /** Seri atış (burst) sayısı ve aralığı (s) */
  burstCount?: number
  burstInterval?: number
  /** Zincir hızlanma (FTL Vulcan): en düşük bekleme ve hızlanma oranı */
  minCooldown?: number
  spinRate?: number
  /** Plazma yanma hasarı süresi (s) */
  burnDot?: number
  /** Kalkana ekstra düz hasar (EMP İyon için) */
  shieldFlat?: number
  /** İsabet alan geminin silah şarjını sıfırlar (EMP) */
  resetCharge?: boolean
  color: string
}

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
  /** parça canı (savaş modunda) */
  hp?: number
  /** enerji kalkanı kapasitesi */
  shieldCap?: number
  /** silah özellikleri */
  weapon?: WeaponSpec
  /** zırh: komşu parçalara gelen hasarın `absorb` oranını üstlenir; her isabetten `hardness` kadar hasarı siler */
  armor?: { absorb: number; hardness: number }
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
  /**
   * kalan parça canı (undefined = tam). 0 veya altı: parça devre dışıdır (motor itmez, tank boşalır,
   * silah susar) ama iskelet olarak gövdede kalır; −maxHp·0.75 altına inerse gövdeden kopar.
   */
  hp?: number
  /** kalan cephane */
  ammo?: number
  /** kalan silah bekleme süresi / hazır olacağı sim.clock (s) */
  cd?: number
  /** 0..1 silah şarjı veya Vulcan dönüş hızı */
  charge?: number
  /** seri atışta kalan mermi ve sonraki alt-atış saati */
  burstLeft?: number
  burstCd?: number
  /** son ateşleme saati (namlu tepmesi ve alev animasyonu için) */
  fireAt?: number
  /** dev ışın aktif kalma süresi (sim.clock) */
  beamUntil?: number
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
  /** Yağma modu: oyuncunun uzay üssü (kontrol edilemez, taretleri kendiliğinden ateş eder) */
  outpost?: { level: number; rebuildAt?: number }
  /** yörünge yakalama yanışı başladı: bitene kadar kesilmez (titreşimi önler) */
  captureLatch?: boolean
  /** çok oyunculu modda her aracın/oyuncunun kendi hedef gök cismi */
  targetBody?: BodyId
  /** ayrılma/enkaz sonrası aynı sahibin parçalarıyla kısa çarpışma muafiyeti (oyun zamanı s) */
  noCollideUntil?: number
  /** son çarpışmada / saldırıda hasar veren oyuncu */
  lastAttackerId?: string
  /** enerji kalkanı (savaş modu) */
  shield?: number
  /** bu sim.clock saatine kadar kalkan yenilenmez */
  shieldRegenAt?: number
  /** EMP darbesiyle silah/kalkan devre dışı bitiş saati (sim.clock) */
  empUntil?: number
  /** yeni fırlatılan aracın kısa rampa koruması (sim.clock) */
  spawnShieldUntil?: number
  /** son nişan alınan dünya açısı (taret çizimi için) */
  aimAngle?: number
  /** plazma yanığı bitiş saati (sim.clock) */
  burnUntil?: number
  /** Tek oyunculu "hedefe git": hedefte yörüngeye oturunca otomatik inişe geçilecek cisim */
  landAt?: BodyId
  /** Çok oyunculu arcade hızlı yolculuk: başlangıç ve varış (atmosfer sınırı) arasında kısa süreli geçiş */
  cruise?: {
    from: BodyId
    fromRel: { x: number; y: number }
    to: BodyId
    toRel: { x: number; y: number }
    toVel: { x: number; y: number }
    /** gerçek saat (sim.clock) */
    start: number
    dur: number
  }
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
  /** koloni yuvalarının kalan canı (undefined = tam can) */
  siteHp?: (number | null)[]
  /** kargoyla getirilip henüz kurulmamış yapılar */
  stock?: Record<string, number>
  /** eski 4×4 grid (yalnızca eski kayıtları okumak için) */
  grid?: PlanetTile[]
  /** tamamlanan sektör tarama sayısı (her temizlikte artar) */
  sectorLevel?: number
  /** çok oyunculu hazırlığı: üs sahibi oyuncu kimliği */
  ownerId?: string
  /** koloni kalkan kubbesi canı */
  shield?: number
  /** kalkanın yeniden dolmaya başlayacağı saat (sim.clock) */
  shieldRegenAt?: number
  /** EMP ile devre dışı kalma bitiş saati (sim.clock) */
  stunUntil?: number
  /** savunma taretleri kalan bekleme süresi (s) */
  turretCd?: number
  /** yok edilmiş koloni bayrağı */
  destroyed?: boolean
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

export type MultiplayerMode = 'colony-race' | 'orbital-warfare' | 'loot-raid'

/** Yağma modunda uzayda süzülen kargo sandığı. */
export interface LootCrate {
  id: number
  pos: { x: number; y: number }
  vel: { x: number; y: number }
  /** içindeki ganimet (t) */
  tons: number
  /** hangi kaynak sahasından çıktı (−1: gemi/üs enkazı) */
  site: number
  born: number
}

export interface LootSite {
  pos: { x: number; y: number }
  name: string
  /** saniyede üretilen ganimet (t/s) ve aynı anda bulunabilecek sandık sayısı */
  rate: number
  max: number
  /** bir sonraki sandığa kadar birikmiş üretim */
  acc: number
}

export interface LootState {
  /** arena merkezi (Dünya çerçevesi) ve yarıçapı (m) */
  center: { x: number; y: number }
  radius: number
  sites: LootSite[]
  crates: LootCrate[]
  nextCrateId: number
  /** çekirdeği yok edilen üslerin yeniden kurulacağı saat (sim.clock), oyuncu kimliğine göre */
  rebuild?: Record<string, number>
}
export type WarfareGoal = 'siege' | 'score15' | 'score30' | 'endless'

export interface MultiplayerConfig {
  /** Çok oyunculu oyun modu */
  mode?: MultiplayerMode
  /** Uzay Savaşı modunda zafer koşulu */
  warfareGoal?: WarfareGoal
  /** Yağma modunda kazanmak için üsse taşınması gereken ganimet (t); 0 = sonsuz */
  lootGoal?: number
  /** Kazanmak için gereken gezegen sayısı (0 = sınırsız fetih) */
  targetPlanets: number
  startingMoney: number
  passiveBonusPerPlanet: number
  allowAutoWarp: boolean
}

export interface Projectile {
  id: number
  ownerId: string
  vesselId: number
  weaponId: string
  kind: WeaponKind
  bodyId: BodyId
  pos: { x: number; y: number }
  vel: { x: number; y: number }
  born: number
  ttl: number
  dmg: number
  colonyMult: number
  shieldMult: number
  shieldPierce: number
  splash: number
  gravityScale: number
  turnRate: number
  targetId?: number
  empDrain: number
  empStun: number
  proximity: number
  traveled?: number
  refVel?: { x: number; y: number }
  airburstRange?: number
  overpenetrate?: number
  hitIds?: number[]
  burnDot?: number
  shieldFlat?: number
  resetCharge?: boolean
  color: string
  /** düşman koloni savunmasından ateşlendiyse */
  fromColony?: boolean
}

export interface PlanetCapture {
  bodyId: BodyId
  ownerId: string | null
  flagAngle: number
  progress: number
  capturerId: string | null
  phase: 'idle' | 'neutralizing' | 'claiming' | 'contested' | 'captured'
  /** Aynı istasyonu sök-tak yaparak tekrar tekrar fetih ödülü almayı engeller. */
  lastRewardedId?: string
}

export interface MultiplayerPlayer {
  id: string
  username: string
  color: string
  slot: number
  money: number
  targetBody: BodyId
  activeVesselId: number | null
  /** -1 = akıllı otomatik zaman hızı, 0..N = oyuncu tercihi */
  wantsWarpIdx: number
  /** true: oyuncu zaman hızını 1×'e kilitli tutar */
  warpAnchor: boolean
  /** son manuel kontrol zamanı (Date.now / clock s) */
  lastManualAt?: number
  planetsHeld: number
  captures: number
  kills: number
  score?: number
  coloniesDestroyed?: number
  eliminated?: boolean
  earthBase?: Base
  /** Uzay Savaşı modunda her oyuncunun kendi gezegen kolonileri */
  colonies?: Partial<Record<BodyId, Base>>
  /** Yağma modu: üsse teslim edilen toplam ganimet (t) ve üs seviyesi */
  looted?: number
  outpostLevel?: number
}

export interface DynamicWarpInfo {
  warpIdx: number
  warp: number
  mode: 'auto' | 'manual' | 'combat' | 'landing' | 'burn' | 'anchor'
  reason: string
  throttledBy?: string
  nearestInterceptM?: number | null
}

export interface MultiplayerFeedItem {
  id: number
  time: number
  text: string
  color?: string
}

export interface MultiplayerState {
  roomId: string
  hostId: string
  started: boolean
  winnerId: string | null
  config: MultiplayerConfig
  players: Record<string, MultiplayerPlayer>
  captures: Partial<Record<BodyId, PlanetCapture>>
  warpInfo: DynamicWarpInfo
  feed: MultiplayerFeedItem[]
  projectiles?: Projectile[]
  nextProjId?: number
  /** Yağma modu durumu: arena, kaynak sahaları ve sandıklar */
  loot?: LootState
}

export interface GameState {
  /** oyun saati (s) */
  time: number
  /** deterministik adım sayacı (çok oyunculu senkron hazırlığı) */
  tick?: number
  protocolVersion?: number
  ownerId?: string
  players?: Record<string, PlayerMeta>
  /** Çok oyunculu "Gezegenleri Ele Geçir" maç durumu (yalnızca çok oyunculu modda) */
  mp?: MultiplayerState
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
  /** Tek oyunculu test atışları için geçici mermiler */
  projectiles?: Projectile[]
  nextProjId?: number
}

/** Çok oyunculu hazırlığı: serileştirilebilir oyuncu komutları. */
export type GameCommand =
  | { type: 'launch'; design?: PartInst[]; designCargo?: Record<string, number> }
  | { type: 'setActive'; vesselId: number }
  | { type: 'setThrottle'; vesselId: number; throttle: number }
  | { type: 'emergencyStop'; vesselId: number }
  | { type: 'clickPart'; vesselId: number; index: number }
  | { type: 'setWarpPref'; warpIdx: number; anchor?: boolean }
  | { type: 'stage'; vesselId: number }
  | { type: 'dock'; vesselId: number; targetId: number }
  | { type: 'deleteVessel'; vesselId: number }
  | { type: 'recoverVessel'; vesselId: number }
  | { type: 'setTarget'; bodyId: BodyId }
  | { type: 'setAutopilot'; vesselId: number; mode: AutopilotMode }
  | { type: 'setSas'; vesselId: number; sas: SasMode }
  | { type: 'toggleRcs'; vesselId: number }
  | { type: 'togglePartKind'; vesselId: number; kind: 'solar' | 'leg' | 'chute' }
  | { type: 'deployModules'; vesselId: number; moduleId?: string }
  | { type: 'pickupModule'; vesselId: number; moduleId: string }
  | { type: 'loadOre'; vesselId: number }
  | { type: 'refuelAtBase'; vesselId: number }
  | { type: 'buyModule'; bodyId: BodyId; moduleId: string }
  | { type: 'placeGridModule'; bodyId: BodyId; x: number; moduleId: string }
  | { type: 'removeGridModule'; bodyId: BodyId; x: number }
  | { type: 'rendezvous'; vesselId: number }
  | { type: 'repairVessel'; vesselId: number }
  | { type: 'upgradeOutpost' }
  | { type: 'jettisonCargo'; vesselId: number }

export type GameEvent =
  | { type: 'toast'; text: string; ownerId?: string }
  | { type: 'crash'; name: string; wasActive: boolean; reason: string; ownerId?: string; vesselId?: number }
  | { type: 'mission'; id: string; title: string; reward: number }
  | { type: 'soi'; from: BodyId; to: BodyId; ownerId?: string }
  | { type: 'explosion'; size: number; bodyId?: BodyId; x?: number; y?: number }
  | { type: 'weaponFire'; weaponId: string; kind: WeaponKind; bodyId: BodyId; x: number; y: number; pitch?: number }
  | { type: 'shieldHit'; bodyId: BodyId; x: number; y: number }
  | { type: 'achievement'; id: string; title: string; text: string }
  | { type: 'capture'; bodyId: BodyId; ownerId: string | null; previousOwnerId: string | null; text: string }
  | { type: 'colonyDestroyed'; bodyId: BodyId; victimId: string; attackerId: string; text: string }
  | { type: 'kill'; attackerId: string | null; victimId: string | null; victimName: string; speed: number }
  | { type: 'victory'; winnerId: string; winnerName: string }
