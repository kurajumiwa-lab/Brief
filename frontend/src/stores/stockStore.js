import { create } from "zustand";
import { stockAPI } from "@/lib/api";

const PENDING_ON_ME = (m) =>
  (m.direction === "outgoing" && (m.status === "pending" || m.status === "confirmed")) ||
  (m.direction === "incoming" && m.status === "shipped");

export const useStockStore = create((set, get) => ({
  mine: [],
  network: [],
  movements: [],
  categories: [],
  loading: false,
  networkLoading: false,

  fetchMine: async () => {
    set({ loading: true });
    try {
      const { data } = await stockAPI.mine();
      set({ mine: data });
      return data;
    } finally {
      set({ loading: false });
    }
  },
  fetchNetwork: async (params = {}) => {
    set({ networkLoading: true });
    try {
      const { data } = await stockAPI.network({ limit: 60, ...params });
      set({ network: data });
      return data;
    } finally {
      set({ networkLoading: false });
    }
  },
  fetchMovements: async (params = {}) => {
    const { data } = await stockAPI.movements(params);
    set({ movements: data });
    return data;
  },
  fetchCategories: async () => {
    const { data } = await stockAPI.categories();
    set({ categories: data });
    return data;
  },

  // POST /stock/add answers { message, stock_id } — fetch the full line so the card is complete
  add: async (payload) => {
    const { data: ack } = await stockAPI.add(payload);
    const { data: item } = await stockAPI.get(ack.stock_id);
    set((s) => ({ mine: [item, ...s.mine.filter((i) => i.id !== item.id)] }));
    return item;
  },
  /** Swap an item returned by a v2.1 endpoint (verify, patron-verify) into both lists. */
  replaceItem: (item) =>
    set((s) => ({
      mine: s.mine.map((i) => (i.id === item.id ? { ...i, ...item } : i)),
      network: s.network.map((i) => (i.id === item.id ? { ...i, ...item } : i)),
    })),

  update: async (id, payload) => {
    const { data } = await stockAPI.update(id, payload);
    set((s) => ({ mine: s.mine.map((i) => (i.id === id ? data : i)) }));
    return data;
  },
  remove: async (id) => {
    await stockAPI.remove(id);
    set((s) => ({ mine: s.mine.filter((i) => i.id !== id) }));
  },
  source: async (id, payload) => {
    const { data } = await stockAPI.source(id, payload);
    await get().fetchNetwork().catch(() => {});
    return data;
  },
  advance: async (movementId, action) => {
    const { data } = await stockAPI.advance(movementId, action);
    set((s) => ({ movements: s.movements.map((m) => (m.id === movementId ? { ...m, ...data } : m)) }));
    if (action === "receive" || action === "cancel") get().fetchMine().catch(() => {});
    return data;
  },
  bulkImport: async (file) => {
    const { data } = await stockAPI.bulkImport(file);
    await get().fetchMine();
    return data;
  },

  /** Movements waiting on *my* action — feeds the TopBar bell */
  actionable: () => get().movements.filter(PENDING_ON_ME),
}));

export const needsMyAction = PENDING_ON_ME;
