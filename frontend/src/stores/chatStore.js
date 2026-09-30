import { create } from "zustand";
import { chatAPI } from "@/lib/api";
import { ws } from "@/lib/ws";

let unsubscribe = null;

export const useChatStore = create((set, get) => ({
  rooms: [],
  activeRoom: null,
  messages: [],
  loading: false,
  sending: false,
  live: false,

  fetchRooms: async (params = {}) => {
    const { data } = await chatAPI.rooms(params);
    set({ rooms: data });
    return data;
  },

  /** Open a room: load history, then attach the live socket exactly once. */
  selectRoom: async (room) => {
    if (!room) return get().leaveRoom();
    if (get().activeRoom?.id === room.id) return;
    unsubscribe?.();
    unsubscribe = null;
    set({ activeRoom: room, messages: [], loading: true, live: false });
    try {
      const { data } = await chatAPI.messages(room.id, { limit: 200 });
      if (get().activeRoom?.id !== room.id) return; // user moved on while loading
      set({ messages: data });
    } finally {
      if (get().activeRoom?.id === room.id) set({ loading: false });
    }
    unsubscribe = ws.subscribe(room.id, (frame) => {
      if (get().activeRoom?.id !== room.id) return;
      if (frame.type === "open" || frame.type === "hello") set({ live: true });
      else if (frame.type === "close") set({ live: false });
      else if (frame.type === "message" && frame.message) get().pushMessage(frame.message);
      else if (frame.type === "message_update" && frame.message) get().updateMessage(frame.message);
    });
  },

  leaveRoom: () => {
    unsubscribe?.();
    unsubscribe = null;
    set({ activeRoom: null, messages: [], live: false });
  },

  pushMessage: (msg) =>
    set((s) => (s.messages.some((m) => m.id === msg.id) ? s : { messages: [...s.messages, msg] })),

  /** A deal changed state (accepted / countered / declined) — swap the message in place. */
  updateMessage: (msg) => set((s) => ({ messages: s.messages.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)) })),

  // --- deal protocol (v2.1) ---------------------------------------------------------
  acceptDeal: async (messageId) => {
    const room = get().activeRoom;
    const { data } = await chatAPI.acceptDeal(room.id, messageId);
    await get().refreshMessages();
    return data;
  },
  counterDeal: async (messageId, terms) => {
    const room = get().activeRoom;
    const { data } = await chatAPI.counterDeal(room.id, messageId, terms);
    if (data?.sent) get().pushMessage(data.sent);
    await get().refreshMessages();
    return data;
  },
  declineDeal: async (messageId) => {
    const room = get().activeRoom;
    const { data } = await chatAPI.declineDeal(room.id, messageId);
    await get().refreshMessages();
    return data;
  },
  /** Re-read the room after a deal action so statuses are right even without the socket. */
  refreshMessages: async () => {
    const room = get().activeRoom;
    if (!room) return;
    const { data } = await chatAPI.messages(room.id, { limit: 200 });
    if (get().activeRoom?.id === room.id) set({ messages: data });
  },

  send: async (payload) => {
    const room = get().activeRoom;
    if (!room) return null;
    set({ sending: true });
    try {
      const { data } = await chatAPI.send(room.id, payload);
      const sent = data?.sent || (data?.id ? data : null);
      if (sent) get().pushMessage(sent); // the socket echoes it too; pushMessage dedupes
      return sent;
    } finally {
      set({ sending: false });
    }
  },

  sendVoice: async (blob, durationSeconds) => {
    const room = get().activeRoom;
    if (!room) return null;
    set({ sending: true });
    try {
      const { data } = await chatAPI.sendVoice(room.id, blob, durationSeconds);
      const sent = data?.sent || null;
      if (sent) get().pushMessage(sent);
      return sent;
    } finally {
      set({ sending: false });
    }
  },

  joinRoom: async (roomId) => {
    const { data } = await chatAPI.join(roomId);
    set((s) => ({ rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, joined: true } : r)) }));
    return data;
  },

  createTopic: async (payload) => {
    const { data } = await chatAPI.createTopic(payload);
    await get().fetchRooms();
    return data;
  },

  /** Get-or-create helpers; both return the room id */
  openDirect: async (vendorId) => {
    const { data } = await chatAPI.directRoom(vendorId);
    return data.room_id || data.id;
  },
  openDeal: async (stockId) => {
    const { data } = await chatAPI.dealRoom(stockId);
    return data.room_id || data.id;
  },
}));
