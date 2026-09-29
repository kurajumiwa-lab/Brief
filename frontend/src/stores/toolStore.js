import { create } from "zustand";
import { toolAPI } from "@/lib/api";

export const useToolStore = create((set, get) => ({
  tools: [],
  mine: [],
  couriers: [],
  loading: false,

  fetchTools: async (params = {}) => {
    set({ loading: true });
    try {
      const { data } = await toolAPI.browse(params);
      set({ tools: data });
      return data;
    } finally {
      set({ loading: false });
    }
  },
  fetchMine: async () => {
    const { data } = await toolAPI.mine();
    set({ mine: data });
    return data;
  },
  fetchCouriers: async (params = {}) => {
    const { data } = await toolAPI.couriers(params);
    set({ couriers: data });
    return data;
  },
  // POST /tools/list answers { message, tool_id }
  create: async (payload) => {
    const { data: ack } = await toolAPI.create(payload);
    const mine = await get().fetchMine();
    const tool = mine.find((t) => t.id === ack.tool_id) || { ...payload, id: ack.tool_id };
    set((s) => ({ tools: [tool, ...s.tools.filter((t) => t.id !== tool.id)] }));
    return tool;
  },
  registerCourier: async (payload) => {
    const { data } = await toolAPI.registerCourier(payload);
    return data;
  },
  setAvailability: async (id, isAvailable) => {
    await toolAPI.setAvailability(id, isAvailable);
    set((s) => ({
      tools: s.tools.map((t) => (t.id === id ? { ...t, is_available: isAvailable } : t)),
      mine: s.mine.map((t) => (t.id === id ? { ...t, is_available: isAvailable } : t)),
    }));
  },
  book: (id, payload) => toolAPI.bookWarehouse(id, payload).then((r) => r.data),
}));
