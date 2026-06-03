import { useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, CameraShake, Environment, Stars } from '@react-three/drei';
import { io } from 'socket.io-client';
import ServerRack from './components/ServerRack';

function App() {
  const [status, setStatus] = useState('NOMINAL_GREEN');
  const [logs, setLogs] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const logsEndRef = useRef(null);

  useEffect(() => {
    // Scroll to bottom of logs when new ones arrive
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    // Connect to the AI backend egress port
    const socket = io('http://localhost:4000', {
      reconnectionDelayMax: 10000,
    });

    socket.on('connect', () => {
      console.log('Connected to AetherNexus Telemetry Stream');
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from Telemetry Stream');
      setIsConnected(false);
    });

    socket.on('aethernexus-telemetry-broadcast', (data) => {
      console.log('Received broadcast:', data);
      
      // Update global status for 3D model
      if (data.incidentThreatLevelColor) {
        setStatus(data.incidentThreatLevelColor);
      }

      // Add to terminal logs
      setLogs(prev => [...prev, data].slice(-50)); // Keep last 50 logs
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const getStatusText = (colorCode) => {
    switch(colorCode) {
      case 'CRITICAL_RED': return 'CRITICAL';
      case 'WARNING_AMBER': return 'WARNING';
      case 'NOMINAL_GREEN': return 'STABLE';
      default: return 'UNKNOWN';
    }
  };

  return (
    <div className="dashboard-container">
      
      {/* 3D Scene */}
      <Canvas camera={{ position: [0, 2, 8], fov: 50 }}>
        <color attach="background" args={['#050505']} />
        
        <ambientLight intensity={0.2} />
        <pointLight position={[10, 10, 10]} intensity={0.5} />
        
        <ServerRack status={status} />
        
        {/* Dynamic environment elements */}
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={status === 'CRITICAL_RED' ? 3 : 1} />
        <OrbitControls enablePan={false} maxPolarAngle={Math.PI / 2 + 0.1} />
        
        {status === 'CRITICAL_RED' && (
          <CameraShake maxYaw={0.05} maxPitch={0.05} maxRoll={0.05} yawFrequency={0.5} pitchFrequency={0.5} rollFrequency={0.5} />
        )}
      </Canvas>

      {/* UI Overlays */}
      <div className={`status-indicator status-${status}`}>
        <h1>SYSTEM STATUS</h1>
        <p>{getStatusText(status)}</p>
      </div>

      <div className="terminal-overlay">
        <div className="terminal-header">
          <span>AetherNexus Active Log</span>
          <span>[LIVE FEED]</span>
        </div>
        <div className="terminal-content">
          {logs.length === 0 ? (
            <div style={{ color: '#666', fontStyle: 'italic' }}>Waiting for telemetry data...</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className={`log-entry log-color-${log.incidentThreatLevelColor}`}>
                <span className="log-timestamp">
                  [{new Date(log.eventTimestamp).toLocaleTimeString()}]
                </span>
                <span className="log-architect">
                  &lt;{log.principalArchitect}&gt;
                </span>
                <span className="log-action">
                  {log.executedMitigationAction}
                </span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      <div className="connection-status">
        <div className={`dot ${isConnected ? 'connected' : ''}`}></div>
        {isConnected ? 'Uplink Established' : 'Attempting Connection...'}
      </div>

    </div>
  );
}

export default App;
