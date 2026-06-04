import { useRef, useEffect } from 'react';
import { TelemetryPacket, ThreatLevel } from '../types/telemetry';

interface TerminalViewProps {
  logs: TelemetryPacket[];
}

const COLOR_CLASS: Record<ThreatLevel, string> = {
  NOMINAL_GREEN: 'text-green-400',
  WARNING_AMBER: 'text-amber-400',
  CRITICAL_RED:  'text-red-500',
};

const BADGE_CLASS: Record<ThreatLevel, string> = {
  NOMINAL_GREEN: 'bg-green-900/60 text-green-300 border border-green-700',
  WARNING_AMBER: 'bg-amber-900/60 text-amber-300 border border-amber-700',
  CRITICAL_RED:  'bg-red-900/60  text-red-300  border border-red-700',
};

export default function TerminalView({ logs }: TerminalViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-green-900/50">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-green-400 text-xs font-mono tracking-widest uppercase">
            AI Thought Stream
          </span>
        </div>
        <span className="text-green-900 text-xs font-mono">[LIVE]</span>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 font-mono text-xs">
        {logs.length === 0 ? (
          <div className="text-green-900 italic mt-4 text-center">
            Waiting for telemetry stream...
            <span className="terminal-cursor ml-1">█</span>
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="log-entry border-l-2 border-green-900/40 pl-2">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-green-900">
                  {new Date(log.eventTimestamp).toLocaleTimeString()}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${BADGE_CLASS[log.incidentThreatLevelColor]}`}>
                  {log.incidentThreatLevelColor.replace('_', ' ')}
                </span>
              </div>
              <div className="text-blue-300 text-[10px] mb-0.5">
                &lt;{log.principalArchitect}&gt;
              </div>
              <div className={`${COLOR_CLASS[log.incidentThreatLevelColor]} leading-relaxed`}>
                {log.executedMitigationAction}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
