import { useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useOutsideStore } from "@/stores/outsideStore";

/**
 * ONE reading of "who needs my attention?", shared by the header and Home.
 *
 * Chats and notifications are separate facts. `rooms_active_today` counts
 * conversations that moved, not messages waiting for a reply, so it must not
 * be presented as an unread-message count. The Inbox tabs use the same two
 * sources; this hook keeps the shortcuts from disagreeing with them.
 */
export const unreadChatCount = (rooms) =>
  (Array.isArray(rooms) ? rooms : []).reduce(
    (total, room) => total + (Number(room?.unread_count) || 0),
    0,
  );

export const unreadNotificationCount = (activity) =>
  (activity?.groups || []).reduce(
    (total, group) =>
      total + (group?.items || []).filter((item) => !item.is_read).length,
    0,
  );

/** Fire a store loader without letting a failed request break the chrome. */
function quietly(loader) {
  try {
    Promise.resolve(loader?.()).catch(() => {});
  } catch {
    // A store may be unavailable in an embedded preview; zero is honest.
  }
}

export default function useAttentionCounts() {
  const rooms = useChatStore((s) => s.rooms);
  const fetchRooms = useChatStore((s) => s.fetchRooms);
  const activity = useOutsideStore((s) => s.activity);
  const loadActivity = useOutsideStore((s) => s.loadActivity);
  const roomCount = Array.isArray(rooms) ? rooms.length : 0;

  useEffect(() => {
    if (!activity) quietly(loadActivity);
  }, [activity, loadActivity]);

  useEffect(() => {
    // An empty room list still needs one read, otherwise every fresh session
    // would show zero messages until the user happened to visit the Inbox.
    if (roomCount === 0) quietly(fetchRooms);
  }, [roomCount, fetchRooms]);

  const chats = unreadChatCount(rooms);
  const notifications = unreadNotificationCount(activity);
  return { chats, notifications, total: chats + notifications };
}
