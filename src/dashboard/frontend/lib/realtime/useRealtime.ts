'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '../api/client';

export type DashboardChannel = 'logs' | 'modules' | 'jobs' | 'analytics';

/**
 * Opens the dashboard WebSocket using a single-use ticket fetched from the BFF,
 * subscribes to a guild channel, and invokes `onEvent` for each server message.
 * Cleans up the socket on unmount or dependency change.
 */
export function useRealtime(
  guildId: string,
  channel: DashboardChannel,
  onEvent: (event: string, payload: unknown) => void,
): void {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connect(): Promise<void> {
      const { ticket } = await api.realtimeTicket();
      if (cancelled) return;
      const socket = io('/realtime', {
        query: { ticket },
        transports: ['websocket'],
      });
      socketRef.current = socket;
      socket.on('connect', () =>
        socket.emit('subscribe', { guildId, channel }),
      );
      socket.onAny((event: string, payload: unknown) =>
        onEvent(event, payload),
      );
    }

    void connect();
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [guildId, channel, onEvent]);
}
