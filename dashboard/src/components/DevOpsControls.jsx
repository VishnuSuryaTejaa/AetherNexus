import React from 'react';

const GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000';

const clusters = [
  { id: 'usEastCluster', label: 'US-East' },
  { id: 'euWestCluster', label: 'EU-West' },
  { id: 'apSouthCluster', label: 'AP-South' }
];

export default function DevOpsControls({ onMitigate }) {
  const handleInject = async (region, faultType) => {
    try {
      await fetch(`${GATEWAY_URL}/api/chaos/inject-fault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetClusterRegion: region, faultType })
      });
    } catch (e) {
      console.error('Chaos injection failed', e);
    }
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: '20px',
      padding: '20px',
      background: 'rgba(10, 10, 10, 0.75)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(0, 255, 65, 0.3)',
      borderRadius: '8px',
      boxShadow: '0 0 20px rgba(0, 255, 65, 0.1)',
      zIndex: 1000
    }}>
      {clusters.map(cluster => (
        <div key={cluster.id} style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          borderRight: cluster.id !== 'apSouthCluster' ? '1px solid rgba(255,255,255,0.1)' : 'none',
          paddingRight: cluster.id !== 'apSouthCluster' ? '20px' : '0'
        }}>
          <h3 style={{
            color: '#00ff41',
            margin: '0 0 10px 0',
            fontFamily: 'monospace',
            fontSize: '13px',
            textShadow: '0 0 5px #00ff41',
            textAlign: 'center'
          }}>
            {cluster.label}
          </h3>
          <button onClick={() => handleInject(cluster.id, 'CPU_SPIKE')} style={btnStyle('#ff003c')}>
            Inject CPU Spike
          </button>
          <button onClick={() => handleInject(cluster.id, 'MEMORY_OVERFLOW')} style={btnStyle('#ffb000')}>
            Inject Mem Leak
          </button>
          <button onClick={() => onMitigate && onMitigate(cluster.id)} style={btnStyle('#00ff41')}>
            Force Mitigation
          </button>
        </div>
      ))}
    </div>
  );
}

const btnStyle = (glowColor) => ({
  background: 'transparent',
  color: '#fff',
  border: `1px solid ${glowColor}`,
  padding: '8px 12px',
  borderRadius: '4px',
  fontFamily: 'monospace',
  fontSize: '12px',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  boxShadow: `0 0 5px ${glowColor}40`,
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
});
