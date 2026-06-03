import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import * as THREE from 'three';

export default function ServerRack({ status }) {
  const meshRef = useRef();

  // Determine colors and behavior based on status
  const colorMap = {
    NOMINAL_GREEN: '#00ff00',
    WARNING_AMBER: '#ffaa00',
    CRITICAL_RED: '#ff3333',
  };

  const targetColor = colorMap[status] || colorMap.NOMINAL_GREEN;
  const isCritical = status === 'CRITICAL_RED';
  const isWarning = status === 'WARNING_AMBER';

  const baseSpeed = isCritical ? 0.05 : isWarning ? 0.02 : 0.005;

  useFrame((state, delta) => {
    if (meshRef.current) {
      // Rotation
      meshRef.current.rotation.y += baseSpeed;

      // Color lerp for smooth transition
      meshRef.current.material.emissive.lerp(new THREE.Color(targetColor), 0.1);
      meshRef.current.material.color.lerp(new THREE.Color(targetColor), 0.1);
      
      // Jitter for critical status
      if (isCritical) {
        meshRef.current.position.x = (Math.random() - 0.5) * 0.1;
        meshRef.current.position.z = (Math.random() - 0.5) * 0.1;
      } else {
        // Return to center smoothly
        meshRef.current.position.lerp(new THREE.Vector3(0, 0, 0), 0.1);
      }
    }
  });

  return (
    <group>
      <mesh ref={meshRef} position={[0, 0, 0]}>
        <boxGeometry args={[2, 5, 2]} />
        <meshStandardMaterial 
          color="#00ff00"
          emissive="#00ff00" 
          emissiveIntensity={0.8}
          transparent={true}
          opacity={0.3}
          wireframe={false}
        />
        <Edges
          linewidth={2}
          threshold={15}
          color={targetColor}
        />
      </mesh>
      
      {/* Glow rings around the server */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -2, 0]}>
        <ringGeometry args={[2.5, 2.6, 32]} />
        <meshBasicMaterial color={targetColor} transparent opacity={0.5} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 2, 0]}>
        <ringGeometry args={[2.5, 2.6, 32]} />
        <meshBasicMaterial color={targetColor} transparent opacity={0.5} />
      </mesh>
    </group>
  );
}
