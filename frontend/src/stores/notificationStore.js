import { create } from "zustand";
import { notificationAPI } from "@/lib/api";

let timer = null;

/** In-app notifications (v2.1). Polled every 30s while the shell is mounted. */
export const useNotificationStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  loaded: false,

  fetch: async (params = { limit: 30 }) => {
    set({ loading: true });
    try {
      const { data } = await notificationAPI.list(params);
      set({ notifications: data.notifications || [], unreadCount: data.unread_count || 0, loaded: true });
      return data;
    } finally {
      set({ loading: false });
    }
  },

  /** Cheap poll for the badge; the list itself refreshes when the panel opens. */
  refreshCount: async () => {
    const { data } = await notificationAPI.unreadCount();
    if (data.unread_count !== get().unreadCount) set({ unreadCount: data.unread_count });
    return data.unread_count;
  },

  markRead: async (id) => {
    const target = get().notifications.find((n) => n.id === id);
    if (!target || target.is_read) return;
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }));
    try {
      await notificationAPI.markRead(id);
    } catch {
      /* optimistic; the next poll corrects it */
    }
  },

  markAllRead: async () => {
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, is_read: true })), unreadCount: 0 }));
    await notificationAPI.markAllRead();
  },

  startPolling: (intervalMs = 30_000) => {
    get().stopPolling();
    const tick = () => get().refreshCount().catch(() => {});
    tick();
    timer = setInterval(tick, intervalMs);
  },

  stopPolling: () => {
    if (timer) clearInterval(timer);
    timer = null;
  },

  reset: () => {
    get().stopPolling();
    set({ notifications: [], unreadCount: 0, loaded: false });
  },
}));
