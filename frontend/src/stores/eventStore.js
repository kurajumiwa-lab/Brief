import { create } from "zustand";
import { eventAPI } from "@/lib/api";

export const useEventStore = create((set, get) => ({
  events: [],
  mine: [],
  loading: false,

  fetchEvents: async (params = {}) => {
    set({ loading: true });
    try {
      const { data } = await eventAPI.browse(params);
      set({ events: data });
      return data;
    } finally {
      set({ loading: false });
    }
  },
  fetchMine: async () => {
    const { data } = await eventAPI.mine();
    set({ mine: data });
    return data;
  },
  patch: (id, patch) =>
    set((s) => ({
      events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      mine: s.mine.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),
  // POST /events/create answers { message, event_id }
  create: async (payload) => {
    const { data: ack } = await eventAPI.create(payload);
    const [{ data: event }] = await Promise.all([eventAPI.get(ack.event_id), get().fetchMine().catch(() => {})]);
    set((s) => ({ events: [event, ...s.events.filter((e) => e.id !== event.id)] }));
    return event;
  },
  register: async (event) => {
    const { data } = await eventAPI.register(event.id);
    get().patch(event.id, {
      my_status: "registered",
      registered_count: (event.registered_count || 0) + 1,
      spots_left: event.spots_left == null ? null : Math.max(0, event.spots_left - 1),
    });
    return data;
  },
  cancelRegistration: async (event) => {
    const { data } = await eventAPI.cancelRegistration(event.id);
    get().patch(event.id, {
      my_status: null,
      registered_count: Math.max(0, (event.registered_count || 1) - 1),
      spots_left: event.spots_left == null ? null : event.spots_left + 1,
    });
    return data;
  },
  setStatus: async (event, status) => {
    const { data } = await eventAPI.setStatus(event.id, status);
    get().patch(event.id, { status });
    return data;
  },
  registrations: (id) => eventAPI.registrations(id).then((r) => r.data),
}));
