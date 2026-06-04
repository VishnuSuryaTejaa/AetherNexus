import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Edges, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { ThreatLevel } from '../types/telemetry';

interface ServerNodeProps {
  position: [number, number, number];
  region: string;
  threatLevel: ThreatLevel;
}

const COLOR_MAP: Record<ThreatLevel, string> = {
  NOMINAL_GREEN: '#00FF66',
  WARNING_AMBER: '#FFAA00',
  CRITICAL_RED: '#FF0033',
};

const SPEED_MAP: Record<ThreatLevel, number> = {
  NOMINAL_GREEN: 0.005,
  WARNING_AMBER: 0.02,
  CRITICAL_RED:  0.06,
};

const SCALE_MAP: Record<ThreatLevel, number> = {
  NOMINAL_GREEN: 1.0,
  WARNING_AMBER: 1.1,
  CRITICAL_RED:  1.5,
};

export default function ServerNode({ position, region, threatLevel }: ServerNodeProps) {
  const meshRef    = useRef<THREE.Mesh>(null);
  const ringRef    = useRef<THREE.Mesh>(null);
  const groupRef   = useRef<THREE.Group>(null);
  const targetColor = new THREE.Color(COLOR_MAP[threatLevel]);
  const isCritical = threatLevel === 'CRITICAL_RED';

  useFrame((_, delta) => {
    if (!meshRef.current || !groupRef.current) return;

    // Rotation
    meshRef.current.rotation.y += SPEED_MAP[threatLevel];
    meshRef.current.rotation.x += SPEED_MAP[threatLevel] * 0.4;

    // Ring pulse
    if (ringRef.current) {
      ringRef.current.rotation.z += 0.01;
      ringRef.current.rotation.x += 0.005;
    }

    // Smooth color transition
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    mat.emissive.lerp(targetColor, 0.08);
    mat.color.lerp(targetColor, 0.08);

    // Scale transition
    const targetScale = SCALE_MAP[threatLevel];
    groupRef.current.scale.lerp(
      new THREE.Vector3(targetScale, targetScale, targetScale), 0.05
    );

    // Jitter on CRITICAL
    if (isCritical) {
      groupRef.current.position.x = position[0] + (Math.random() - 0.5) * 0.12;
      groupRef.current.position.z = position[2] + (Math.random() - 0.5) * 0.12;
    } else {
      groupRef.current.position.lerp(
        new THREE.Vector3(position[0], position[1], position[2]), 0.1
      );
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Main server box */}
      <mesh ref={meshRef}>
        <boxGeometry args={[1.4, 3.5, 1.4]} />
        <meshStandardMaterial
          color={COLOR_MAP[threatLevel]}
          emissive={COLOR_MAP[threatLevel]}
          emissiveIntensity={isCritical ? 1.2 : 0.6}
          transparent
          opacity={0.25}
        />
        <Edges linewidth={1.5} color={COLOR_MAP[threatLevel]} />
      </mesh>

      {/* Orbital ring */}
      <mesh ref={ringRef} rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[2, 0.04, 8, 64]} />
        <meshBasicMaterial color={COLOR_MAP[threatLevel]} transparent opacity={0.5} />
      </mesh>

      {/* Bottom glow disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.8, 0]}>
        <circleGeometry args={[1.2, 32]} />
        <meshBasicMaterial color={COLOR_MAP[threatLevel]} transparent opacity={0.15} />
      </mesh>

      {/* Point light above node */}
      <pointLight
        color={COLOR_MAP[threatLevel]}
        intensity={isCritical ? 6 : 3}
        distance={8}
        decay={2}
        position={[0, 4, 0]}
      />

      {/* Region label */}
      <Text
        position={[0, -2.6, 0]}
        fontSize={0.35}
        color={COLOR_MAP[threatLevel]}
        anchorX="center"
        anchorY="middle"
        font="https://fonts.gstatic.com/s/sharetech/v17/7cHtv4Uyi5K0OeZ7bohU8H0.woff"
      >
        {region}
      </Text>

      {/* Status label */}
      <Text
        position={[0, -3.1, 0]}
        fontSize={0.25}
        color={COLOR_MAP[threatLevel]}
        anchorX="center"
        anchorY="middle"
      >
        {threatLevel.replace('_', ' ')}
      </Text>
    </group>
  );
}
