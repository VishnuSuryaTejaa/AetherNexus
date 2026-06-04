import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { TelemetryPacket } from '../types/telemetry';

interface UseSocketReturn {
  isConnected: boolean;
  latestPacket: TelemetryPacket | null;
  logs: TelemetryPacket[];
  socket: Socket | null;
}

export const useSocket = (url: string): UseSocketReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [latestPacket, setLatestPacket] = useState<TelemetryPacket | null>(null);
  const [logs, setLogs] = useState<TelemetryPacket[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(url, {
      reconnectionDelayMax: 10000,
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('aethernexus-telemetry-broadcast', (data: TelemetryPacket) => {
      setLatestPacket(data);
      setLogs(prev => [data, ...prev].slice(0, 60));
    });

    return () => { socket.disconnect(); };
  }, [url]);

  return { isConnected, latestPacket, logs, socket: socketRef.current };
};
