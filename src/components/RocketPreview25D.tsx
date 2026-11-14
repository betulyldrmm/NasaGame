import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import type { PayloadId, RocketBody, RocketEngine } from '../game/types'
import { FUEL_TANKS, PAYLOADS } from '../game/data'
import type { FuelTank, Payload } from '../game/types'
import RocketPreview2D from './RocketPreview2D'
import { getRocketModelSpec } from '../visualization/rocketModel'

interface PreviewProps {
  body: RocketBody
  engine: RocketEngine
  fuelTank: FuelTank | null
  payloadIds: PayloadId[]
}

function CargoModule({ id, color, position }: { id: PayloadId; color: string; position: [number, number, number] }) {
  if (id === 'solar-panel') return <group position={position}>
    <mesh castShadow><boxGeometry args={[0.25, 0.18, 0.24]}/><meshStandardMaterial color="#94a9c5" metalness={0.45} roughness={0.38}/></mesh>
    <mesh castShadow position={[0.34, 0, 0]}><boxGeometry args={[0.42, 0.08, 0.56]}/><meshStandardMaterial color={color} metalness={0.28} roughness={0.32}/></mesh>
    <mesh castShadow position={[-0.34, 0, 0]}><boxGeometry args={[0.42, 0.08, 0.56]}/><meshStandardMaterial color={color} metalness={0.28} roughness={0.32}/></mesh>
  </group>

  if (id === 'rover') return <group position={position}>
    <mesh castShadow position={[0, 0.08, 0]}><boxGeometry args={[0.42, 0.27, 0.32]}/><meshStandardMaterial color={color} metalness={0.18} roughness={0.58}/></mesh>
    {[-1, 1].map((side) => <mesh key={side} castShadow position={[side * 0.16, -0.12, 0.19]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.075, 0.075, 0.08, 8]}/><meshStandardMaterial color="#26344b" roughness={0.8}/></mesh>)}
    <mesh castShadow position={[0.1, 0.28, 0]}><boxGeometry args={[0.07, 0.28, 0.07]}/><meshStandardMaterial color="#cbd8e8" metalness={0.45}/></mesh>
  </group>

  if (id === 'greenhouse') return <group position={position}>
    <mesh castShadow><boxGeometry args={[0.5, 0.46, 0.4]}/><meshStandardMaterial color={color} metalness={0.08} roughness={0.42}/></mesh>
    <mesh position={[0, 0, 0.205]}><boxGeometry args={[0.27, 0.24, 0.015]}/><meshStandardMaterial color="#baffd2" emissive="#4ade80" emissiveIntensity={0.16}/></mesh>
    <mesh position={[0, -0.13, 0.22]}><boxGeometry args={[0.38, 0.045, 0.02]}/><meshStandardMaterial color="#276b54"/></mesh>
  </group>

  return <group position={position}>
    <mesh castShadow rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.25, 0.28, 0.48, 8]}/><meshStandardMaterial color={color} metalness={0.25} roughness={0.45}/></mesh>
    <mesh position={[0, 0.07, 0.245]}><circleGeometry args={[0.095, 8]}/><meshStandardMaterial color="#d9caff" emissive={color} emissiveIntensity={0.14}/></mesh>
    <mesh position={[0.18, 0, 0]}><boxGeometry args={[0.1, 0.1, 0.1]}/><meshStandardMaterial color="#f3f7ff" metalness={0.4}/></mesh>
  </group>
}

