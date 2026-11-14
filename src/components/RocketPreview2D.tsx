import type { PayloadId, RocketBody, RocketEngine } from '../game/types'

interface RocketPreview2DProps {
  body: RocketBody
  engine: RocketEngine
  payloadIds: PayloadId[]
}

/** Lightweight accessible fallback for browsers where a WebGL canvas cannot be created. */
export default function RocketPreview2D({ body, engine, payloadIds }: RocketPreview2DProps) {
  const bodyHeight = 130 + body.cargoSlots * 18
  const bodyTop = 215 - bodyHeight
  const engineWidth = engine.id === 'engine-titan' ? 60 : engine.id === 'engine-voyager' ? 48 : 36
  const engineLeft = (300 - engineWidth) / 2
  const engineColor = engine.id === 'engine-titan' ? '#FFAD57' : engine.id === 'engine-voyager' ? '#8298B8' : '#38D9E8'
  const cargoColors: Record<PayloadId, string> = { 'solar-panel': '#38D9E8', rover: '#FFAD57', greenhouse: '#4ADE80', habitat: '#C4A7FF' }

  return <div className="rocket-stage" aria-label={`${body.name} gövde, ${engine.name} motor, ${payloadIds.length} kargo`}>
    <div className="preview-grid" />
    <div className="pixel-satellite satellite-left" aria-hidden="true">✦</div><div className="pixel-satellite satellite-right" aria-hidden="true">·</div>
    <svg className="rocket-svg" viewBox="0 0 300 300" role="img" aria-label="Seçilen parçalara göre değişen 2D roket önizlemesi" shapeRendering="crispEdges">
      <defs><linearGradient id="rocketHull" x1="0" x2="1"><stop stopColor="#9CAECC"/><stop offset=".5" stopColor="#F3F7FF"/><stop offset="1" stopColor="#7085A6"/></linearGradient></defs>
      <rect x="132" y="232" width="12" height="12" fill={engineColor}/><rect x="144" y="244" width="12" height="12" fill="#FB7185"/><rect x="156" y="232" width="12" height="12" fill={engineColor}/>
      <rect x={150 - engineWidth / 4} y="226" width={engineWidth / 2} height="12" fill={engineColor}/>
      <rect x="106" y="203" width="24" height="24" fill="#E45B69"/><rect x="174" y="203" width="24" height="24" fill="#E45B69"/>
      <rect x={engineLeft} y="208" width={engineWidth} height={engine.id === 'engine-titan' ? 24 : 18} fill={engineColor}/><rect x={engineLeft + 6} y="215" width={engineWidth - 12} height="14" fill="#243653"/>
      <path d={`M150 ${bodyTop - 42} L174 ${bodyTop} H126 Z`} fill="#FFAD57"/><rect x="144" y={bodyTop - 10} width="12" height="14" fill="#FFE0A8"/>
      <rect x="120" y={bodyTop} width="60" height={bodyHeight} fill="url(#rocketHull)"/>
      <rect x="114" y={bodyTop + 10} width="72" height="12" fill="#C3D2E8"/><rect x="114" y="198" width="72" height="12" fill="#879BB9"/>
      <rect x="132" y={bodyTop + 32} width="36" height="31" fill="#172A49"/><rect x="138" y={bodyTop + 38} width="24" height="19" fill="#38D9E8"/>
      <rect x="144" y={bodyTop + 44} width="12" height="7" fill="#A6F2F5"/>
      {Array.from({ length: body.cargoSlots }, (_, index) => <rect key={index} x="126" y={bodyTop + 72 + index * 15} width="48" height="9" fill={index % 2 === 0 ? '#D0D9E8' : '#B4C1D7'}/>)}
      <rect x="124" y={bodyTop + 68} width="4" height={bodyHeight - 72} fill="#FFAD57"/><rect x="172" y={bodyTop + 68} width="4" height={bodyHeight - 72} fill="#FFAD57"/>
      {payloadIds.slice(0, body.cargoSlots).map((id, index) => <g key={`${id}-${index}`}>
        <rect x={index % 2 === 0 ? 42 : 204} y={bodyTop + 75 + Math.floor(index / 2) * 30} width="42" height="27" fill="#243653" stroke={cargoColors[id]} strokeWidth="3"/>
        <rect x={index % 2 === 0 ? 48 : 210} y={bodyTop + 81 + Math.floor(index / 2) * 30} width="15" height="15" fill={cargoColors[id]}/>
        <rect x={index % 2 === 0 ? 66 : 228} y={bodyTop + 84 + Math.floor(index / 2) * 30} width="12" height="4" fill="#F3F7FF"/>
      </g>)}
      <rect x="0" y="268" width="300" height="2" fill="#8294B040"/>
    </svg>
    <div className="preview-caption"><span>2D FALLBACK</span><span>{body.cargoSlots} KARGO YUVASI</span></div>
  </div>
}
