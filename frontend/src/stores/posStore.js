import { create } from "zustand";
import { posAPI } from "@/lib/api";

export const usePosStore = create((set, get) => ({
  connections: [],
  logs: {},
  loading: false,
  busy: null, // connection id currently syncing / pushing

  fetchConnections: async () => {
    set({ loading: true });
    try {
      const { data } = await posAPI.connections();
      set({ connections: data });
      return data;
    } finally {
      set({ loading: false });
    }
  },
  connect: async (payload) => {
    const { data } = await posAPI.connect(payload);
    await get().fetchConnections();
    return data;
  },
  disconnect: async (id) => {
    await posAPI.disconnect(id);
    set((s) => ({ connections: s.connections.filter((c) => c.id !== id) }));
  },
  sync: async (id) => {
    set({ busy: id });
    try {
      const { data } = await posAPI.sync(id);
      await get().fetchConnections();
      return data;
    } finally {
      set({ busy: null });
    }
  },
  pushCsv: async (id, file) => {
    set({ busy: id });
    try {
      const { data } = await posAPI.pushCsv(id, file);
      await get().fetchConnections();
      return data;
    } finally {
      set({ busy: null });
    }
  },
  fetchLogs: async (id) => {
    const { data } = await posAPI.syncLogs(id);
    set((s) => ({ logs: { ...s.logs, [id]: data } }));
    return data;
  },
}));
