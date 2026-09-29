import { create } from "zustand";
import { listAPI } from "@/lib/api";

export const useListStore = create((set, get) => ({
  lists: [],
  mine: [],
  loading: false,

  fetchLists: async (params = {}) => {
    set({ loading: true });
    try {
      const { data } = await listAPI.browse(params);
      set({ lists: data });
      return data;
    } finally {
      set({ loading: false });
    }
  },
  fetchMine: async () => {
    const { data } = await listAPI.mine();
    set({ mine: data });
    return data;
  },
  patch: (id, patch) =>
    set((s) => ({
      lists: s.lists.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      mine: s.mine.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),
  // POST /vendor-lists/create answers { message, list_id, max_vendors, chat_room_id }
  create: async (payload) => {
    const { data: ack } = await listAPI.create(payload);
    const mine = await get().fetchMine();
    const list = mine.find((l) => l.id === ack.list_id) || { ...payload, id: ack.list_id };
    set((s) => ({ lists: [list, ...s.lists.filter((l) => l.id !== list.id)] }));
    return list;
  },
  register: async (list) => {
    const { data } = await listAPI.register(list.id);
    const status = data?.status || (list.requires_approval ? "pending" : "approved");
    get().patch(list.id, {
      my_status: status,
      member_count: status === "approved" ? (list.member_count || 0) + 1 : list.member_count,
    });
    return data;
  },
  members: (id) => listAPI.members(id).then((r) => r.data),
  approve: (id, vendorId) => listAPI.approve(id, vendorId),
  reject: (id, vendorId) => listAPI.reject(id, vendorId),
  setOpen: async (list, isOpen) => {
    await listAPI.setOpen(list.id, isOpen);
    get().patch(list.id, { is_open: isOpen });
  },
}));
