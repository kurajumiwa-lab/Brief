import { useAuthStore } from "@/stores/authStore";

// Close codes the server uses to say "don't bother retrying"
const FATAL_CODES = new Set([4401, 4403, 4404]);
const MAX_ATTEMPTS = 6;

/**
 * One socket per chat room, shared by every subscriber.
 *   ws.subscribe(roomId, onEvent)  → unsubscribe()
 *   onEvent receives { type: "hello" | "message" | "open" | "close" | "error", ... }
 */
class WebSocketManager {
  constructor() {
    this.sockets = new Map();
    this.listeners = new Map();
    this.attempts = new Map();
    this.timers = new Map();
    this.closing = new Set();
  }

  url(roomId) {
    const token = useAuthStore.getState().token || "";
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/api/chat/${roomId}/ws?token=${encodeURIComponent(token)}`;
  }

  connect(roomId) {
    const existing = this.sockets.get(roomId);
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return existing;
    if (typeof WebSocket === "undefined") return null;

    this.closing.delete(roomId);
    const socket = new WebSocket(this.url(roomId));
    this.sockets.set(roomId, socket);

    socket.onopen = () => {
      this.attempts.set(roomId, 0);
      this.emit(roomId, { type: "open" });
    };
    socket.onmessage = (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (frame && typeof frame === "object" && frame.type) this.emit(roomId, frame);
    };
    socket.onerror = () => this.emit(roomId, { type: "error" });
    socket.onclose = (event) => {
      if (this.sockets.get(roomId) === socket) this.sockets.delete(roomId);
      this.emit(roomId, { type: "close", code: event.code });
      const intentional = this.closing.has(roomId);
      const stillWanted = (this.listeners.get(roomId)?.size || 0) > 0;
      if (intentional || FATAL_CODES.has(event.code) || !stillWanted) return;
      const n = (this.attempts.get(roomId) || 0) + 1;
      if (n > MAX_ATTEMPTS) return;
      this.attempts.set(roomId, n);
      const delay = Math.min(1000 * 2 ** (n - 1), 15000);
      this.timers.set(roomId, setTimeout(() => this.connect(roomId), delay));
    };
    return socket;
  }

  disconnect(roomId) {
    this.closing.add(roomId);
    clearTimeout(this.timers.get(roomId));
    this.timers.delete(roomId);
    this.attempts.delete(roomId);
    const socket = this.sockets.get(roomId);
    this.sockets.delete(roomId);
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, "leaving room");
  }

  disconnectAll() {
    for (const roomId of [...this.sockets.keys(), ...this.timers.keys()]) this.disconnect(roomId);
    this.listeners.clear();
  }

  subscribe(roomId, listener) {
    if (!this.listeners.has(roomId)) this.listeners.set(roomId, new Set());
    this.listeners.get(roomId).add(listener);
    this.connect(roomId);
    return () => {
      const set = this.listeners.get(roomId);
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(roomId);
        this.disconnect(roomId);
      }
    };
  }

  emit(roomId, frame) {
    this.listeners.get(roomId)?.forEach((fn) => {
      try {
        fn(frame);
      } catch (e) {
        console.error("ws listener failed", e);
      }
    });
  }

  isOpen(roomId) {
    return this.sockets.get(roomId)?.readyState === WebSocket.OPEN;
  }
}

export const ws = new WebSocketManager();
export default ws;
