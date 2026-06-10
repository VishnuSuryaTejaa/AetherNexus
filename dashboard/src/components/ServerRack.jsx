import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

const rackWidth = 1.5;
const rackHeight = 5;
const rackDepth = 1.5;

const frameGeo = new THREE.BoxGeometry(rackWidth, rackHeight, rackDepth);
const frameMat = new THREE.MeshStandardMaterial({
  color: '#1a1c23',
  metalness: 0.9,
  roughness: 0.3,
});

const ventGeo = new THREE.BoxGeometry(rackWidth + 0.02, rackHeight - 0.2, rackDepth - 0.2);
const ventMat = new THREE.MeshBasicMaterial({
  color: '#111111',
  wireframe: true,
  transparent: true,
  opacity: 0.2
});

const numBlades = 12;
const bladeHeight = (rackHeight - 0.4) / numBlades - 0.05;
const bladeGeo = new THREE.BoxGeometry(rackWidth - 0.1, bladeHeight, rackDepth - 0.1);
const bladeMat = new THREE.MeshStandardMaterial({
  color: '#3a3e49',
  metalness: 0.7,
  roughness: 0.4,
});

const ledsPerBlade = 4;
const totalLEDs = numBlades * ledsPerBlade;
const ledGeo = new THREE.BoxGeometry(0.05, 0.05, 0.02);
const ledMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

const sharedColor = new THREE.Color();

export default function ServerRack({ position, label, status, healingProgress }) {
  const ledMeshRef = useRef();

  const colorMap = useMemo(() => ({
    NOMINAL_GREEN: { base: new THREE.Color('#00ff41'), dim: new THREE.Color('#003311') },
    WARNING_AMBER: { base: new THREE.Color('#ffb000'), dim: new THREE.Color('#442200') },
    CRITICAL_RED:  { base: new THREE.Color('#ff003c'), dim: new THREE.Color('#330000') },
    HEALING:       { base: new THREE.Color('#ffd700'), dim: new THREE.Color('#554400') },
  }), []);

  const currentColors = colorMap[status] || colorMap.NOMINAL_GREEN;
  
  const ledData = useMemo(() => {
    const data = [];
    const startY = -rackHeight / 2 + 0.2 + bladeHeight / 2;
    for (let i = 0; i < numBlades; i++) {
      const y = startY + i * (bladeHeight + 0.05);
      for (let j = 0; j < ledsPerBlade; j++) {
        const x = (rackWidth / 2) - 0.2 - (j * 0.1);
        const z = rackDepth / 2 + 0.01;
        const matrix = new THREE.Matrix4();
        matrix.setPosition(x, y, z);
        data.push({
          matrix,
          blinkOffset: Math.random() * Math.PI * 2,
          blinkSpeed: 2 + Math.random() * 5
        });
      }
    }
    return data;
  }, []);

  useFrame((state) => {
    if (!ledMeshRef.current) return;
    const time = state.clock.elapsedTime;
    
    const speedMultiplier = status === 'CRITICAL_RED' ? 4 : (status === 'WARNING_AMBER' ? 2 : (status === 'HEALING' ? 3 : 1));
    
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
    
    if (status !== 'NOMINAL_GREEN') {
      ledMeshRef.current.instanceMatrix.needsUpdate = true;
      if (ledMeshRef.current.instanceColor) {
        ledMeshRef.current.instanceColor.needsUpdate = true;
      }
    }
  });

  return (
    <group position={position}>
      <mesh geometry={frameGeo} material={frameMat} />
      <mesh geometry={ventGeo} material={ventMat} />
      
      {Array.from({ length: numBlades }).map((_, i) => {
        const y = -rackHeight / 2 + 0.2 + bladeHeight / 2 + i * (bladeHeight + 0.05);
        return (
          <mesh 
            key={i} 
            geometry={bladeGeo} 
            material={bladeMat} 
            position={[0, y, 0.02]} 
          />
        );
      })}

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
