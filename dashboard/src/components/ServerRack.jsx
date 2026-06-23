import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Edges } from '@react-three/drei';
import * as THREE from 'three';

// 1. Master Dimensions
const rackWidth = 1.5;
const rackHeight = 4.5;
const rackDepth = 1.5;

// 2. The Glass Casing Blueprint
const frameGeo = new THREE.BoxGeometry(rackWidth, rackHeight, rackDepth);

// 3. The Solid Server Slabs (10 thick blades with distinct gaps)
const numBlades = 10;
const bladeHeight = 0.25;
const bladeDepth = 1.3; // Slightly shorter than the glass case so they sit inside
const bladeGeo = new THREE.BoxGeometry(rackWidth - 0.2, bladeHeight, bladeDepth);
const bladeMat = new THREE.MeshStandardMaterial({
  color: '#1a1a1a', // Deep, flat grey to make the lights pop
  metalness: 0.4,
  roughness: 0.9,
});

// 4. The Glowing Orbs (LEDs)
const ledsPerBlade = 4;
const totalLEDs = numBlades * ledsPerBlade;
const ledGeo = new THREE.SphereGeometry(0.035, 16, 16); // Tiny spheres instead of boxes
const ledMat = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  emissive: '#ffffff', // Emissive makes it act like a real lightbulb!
  emissiveIntensity: 2.5,
});

const sharedColor = new THREE.Color();

export default function ServerRack({ position, label, status, healingProgress }) {
  const ledMeshRef = useRef();

  const colorMap = useMemo(() => ({
    NOMINAL_GREEN: { base: new THREE.Color('#00ff41'), dim: new THREE.Color('#002208') },
    WARNING_AMBER: { base: new THREE.Color('#ffb000'), dim: new THREE.Color('#331a00') },
    CRITICAL_RED: { base: new THREE.Color('#ff003c'), dim: new THREE.Color('#220000') },
    HEALING: { base: new THREE.Color('#00e5ff'), dim: new THREE.Color('#003344') },
  }), []);

  const currentColors = colorMap[status] || colorMap.NOMINAL_GREEN;

  // 5. The Mathematical Layout of the LEDs
  const ledData = useMemo(() => {
    const data = [];
    const spacing = rackHeight / numBlades; // Vertical gap between blades
    const startY = (rackHeight / 2) - (spacing / 2); // Top-most blade position

    for (let i = 0; i < numBlades; i++) {
      const y = startY - (i * spacing); // Step down for each blade
      for (let j = 0; j < ledsPerBlade; j++) {
        // Space the 4 LEDs perfectly across the front of the blade
        const x = -0.45 + (j * 0.3);
        const z = (bladeDepth / 2) + 0.015; // Mount them just on the front face

        const matrix = new THREE.Matrix4();
        matrix.setPosition(x, y, z);
        data.push({
          matrix,
          blinkOffset: Math.random() * Math.PI * 2,
          blinkSpeed: 0.5 + Math.random() * 1.5 // A slower, more realistic idle blink
        });
      }
    }
    return data;
  }, []);

  useFrame((state) => {
    if (!ledMeshRef.current) return;
    const time = state.clock.elapsedTime;

    // Frantic blinking if the server is dying
    const speedMultiplier = status === 'CRITICAL_RED' ? 6 : (status === 'WARNING_AMBER' ? 3 : (status === 'HEALING' ? 4 : 1));

    ledData.forEach((led, i) => {
      ledMeshRef.current.setMatrixAt(i, led.matrix);
      const blink = Math.sin(time * led.blinkSpeed * speedMultiplier + led.blinkOffset);

      if (blink > 0) {
        sharedColor.copy(currentColors.base);
      } else {
        sharedColor.copy(currentColors.dim);
      }
      ledMeshRef.current.setColorAt(i, sharedColor);
    });

    ledMeshRef.current.instanceMatrix.needsUpdate = true;
    if (ledMeshRef.current.instanceColor) {
      ledMeshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group position={position}>

      {/* ATOMIC CHANGE 1: The Glass Display Case */}
      <mesh geometry={frameGeo}>
        {/* We make the box black, but highly transparent so you can see inside */}
        <meshStandardMaterial color="#000000" transparent opacity={0.15} depthWrite={false} />
        {/* We wrap the box in a wireframe Edge helper to get that crisp grey outline */}
        <Edges scale={1} threshold={15} color="#555555" />
      </mesh>

      {/* ATOMIC CHANGE 2: The Thick Solid Blades */}
      {Array.from({ length: numBlades }).map((_, i) => {
        const spacing = rackHeight / numBlades;
        const y = (rackHeight / 2) - (spacing / 2) - (i * spacing);
        return (
          <mesh
            key={i}
            geometry={bladeGeo}
            material={bladeMat}
            position={[0, y, 0]}
          />
        );
      })}

      {/* ATOMIC CHANGE 3: The Glowing Orbs */}
      <instancedMesh ref={ledMeshRef} args={[ledGeo, ledMat, totalLEDs]}>
        <instancedBufferAttribute attach="instanceColor" args={[new Float32Array(totalLEDs * 3), 3]} />
      </instancedMesh>

      <Html center position={[0, -3.2, 0]}>
        <div style={{
          color: currentColors.base.getStyle(),
          fontFamily: 'monospace',
          textShadow: `0 0 8px ${currentColors.base.getStyle()}`,
          fontWeight: 'bold',
          letterSpacing: '1px',
          whiteSpace: 'nowrap',
          textAlign: 'center'
        }}>
          <div>{label}</div>
          {healingProgress !== undefined && healingProgress !== null && (
            <div style={{ marginTop: '5px', width: '100px', height: '10px', border: `1px solid ${currentColors.base.getStyle()}`, background: 'rgba(0,0,0,0.5)' }}>
              <div style={{ width: `${healingProgress}%`, height: '100%', background: currentColors.base.getStyle(), transition: 'width 0.3s ease' }} />
              <div style={{ fontSize: '10px', marginTop: '2px', color: '#fff' }}>Healing: {healingProgress}%</div>
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}