function RocketModel({ body, engine, fuelTank, payloadIds }: PreviewProps) {
  const tankData = fuelTank ? FUEL_TANKS.find((item) => item.id === fuelTank.id) ?? null : null
  const payloads = payloadIds.map((id) => PAYLOADS.find((item) => item.id === id)).filter((item): item is Payload => item !== undefined)
  const spec = getRocketModelSpec(body, engine, tankData, payloads)
  const engineHeight = spec.engineLength
  const tankLength = spec.tankLength
  const bodyBottom = engineHeight + tankLength
  const noseHeight = spec.bodyRadius * 1.55
  const totalHeight = bodyBottom + spec.bodyLength + noseHeight
  const bodyCenter = bodyBottom + spec.bodyLength / 2
  const rootY = -totalHeight / 2
  const engineColor = engine.id === 'engine-titan' ? '#ffad57' : engine.id === 'engine-voyager' ? '#7b91b1' : '#38d9e8'

  return <group position={[0, rootY, 0]}>
    {/* Engine bell, collar and three compact fins. */}
    <mesh castShadow receiveShadow position={[0, engineHeight / 2, 0]}>
      <coneGeometry args={[spec.engineRadius, engineHeight, 8, 1]}/>
      <meshStandardMaterial color={engineColor} metalness={0.62} roughness={0.32} flatShading/>
    </mesh>
    <mesh castShadow position={[0, engineHeight * 0.83, 0]}>
      <cylinderGeometry args={[spec.engineRadius * 0.48, spec.engineRadius * 0.48, 0.09, 8]}/>
      <meshStandardMaterial color="#d9e3f0" metalness={0.72} roughness={0.25}/>
    </mesh>
    {[0, 1, 2].map((index) => <group key={index} rotation={[0, index * Math.PI * 2 / 3, 0]}>
      <mesh castShadow position={[spec.bodyRadius * 0.92, bodyBottom - 0.1, 0]} rotation={[0, 0, -0.2]}>
        <boxGeometry args={[0.19, 0.72, 0.48]}/><meshStandardMaterial color="#ef6f72" metalness={0.2} roughness={0.52} flatShading/>
      </mesh>
    </group>)}

    {/* Optional fuel segment makes tank capacity visible in the silhouette. */}
    {fuelTank && tankLength > 0 && <group>
      <mesh castShadow receiveShadow position={[0, engineHeight + tankLength / 2, 0]}>
        <cylinderGeometry args={[spec.tankRadius, spec.tankRadius, tankLength, 10, 1]}/>
        <meshStandardMaterial color="#426e98" metalness={0.42} roughness={0.38} flatShading/>
      </mesh>
      {[engineHeight + 0.055, engineHeight + tankLength - 0.055].map((y) => <mesh key={y} castShadow position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[spec.tankRadius * 0.96, 0.045, 4, 10]}/><meshStandardMaterial color="#ffad57" metalness={0.55} roughness={0.34}/>
      </mesh>)}
    </group>}

    {/* Segmented low-poly fuselage. */}
    <mesh castShadow receiveShadow position={[0, bodyCenter, 0]}>
      <cylinderGeometry args={[spec.bodyRadius, spec.bodyRadius * 1.04, spec.bodyLength, 10, Math.max(2, body.cargoSlots)]}/>
      <meshStandardMaterial color={spec.bodyColor} metalness={0.48} roughness={0.36} flatShading/>
    </mesh>
    {Array.from({ length: body.cargoSlots + 1 }, (_, index) => {
      const y = bodyBottom + index * (spec.bodyLength / body.cargoSlots)
      return <mesh key={index} castShadow position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[spec.bodyRadius * 1.025, 0.035, 4, 10]}/><meshStandardMaterial color={index % 2 ? '#ffad57' : '#7389a7'} metalness={0.62} roughness={0.3}/>
      </mesh>
    })}
    {/* Window and nose cone. */}
    <mesh castShadow position={[0, bodyCenter + spec.bodyLength * 0.28, spec.bodyRadius * 0.91]}>
      <sphereGeometry args={[spec.bodyRadius * 0.22, 8, 6]}/><meshStandardMaterial color="#38d9e8" metalness={0.28} roughness={0.18} emissive="#147d99" emissiveIntensity={0.22}/>
    </mesh>
    <mesh castShadow position={[0, bodyBottom + spec.bodyLength + noseHeight / 2 - 0.03, 0]}>
      <coneGeometry args={[spec.bodyRadius, noseHeight, 8, 1]}/><meshStandardMaterial color="#ffad57" metalness={0.35} roughness={0.32} flatShading/>
    </mesh>

    {/* Selected cargo sits beside its matching bay; each module has its own color and silhouette. */}
    {spec.payloads.map(({ id, color, index }) => {
      const bayY = bodyBottom + spec.bodyLength * ((index + 0.72) / (body.cargoSlots + 1))
      return <CargoModule key={`${id}-${index}`} id={id} color={color} position={[spec.bodyRadius + 0.37, bayY, 0.08]}/>
    })}

    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.025, 0]}>
      <circleGeometry args={[2.55, 32]}/><meshStandardMaterial color="#13213a" roughness={0.9} metalness={0.12}/>
    </mesh>
  </group>
}

function Stage(props: PreviewProps) {
  return <>
    <color attach="background" args={['#0b1428']}/>
    <ambientLight intensity={0.75}/>
    <directionalLight position={[4, 8, 5]} intensity={2.1} castShadow shadow-mapSize-width={768} shadow-mapSize-height={768} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={8} shadow-camera-bottom={-6}/>
    <pointLight position={[-3, 1.5, -2]} color="#38d9e8" intensity={16} distance={11}/>
    <pointLight position={[3, -1, 3]} color="#aa82ff" intensity={7} distance={8}/>
    <RocketModel {...props}/>
  </>
}

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!context) return false
    context.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

class PreviewErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* The 2D renderer remains available as a local fallback. */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export default function RocketPreview25D(props: PreviewProps) {
  const [webglAvailable] = useState(hasWebGL)
  const fallback = <div className="preview-fallback">
    <p role="status">3B görünümü açılamadı; 2D önizleme gösteriliyor.</p>
    <RocketPreview2D body={props.body} engine={props.engine} payloadIds={props.payloadIds}/>
  </div>

  if (!webglAvailable) return fallback

  return <div className="rocket-preview-25d" role="img" aria-label={`${props.body.name} roketinin 2.5D önizlemesi`}>
    <div className="preview-stars" aria-hidden="true"/>
    <PreviewErrorBoundary fallback={fallback}>
      <Canvas
        orthographic
        shadows
        dpr={[1, 1.5]}
        frameloop="demand"
        camera={{ position: [6, 4, 10], zoom: 32, near: 0.1, far: 80 }}
        gl={{ alpha: false, antialias: true, powerPreference: 'low-power' }}
      >
        <Stage {...props}/>
      </Canvas>
    </PreviewErrorBoundary>
    <div className="preview-caption"><span>2.5D // LOW POLY</span><span>{props.body.cargoSlots} KARGO YUVASI</span></div>
  </div>
}
