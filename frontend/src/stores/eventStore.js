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
    const { data: updated } = await eventAPI.get(event.id);
    get().patch(event.id, updated);
    return data;
  },
  cancelRegistration: async (event) => {
    const { data } = await eventAPI.cancelRegistration(event.id);
    const { data: updated } = await eventAPI.get(event.id);
    get().patch(event.id, updated);
    return data;
  },
  setStatus: async (event, status) => {
    const { data } = await eventAPI.setStatus(event.id, status);
    get().patch(event.id, { status });
    return data;
  },
  registrations: (id) => eventAPI.registrations(id).then((r) => r.data),
  // v2.1 check-in + analytics
  checkIn: async (event) => {
    const { data } = await eventAPI.checkIn(event.id);
    get().patch(event.id, { my_status: "attended" });
    return data;
  },
  checkInVendor: (eventId, vendorId) => eventAPI.checkInVendor(eventId, vendorId).then((r) => r.data),
  analytics: (id) => eventAPI.analytics(id).then((r) => r.data),
}));
