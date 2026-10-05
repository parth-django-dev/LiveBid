import { useState, useEffect, useRef, useCallback } from 'react';

export function useAuctionSocket(itemId, { onBidUpdate, onError, onAuctionEnded } = {}) {
  const [status, setStatus] = useState('disconnected'); // 'connecting' | 'connected' | 'disconnected' | 'error'
  const [lastError, setLastError] = useState(null);
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const isUnmountedRef = useRef(false);

  // Keep callback refs updated without re-triggering connect
  const onBidUpdateRef = useRef(onBidUpdate);
  const onErrorRef = useRef(onError);
  const onAuctionEndedRef = useRef(onAuctionEnded);

  useEffect(() => {
    onBidUpdateRef.current = onBidUpdate;
    onErrorRef.current = onError;
    onAuctionEndedRef.current = onAuctionEnded;
  }, [onBidUpdate, onError, onAuctionEnded]);

  const connect = useCallback(() => {
    if (!itemId) return;

    // Clear any pending reconnection
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }

    setStatus('connecting');
    setLastError(null);

    // Build WebSocket URL matching current origin, VITE_WS_URL, or derived from VITE_API_URL
    let wsUrl;
    let wsBase = import.meta.env.VITE_WS_URL || (import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/^http/, 'ws') : null);
    if (wsBase && wsBase.includes('your-backend')) {
      wsBase = 'wss://livebid-ti6v.onrender.com';
    }
    if (!wsBase && import.meta.env.PROD) {
      wsBase = 'wss://livebid-ti6v.onrender.com';
    }

    if (wsBase) {
      const base = wsBase.replace(/\/$/, '');
      wsUrl = `${base}/ws/auction/${itemId}/`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws/auction/${itemId}/`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        if (isUnmountedRef.current) {
          ws.close();
          return;
        }
        setStatus('connected');
        setLastError(null);

        // Keep-alive heartbeat every 25 seconds to prevent PgBouncer / proxy timeout
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'ping' }));
            } catch (e) {
              // ignore
            }
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        if (isUnmountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pong') {
            return; // keep-alive response
          } else if (data.type === 'bid_update') {
            onBidUpdateRef.current?.(data);
          } else if (data.type === 'auction_ended') {
            onAuctionEndedRef.current?.(data);
          } else if (data.type === 'error') {
            setLastError(data.message);
            onErrorRef.current?.(data.message);
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = (err) => {
        if (isUnmountedRef.current) return;
        console.warn('WebSocket encountered error:', err);
        setStatus('error');
      };

      ws.onclose = (event) => {
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        if (isUnmountedRef.current) return;
        setStatus('disconnected');

        // Automatically reconnect after 1.5 seconds if component is still active
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isUnmountedRef.current) {
            connect();
          }
        }, 1500);
      };
    } catch (err) {
      setStatus('error');
      setLastError(err.message);
    }
  }, [itemId]);

  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      const ws = socketRef.current;
      if (ws) {
        ws.onerror = null;
        ws.onclose = null;
        ws.onmessage = null;

        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => {
            try {
              ws.close();
            } catch (e) {
              // ignore
            }
          };
        } else if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.close();
          } catch (e) {
            // ignore
          }
        }
        socketRef.current = null;
      }
    };
  }, [connect]);

  const sendBid = useCallback((amount) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      // Instantly trigger reconnect attempt
      connect();
      const msg = 'Connecting to auction server... Please retry in a moment.';
      setLastError(msg);
      onErrorRef.current?.(msg);
      return false;
    }

    try {
      socketRef.current.send(JSON.stringify({
        type: 'bid',
        amount: Number(amount),
      }));
      setLastError(null);
      return true;
    } catch (err) {
      setLastError(err.message);
      onErrorRef.current?.(err.message);
      return false;
    }
  }, [connect]);

  return {
    status,
    isConnected: status === 'connected',
    lastError,
    clearError: () => setLastError(null),
    sendBid,
    reconnect: connect,
  };
}
