import { create } from "zustand";
import { groupAPI } from "@/lib/api";

export const useGroupStore = create((set, get) => ({
  groups: [],
  mine: [],
  loading: false,

  fetchGroups: async (params = {}) => {
    set({ loading: true });
    try {
      const { data } = await groupAPI.browse(params);
      set({ groups: data });
      return data;
    } finally {
      set({ loading: false });
    }
  },
  fetchMine: async () => {
    const { data } = await groupAPI.mine();
    set({ mine: data });
    return data;
  },
  // POST /groups/create answers { message, group_id, chat_room_id }
  create: async (payload) => {
    const { data: ack } = await groupAPI.create(payload);
    const [{ data: group }] = await Promise.all([groupAPI.get(ack.group_id), get().fetchMine().catch(() => {})]);
    set((s) => ({ groups: [group, ...s.groups.filter((g) => g.id !== group.id)] }));
    return group;
  },
  patch: (id, patch) =>
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
      mine: s.mine.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    })),
  join: async (group) => {
    const { data } = await groupAPI.join(group.id);
    const pending = data?.status ? data.status === "pending" : /pending|approval/i.test(data?.message || "");
    get().patch(group.id, {
      my_role: pending ? "pending" : "member",
      member_count: pending ? group.member_count : (group.member_count || 0) + 1,
    });
    return data;
  },
  leave: async (group) => {
    const { data } = await groupAPI.leave(group.id);
    get().patch(group.id, { my_role: null, member_count: Math.max(0, (group.member_count || 1) - 1) });
    set((s) => ({ mine: s.mine.filter((g) => g.id !== group.id) }));
    return data;
  },
  approve: (groupId, vendorId) => groupAPI.approve(groupId, vendorId),
  members: (groupId) => groupAPI.members(groupId).then((r) => r.data),
  createList: (groupId, payload) => groupAPI.createList(groupId, payload).then((r) => r.data),
}));
