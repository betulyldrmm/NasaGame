import { elementsFromState } from '../flight/orbit'
import { BODIES, type BodyId } from '../nasa/bodies'
import type { GameState, Vessel } from './types'

export interface MissionDef {
  id: string
  title: string
  desc: string
  reward: number
  /** Aktif araç durumuna bakarak tamamlanır; olay tabanlı görevlerde yoktur. */
  check?: (v: Vessel, gs: GameState) => boolean
}

function inOrbit(v: Vessel, id: BodyId, minPeriAlt: number): boolean {
  if (v.bodyId !== id || v.landed) return false
  const b = BODIES[id]
  const el = elementsFromState(v.pos, v.vel, b.mu)
  return el.e < 1 && el.rp - b.radius > minPeriAlt && el.ra < b.soi
}

const alt = (v: Vessel) => Math.hypot(v.pos.x, v.pos.y) - BODIES[v.bodyId].radius

export const MISSIONS: MissionDef[] = [
  { id: 'space', title: 'Uzaya ulaş', desc: 'Dünya atmosferinin (30 km) üstüne çık.', reward: 1500, check: (v) => v.bodyId === 'earth' && alt(v) > BODIES.earth.atmoHeight },
  { id: 'earth-orbit', title: 'Dünya yörüngesine yerleş', desc: 'Enberisi atmosferin üstünde kalan kapalı bir yörünge kur.', reward: 6000, check: (v) => inOrbit(v, 'earth', BODIES.earth.atmoHeight) },
  { id: 'iss-dock', title: 'ISS\'e kenetlen', desc: 'Dünya yörüngesindeki uzay istasyonuna yanaş ve kenetlen.', reward: 8000 },
  { id: 'iss-cargo', title: 'ISS\'e kargo götür', desc: 'Montajda kargoya ISS İkmal Kargosu yükle, istasyona kenetlenip teslim et.', reward: 12000 },
  { id: 'moon-soi', title: 'Ay\'ın etki alanına gir', desc: 'Transfer yörüngesiyle Ay\'ın çekim alanına (SOI) ulaş.', reward: 5000, check: (v) => v.bodyId === 'moon' },
  { id: 'moon-orbit', title: 'Ay yörüngesine yerleş', desc: 'Ay çevresinde enberisi 3 km üstünde kapalı yörünge kur.', reward: 10000, check: (v) => inOrbit(v, 'moon', 3000) },
  { id: 'moon-land', title: 'Ay\'a yumuşak iniş', desc: 'Ay yüzeyine sağlam in.', reward: 20000, check: (v) => v.bodyId === 'moon' && v.landed },
  { id: 'moon-base', title: 'Ay kolonisini kur', desc: 'Ay\'a en az bir yapı kur (Güneş Paneli, Yaşam Küresi…).', reward: 15000, check: (_v, gs) => Object.values(gs.bases.moon?.modules ?? {}).some((n) => n > 0) || (gs.quadrantBases?.moon ?? []).some((q) => Object.values(q?.modules ?? {}).some((n) => n > 0)) },
  { id: 'grav-assist', title: 'Yerçekimi sapanı', desc: 'Motor yakmadan bir gök cisminin yanından geçerek hız kazan.', reward: 8000 },
  { id: 'earth-return', title: 'Eve dönüş', desc: 'Ay\'ı ziyaret etmiş bir aracı Dünya\'ya indir ve kurtar.', reward: 15000 },
  { id: 'ore-return', title: 'Uzay madenciliği', desc: 'Başka bir gök cisminden Dünya\'ya maden getir ve sat.', reward: 12000 },
  { id: 'mars-soi', title: 'Mars\'ın etki alanına gir', desc: 'Gezegenler arası transferle Mars\'a ulaş.', reward: 25000, check: (v) => v.bodyId === 'mars' },
  { id: 'mars-orbit', title: 'Mars yörüngesine yerleş', desc: 'Mars çevresinde kapalı yörünge kur.', reward: 42000, check: (v) => inOrbit(v, 'mars', BODIES.mars.atmoHeight) },
  { id: 'mars-land', title: 'Mars\'a iniş', desc: 'Mars yüzeyine sağlam in.', reward: 80000, check: (v) => v.bodyId === 'mars' && v.landed },
  { id: 'mars-base', title: 'Mars üssünü kur', desc: 'Mars\'a en az bir üs modülü indir ve kur.', reward: 60000, check: (_v, gs) => Object.values(gs.bases.mars?.modules ?? {}).some((n) => n > 0) || (gs.quadrantBases?.mars ?? []).some((q) => Object.values(q?.modules ?? {}).some((n) => n > 0)) },
  { id: 'venus-land', title: 'Venüs\'e iniş', desc: 'Yoğun bulutların arasından geçip Venüs yüzeyine sağlam in.', reward: 95000, check: (v) => v.bodyId === 'venus' && v.landed },
  { id: 'mercury-land', title: 'Merkür\'e iniş', desc: 'Güneş\'e en yakın gezegen Merkür yüzeyine sağlam in.', reward: 110000, check: (v) => v.bodyId === 'mercury' && v.landed },
  { id: 'ceres-land', title: 'Ceres\'e iniş', desc: 'Asteroit kuşağındaki cüce gezegen Ceres\'e in.', reward: 125000, check: (v) => v.bodyId === 'ceres' && v.landed },
  { id: 'ganymede-land', title: 'Ganimed\'e iniş', desc: 'Jüpiter sistemine ulaşıp Ganimed uydusuna in.', reward: 165000, check: (v) => v.bodyId === 'ganymede' && v.landed },
  { id: 'titan-land', title: 'Titan\'a iniş', desc: 'Satürn\'ün halkalı devinin uydusu Titan\'a in.', reward: 260000, check: (v) => v.bodyId === 'titan' && v.landed },
]

export const MISSION_BY_ID: Record<string, MissionDef> = Object.fromEntries(MISSIONS.map((m) => [m.id, m]))
