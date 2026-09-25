import { useEffect, useRef, useState, useCallback } from "react";

interface UseResilientWebSocketOptions {
  onMessage?: (data: any) => void;
  onOpen?: () => void;
  onClose?: () => void;
  heartbeatInterval?: number;
  maxReconnectDelay?: number;
}

export function useResilientWebSocket(
  url: string | null,
  options: UseResilientWebSocketOptions = {},
) {
  const {
    onMessage,
    onOpen,
    onClose,
    heartbeatInterval = 5000,
    maxReconnectDelay = 10000,
  } = options;

  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const heartbeatTimer = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const callbacksRef = useRef({ onMessage, onOpen, onClose });

  // Keep latest callbacks without re-triggering effect
  callbacksRef.current = { onMessage, onOpen, onClose };

  const connect = useCallback(() => {
    if (!url) return;
    aliveRef.current = true;

    const ws = new WebSocket(url, ["ngrok-skip-browser-warning"]);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttempts.current = 0;
      setConnected(true);
      setReconnecting(false);

      // Heartbeat: send ping every N seconds, if no pong, reconnect
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
          } catch {
            // socket might be closing
          }
        }
      }, heartbeatInterval);

      callbacksRef.current.onOpen?.();
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "pong" || data.type === "ping") return;
        callbacksRef.current.onMessage?.(data);
      } catch {
        // ignore non-JSON
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current);
        heartbeatTimer.current = null;
      }
      callbacksRef.current.onClose?.();

      if (!aliveRef.current) return; // unmounting

      // Auto-reconnect with exponential backoff
      setReconnecting(true);
      const delay = Math.min(
        1000 * Math.pow(1.5, reconnectAttempts.current),
        maxReconnectDelay,
      );
      reconnectAttempts.current++;
      setTimeout(() => {
        if (aliveRef.current) connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose will handle reconnect
      try {
        ws.close();
      } catch {
        // already closed
      }
    };
  }, [url, heartbeatInterval, maxReconnectDelay]);

  useEffect(() => {
    if (!url) return;
    connect();

    return () => {
      aliveRef.current = false;
      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current);
        heartbeatTimer.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // already closed
        }
      }
    };
  }, [url, connect]);

  const flush = useCallback(() => {
    // Emergency: close and reconnect immediately
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // already closed
      }
    }
    reconnectAttempts.current = 0;
    setTimeout(() => connect(), 100);
  }, [connect]);

  return { connected, reconnecting, flush, ws: wsRef };
}
