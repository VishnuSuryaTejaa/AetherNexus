import { useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { useSocket } from './hooks/useSocket';
import NetworkGrid from './components/NetworkGrid';
import TerminalView from './components/TerminalView';
import { ThreatLevel } from './types/telemetry';

const REGIONS = ['US-East-1', 'EU-West-1', 'AP-South-1'];

const STATUS_LABEL: Record<ThreatLevel, string> = {
  NOMINAL_GREEN: 'STABLE',
  WARNING_AMBER: 'WARNING',
  CRITICAL_RED:  'CRITICAL',
};

const STATUS_COLOR: Record<ThreatLevel, string> = {
  NOMINAL_GREEN: 'text-green-400',
  WARNING_AMBER: 'text-amber-400',
  CRITICAL_RED:  'text-red-500',
};

const BORDER_COLOR: Record<ThreatLevel, string> = {
  NOMINAL_GREEN: 'border-green-500',
  WARNING_AMBER: 'border-amber-500',
  CRITICAL_RED:  'border-red-600',
};

export default function App() {
  const { isConnected, latestPacket, logs, socket } = useSocket('http://localhost:4000');

  const [globalThreat, setGlobalThreat] = useState<ThreatLevel>('NOMINAL_GREEN');
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, ThreatLevel>>({
    'US-East-1':  'NOMINAL_GREEN',
    'EU-West-1':  'NOMINAL_GREEN',
    'AP-South-1': 'NOMINAL_GREEN',
  });
  const [showOverride, setShowOverride] = useState(false);
  const [overrideAction, setOverrideAction] = useState('');

  // Update global status when new packet arrives
  useEffect(() => {
    if (!latestPacket) return;
    setGlobalThreat(latestPacket.incidentThreatLevelColor);

    // Determine which region the action mentions and update it
    const action = latestPacket.executedMitigationAction.toLowerCase();
    setNodeStatuses(prev => {
      const next = { ...prev };
      REGIONS.forEach(r => {
        const key = r.toLowerCase().replace('-', '').replace('-', '');
        if (action.includes(key) || action.includes(r.toLowerCase())) {
          next[r] = latestPacket.incidentThreatLevelColor;
        }
      });
      return next;
    });

    // Show override modal when AI requests intervention
    if (latestPacket.executedMitigationAction.toLowerCase().includes('override_requested')) {
      setOverrideAction(latestPacket.executedMitigationAction);
      setShowOverride(true);
    }
  }, [latestPacket]);

  // Chaos injection buttons
  const triggerChaos = useCallback((region: string) => {
    if (!socket) return;
    socket.emit('chaos-inject', { region, type: 'CPU_SPIKE' });
  }, [socket]);

  const killNetwork = useCallback((region: string) => {
    if (!socket) return;
    socket.emit('chaos-inject', { region, type: 'NETWORK_KILL' });
  }, [socket]);

  const handleOverride = useCallback((approved: boolean) => {
    if (!socket) return;
    socket.emit('override-response', { approved });
    setShowOverride(false);
  }, [socket]);

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">

      {/* ─── 3D CANVAS (full screen) ─── */}
      <Canvas
        className="absolute inset-0"
        camera={{ position: [0, 4, 14], fov: 55 }}
        shadows
      >
        <NetworkGrid globalThreat={globalThreat} nodeStatuses={nodeStatuses} />
      </Canvas>

      {/* ─── TOP HEADER BAR ─── */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-3 bg-black/60 backdrop-blur-sm border-b border-green-900/40 z-10">
        <div className="flex items-center gap-3">
          <span className="text-green-400 font-mono font-bold text-lg tracking-widest">
            ⬡ AETHERNEXUS
          </span>
          <span className="text-green-900 font-mono text-xs">
            INFRASTRUCTURE TELEMETRY GRID v2.0
          </span>
        </div>

        <div className={`flex items-center gap-2 px-4 py-1.5 rounded border ${BORDER_COLOR[globalThreat]} bg-black/50 status-${globalThreat}`}>
          <span className={`text-2xl font-bold font-mono ${STATUS_COLOR[globalThreat]}`}>
            {STATUS_LABEL[globalThreat]}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-600'}`} />
          <span className="font-mono text-xs text-green-700">
            {isConnected ? 'UPLINK ESTABLISHED' : 'CONNECTING...'}
          </span>
        </div>
      </div>

      {/* ─── BOTTOM PANEL: CHAOS CONTROLS + TERMINAL ─── */}
      <div className="absolute bottom-0 left-0 right-0 flex h-56 border-t border-green-900/40 bg-black/70 backdrop-blur-md z-10">

        {/* CHAOS ADMIN PANEL */}
        <div className="w-72 border-r border-green-900/40 p-4 flex flex-col gap-2">
          <div className="text-green-500 font-mono text-xs tracking-widest uppercase mb-1 border-b border-green-900/40 pb-1">
            ⚡ Chaos Admin Panel
          </div>
          {REGIONS.map(region => (
            <div key={region} className="flex items-center gap-2">
              <span className="text-green-800 font-mono text-[10px] w-20 shrink-0">{region}</span>
              <button
                onClick={() => triggerChaos(region)}
                className="flex-1 px-2 py-1 bg-red-950/60 hover:bg-red-900/80 border border-red-900 text-red-400 font-mono text-[10px] rounded transition-all duration-150 uppercase tracking-wider cursor-pointer"
              >
                CPU Spike
              </button>
              <button
                onClick={() => killNetwork(region)}
                className="flex-1 px-2 py-1 bg-amber-950/60 hover:bg-amber-900/80 border border-amber-900 text-amber-400 font-mono text-[10px] rounded transition-all duration-150 uppercase tracking-wider cursor-pointer"
              >
                Kill Link
              </button>
            </div>
          ))}

          {/* Node status overview */}
          <div className="mt-auto pt-2 border-t border-green-900/30">
            <div className="text-green-900 font-mono text-[10px] uppercase tracking-wider mb-1">Node Status</div>
            {REGIONS.map(r => (
              <div key={r} className="flex justify-between items-center">
                <span className="text-green-800 font-mono text-[10px]">{r}</span>
                <span className={`font-mono text-[10px] font-bold ${STATUS_COLOR[nodeStatuses[r] ?? 'NOMINAL_GREEN']}`}>
                  {STATUS_LABEL[nodeStatuses[r] ?? 'NOMINAL_GREEN']}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* AI TERMINAL STREAM */}
        <div className="flex-1 overflow-hidden">
          <TerminalView logs={logs} />
        </div>
      </div>

      {/* ─── OVERRIDE INTERCEPTOR MODAL ─── */}
      {showOverride && (
        <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center">
          <div className="modal-panel w-[500px] border-2 border-red-700 rounded-lg bg-black/90 p-8 text-center shadow-[0_0_60px_rgba(255,0,51,0.5)]">
            <div className="text-red-500 font-mono text-2xl font-bold mb-2 animate-pulse">
              ⚠ OVERRIDE REQUESTED
            </div>
            <div className="text-red-700 font-mono text-xs mb-6 tracking-widest uppercase">
              Surya-AI-Core — Awaiting Human Authorization
            </div>
            <div className="bg-red-950/40 border border-red-900 rounded p-4 mb-6 font-mono text-sm text-red-300 text-left leading-relaxed">
              {overrideAction}
            </div>
            <div className="text-green-600 font-mono text-xs mb-6">
              "AI Agent requests hard hardware reboot of cluster.<br />
              Authorize execution?"
            </div>
            <div className="flex gap-4 justify-center">
              <button
                onClick={() => handleOverride(true)}
                className="px-8 py-3 bg-green-900/60 hover:bg-green-800 border-2 border-green-600 text-green-300 font-mono font-bold text-sm rounded transition-all cursor-pointer uppercase tracking-wider"
              >
                ✓ APPROVE
              </button>
              <button
                onClick={() => handleOverride(false)}
                className="px-8 py-3 bg-red-900/60 hover:bg-red-800 border-2 border-red-600 text-red-300 font-mono font-bold text-sm rounded transition-all cursor-pointer uppercase tracking-wider"
              >
                ✗ DENY
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
