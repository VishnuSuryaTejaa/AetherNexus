import { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { io } from 'socket.io-client';
import ServerRack from './components/ServerRack';
import Diagnostics from './components/Diagnostics';
import DevOpsControls from './components/DevOpsControls';
import './App.css';

const GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000';

const packetGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const packetMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

const gatewayGeo = new THREE.BoxGeometry(3, 0.5, 2);
const rackMat = new THREE.MeshStandardMaterial({
  color: '#2a2e39',
  metalness: 0.8,
  roughness: 0.2,
  transparent: true,
  opacity: 0.9,
});

function ApiGateway({ position }) {
  return (
    <group position={position}>
      <mesh geometry={gatewayGeo} material={rackMat} />
      <mesh>
        <boxGeometry args={[3.1, 0.6, 2.1]} />
        <meshBasicMaterial color="#00e5ff" wireframe transparent opacity={0.5} />
      </mesh>
      <Html center position={[0, 1, 0]}>
        <div style={{ color: '#00e5ff', fontFamily: 'monospace', textShadow: `0 0 5px #00e5ff`, fontWeight: 'bold' }}>
          API GATEWAY
        </div>
      </Html>
    </group>
  );
}

function DataFlowSystem({ apiGatewayPos, racks, statuses, trafficWeights }) {
  const meshRef = useRef();
  
  const packets = useMemo(() => {
    const arr = [];
    racks.forEach((rack, rackIdx) => {
      for (let i = 0; i < 150; i++) {
        arr.push({
          rackIdx,
          progress: Math.random(),
          speed: 0.2 + Math.random() * 0.3
        });
      }
    });
    return arr;
  }, [racks]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    const weights = [
      trafficWeights?.usEastCluster || 0,
      trafficWeights?.euWestCluster || 0,
      trafficWeights?.apSouthCluster || 0
    ];
    const sum = weights.reduce((a, b) => a + b, 0);
    const normalizedWeights = sum > 0 ? weights.map(w => w / sum) : [0, 0, 0];

    packets.forEach((p, i) => {
      p.progress += delta * p.speed;
      if (p.progress > 1) {
        p.progress = 0;
        
        if (sum > 0) {
          const rand = Math.random();
          let runningTotal = 0;
          for (let idx = 0; idx < normalizedWeights.length; idx++) {
            runningTotal += normalizedWeights[idx];
            if (rand <= runningTotal) {
              p.rackIdx = idx;
              break;
            }
          }
        }
      }
      
      const targetRack = racks[p.rackIdx];
      
      dummy.position.lerpVectors(
        new THREE.Vector3(...apiGatewayPos),
        new THREE.Vector3(...targetRack.position),
        p.progress
      );
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      
      const status = statuses[targetRack.id] || 'NOMINAL_GREEN';
      if (status === 'CRITICAL_RED') colorObj.set('#ff3333');
      else if (status === 'WARNING_AMBER') colorObj.set('#ffaa00');
      else if (status === 'HEALING') colorObj.set('#ffd700');
      else colorObj.set('#00ff00');
      
      meshRef.current.setColorAt(i, colorObj);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[packetGeo, packetMat, packets.length]}>
      <instancedBufferAttribute attach="instanceColor" args={[new Float32Array(packets.length * 3), 3]} />
    </instancedMesh>
  );
}

export default function App() {
  console.log('[DEBUG] Active Gateway URL:', import.meta.env.VITE_API_GATEWAY_URL);
  const [currentView, setCurrentView] = useState('topology');
  const [logs, setLogs] = useState([]);
  const [trafficWeights, setTrafficWeights] = useState({ usEastCluster: 0.33, euWestCluster: 0.33, apSouthCluster: 0.34 });
  const [statuses, setStatuses] = useState({
    usEastCluster: 'NOMINAL_GREEN',
    euWestCluster: 'NOMINAL_GREEN',
    apSouthCluster: 'NOMINAL_GREEN'
  });
  const [healingProgresses, setHealingProgresses] = useState({});
  const [liveMetrics, setLiveMetrics] = useState({});

  const apiGatewayPos = useMemo(() => [0, 6, 0], []);
  const racks = useMemo(() => [
    { id: 'usEastCluster', position: [-6, -2, 0], label: 'US-EAST' },
    { id: 'euWestCluster', position: [0, -2, 0], label: 'EU-WEST' },
    { id: 'apSouthCluster', position: [6, -2, 0], label: 'AP-SOUTH' }
  ], []);

  useEffect(() => {
    const socket = io(GATEWAY_URL, { transports: ['websocket'], upgrade: false });

    socket.on('aethernexus-telemetry-broadcast', (data) => {
      setLogs(prev => [...prev, data].slice(-100));
      
      if (data.trafficDistribution) {
        setTrafficWeights(data.trafficDistribution);
      }

      if (data.executedMitigationAction) {
        let targetId = null;
        if (data.executedMitigationAction.includes('usEastCluster')) targetId = 'usEastCluster';
        if (data.executedMitigationAction.includes('euWestCluster')) targetId = 'euWestCluster';
        if (data.executedMitigationAction.includes('apSouthCluster')) targetId = 'apSouthCluster';
        
        if (targetId && data.incidentThreatLevelColor) {
          setStatuses(prev => ({
            ...prev,
            [targetId]: data.incidentThreatLevelColor
          }));
          if (data.healingProgress !== undefined) {
            setHealingProgresses(prev => ({
              ...prev,
              [targetId]: data.healingProgress
            }));
          }
        }
      }
    });

    socket.on('live-metrics-stream', (data) => {
      setLiveMetrics(data);

      Object.entries(data).forEach(([regionId, metrics]) => {
        const m = metrics;
        const cpu = m?.computeLoadPercentage ?? 0;
        const dbStatus = m?.clusterOperationalStatus;
        if (dbStatus === 'HEALING') {
          setStatuses(prev => ({ ...prev, [regionId]: 'HEALING' }));
        } else if (cpu > 90) {
          setStatuses(prev => ({ ...prev, [regionId]: 'CRITICAL_RED' }));
        } else if (cpu > 75) {
          setStatuses(prev => ({ ...prev, [regionId]: 'WARNING_AMBER' }));
        }

        const logEntry = `[${new Date().toLocaleTimeString()}] ${regionId.toUpperCase()} | CPU: ${cpu.toFixed(1)}% | RAM: ${m?.volatileMemoryAllocationGb?.toFixed(1)}GB | Status: ${dbStatus}`;
        setLogs(prev => [logEntry, ...prev].slice(0, 50));
      });
    });

    // AI Orchestrator real-time insight stream
    socket.on('ai-log', (data) => {
      const formattedLog = `[AI - ${data.level ? data.level.toUpperCase() : 'INFO'}] ${data.text}`;
      setLogs(prev => [formattedLog, ...prev].slice(0, 50));
    });

    return () => {
      socket.off('aethernexus-telemetry-broadcast');
      socket.off('live-metrics-stream');
      socket.off('ai-log');
      socket.disconnect();
    };
  }, []);

  const handleManualMitigate = async (region) => {
    setStatuses(prev => ({ ...prev, [region]: 'HEALING' }));
    setHealingProgresses(prev => ({ ...prev, [region]: 0 }));
    let progress = 0;
    const interval = setInterval(() => {
      progress += 1;
      if (progress >= 100) {
        clearInterval(interval);
        setStatuses(prev => ({ ...prev, [region]: 'NOMINAL_GREEN' }));
        setHealingProgresses(prev => ({ ...prev, [region]: null }));
      } else {
        setHealingProgresses(prev => ({ ...prev, [region]: progress }));
      }
    }, 300);
    try {
      await fetch(`${GATEWAY_URL}/api/mitigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetClusterRegion: region, cacheLayerNamespace: 'manual-ui-override' })
      });
    } catch (e) {
      console.error('Manual mitigation failed', e);
    }
  };

  const colorMap = {
    NOMINAL_GREEN: '#00ff00',
    WARNING_AMBER: '#ffaa00',
    CRITICAL_RED: '#ff3333',
    HEALING: '#ffd700',
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0a0a0a', overflow: 'hidden', position: 'relative' }}>
      {currentView === 'diagnostics' ? (
        <Diagnostics onReturn={() => setCurrentView('topology')} logs={logs} statuses={statuses} trafficWeights={trafficWeights} />
      ) : (
        <>
          <Canvas camera={{ position: [0, 4, 15], fov: 50 }}>
            <ambientLight intensity={0.5} />
            <pointLight position={[0, 10, 0]} intensity={1.5} color="#ffffff" />
            
            <ApiGateway position={apiGatewayPos} />
            
            {racks.map(rack => (
              <ServerRack 
                key={rack.id} 
                position={rack.position} 
                label={rack.label} 
                status={statuses[rack.id]}
                healingProgress={healingProgresses[rack.id]}
                metrics={liveMetrics[rack.id]}
              />
            ))}

            <DataFlowSystem apiGatewayPos={apiGatewayPos} racks={racks} statuses={statuses} trafficWeights={trafficWeights} />

            <OrbitControls enablePan={true} maxPolarAngle={Math.PI / 2} />
          </Canvas>

          {/* Glassmorphism Sidebar */}
          <div style={{ 
            position: 'absolute', 
            top: 20, 
            right: 20, 
            width: 320, 
            height: 'calc(100% - 40px)', 
            background: 'rgba(20, 20, 25, 0.65)', 
            backdropFilter: 'blur(12px)', 
            border: '1px solid #00e5ff', 
            borderRadius: 8, 
            padding: 20, 
            color: '#fff', 
            fontFamily: 'monospace', 
            overflowY: 'hidden', 
            boxShadow: '0 0 20px rgba(0, 229, 255, 0.15)',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ position: 'absolute', top: 15, right: 15, fontSize: 11, color: '#00e5ff', opacity: 0.8 }}>
              Session: Admin
            </div>
            <h3 style={{ borderBottom: '1px solid rgba(0, 229, 255, 0.3)', paddingBottom: 15, marginTop: 0, letterSpacing: '2px' }}>TELEMETRY LOGS</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexGrow: 1, overflowY: 'auto' }}>
              {logs.map((log, i) => {
                const AI_LEVEL_COLORS = { info: '#00e5ff', warning: '#ffaa00', critical: '#ff3333', success: '#00ff41' };
                const isAiLog = log?.__aiLog === true;
                const isString = typeof log === 'string';
                
                let borderColor = '#00ff41';
                let textColor = '#00ff41';
                if (isString) {
                  if (log.includes('CRITICAL')) {
                    borderColor = '#ff4444';
                    textColor = '#ff4444';
                  } else if (log.includes('WARNING')) {
                    borderColor = '#ffcc00';
                    textColor = '#ffcc00';
                  }
                } else if (isAiLog) {
                  borderColor = AI_LEVEL_COLORS[log.level] || '#00e5ff';
                } else {
                  borderColor = colorMap[log.incidentThreatLevelColor] || '#00ff00';
                }

                return (
                  <div key={i} style={{ fontSize: 12, padding: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', borderLeft: `3px solid ${borderColor}` }}>
                    {isAiLog ? (
                      <>
                        <div style={{ color: AI_LEVEL_COLORS[log.level] || '#00e5ff', marginBottom: '3px', fontSize: '10px', fontFamily: 'monospace' }}>
                          { `[${new Date(log.timestamp).toLocaleTimeString()}] <${log.architect}> [${log.level?.toUpperCase()}]` }
                        </div>
                        <div style={{ color: '#e0e0e0', lineHeight: '1.4' }}>{log.text}</div>
                      </>
                    ) : isString ? (
                      <div style={{ color: textColor, lineHeight: '1.4', fontFamily: 'monospace' }}>{log}</div>
                    ) : (
                      <>
                        <div style={{ color: colorMap[log.incidentThreatLevelColor] || '#00ff00', marginBottom: '4px', fontSize: '10px' }}>
                          [{new Date(log.eventTimestamp).toLocaleTimeString()}] &lt;{log.principalArchitect}&gt;
                        </div>
                        <div style={{ color: '#e0e0e0', lineHeight: '1.4' }}>
                          {log.executedMitigationAction}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              {logs.length === 0 && (
                <div style={{ color: '#666', fontStyle: 'italic', marginTop: '20px', textAlign: 'center' }}>Awaiting telemetry streams...</div>
              )}
            </div>

            <button 
              onClick={() => setCurrentView('diagnostics')}
              style={{ 
                marginTop: '20px', 
                width: '100%', 
                padding: '12px', 
                background: 'transparent', 
                border: '1px solid #00e5ff', 
                color: '#00e5ff', 
                fontFamily: 'monospace', 
                cursor: 'pointer',
                borderRadius: '4px',
                boxShadow: '0 0 10px rgba(0, 229, 255, 0.2)',
                fontWeight: 'bold',
                letterSpacing: '1px',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => { e.target.style.background = 'rgba(0, 229, 255, 0.1)'; e.target.style.boxShadow = '0 0 15px rgba(0, 229, 255, 0.4)'; }}
              onMouseOut={(e) => { e.target.style.background = 'transparent'; e.target.style.boxShadow = '0 0 10px rgba(0, 229, 255, 0.2)'; }}
            >
              [ LAUNCH DIAGNOSTICS ]
            </button>
          </div>
        </>
      )}
      {currentView !== 'diagnostics' && (
        <DevOpsControls onMitigate={handleManualMitigate} />
      )}
    </div>
  );
}
