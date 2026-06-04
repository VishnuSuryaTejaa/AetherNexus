import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Stars, OrbitControls, CameraShake, Grid } from '@react-three/drei';
import * as THREE from 'three';
import ServerNode from './ServerNode';
import { ThreatLevel } from '../types/telemetry';

interface NodeConfig {
  region: string;
  position: [number, number, number];
  threatLevel: ThreatLevel;
}

interface NetworkGridProps {
  globalThreat: ThreatLevel;
  nodeStatuses: Record<string, ThreatLevel>;
}

const NODES: Omit<NodeConfig, 'threatLevel'>[] = [
  { region: 'US-East-1', position: [-5, 0, 0] },
  { region: 'EU-West-1', position: [0,  0, 0] },
  { region: 'AP-South-1', position: [5, 0, 0] },
];

function GridFloor() {
  return (
    <Grid
      args={[40, 40]}
      position={[0, -4, 0]}
      cellSize={1}
      cellThickness={0.4}
      cellColor="#003322"
      sectionSize={5}
      sectionThickness={0.8}
      sectionColor="#005533"
      fadeDistance={30}
      fadeStrength={2}
      infiniteGrid
    />
  );
}

export default function NetworkGrid({ globalThreat, nodeStatuses }: NetworkGridProps) {
  const isCritical = globalThreat === 'CRITICAL_RED';

  return (
    <>
      <color attach="background" args={['#020a06']} />
      <fog attach="fog" args={['#020a06', 15, 40]} />

      <ambientLight intensity={0.15} />
      <directionalLight position={[0, 10, 5]} intensity={0.3} color="#ffffff" />

      <Stars
        radius={80}
        depth={60}
        count={4000}
        factor={3}
        saturation={0.2}
        fade
        speed={isCritical ? 4 : 0.8}
      />

      <GridFloor />

      {NODES.map((node) => (
        <ServerNode
          key={node.region}
          region={node.region}
          position={node.position}
          threatLevel={nodeStatuses[node.region] ?? 'NOMINAL_GREEN'}
        />
      ))}

      <OrbitControls
        enablePan={false}
        minDistance={6}
        maxDistance={22}
        maxPolarAngle={Math.PI / 2.1}
      />

      {isCritical && (
        <CameraShake
          maxYaw={0.04}
          maxPitch={0.04}
          maxRoll={0.04}
          yawFrequency={0.6}
          pitchFrequency={0.6}
          rollFrequency={0.4}
          intensity={1}
        />
      )}
    </>
  );
}
