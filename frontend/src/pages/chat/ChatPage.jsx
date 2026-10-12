import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Hash, ArrowLeft, Wifi, WifiOff, Users, LogIn, Receipt, UserCheck, MessageSquare } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import RoomList from "@/components/chat/RoomList";
import MessageBubble from "@/components/chat/MessageBubble";
import ChatInput from "@/components/chat/ChatInput";
import ChatIdentityModal, { resolveIdentityDisplay } from "@/components/chat/ChatIdentityModal";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { chatAPI, apiError } from "@/lib/api";
import { parseApiDate } from "@/lib/formatters";
import { splitList, cn, titleCase } from "@/lib/utils";

export default function ChatPage() {
  const [params, setParams] = useSearchParams();
  const roomParam = params.get("room");
  const me = useAuthStore((s) => s.vendor);
  const {
    rooms,
    activeRoom,
    messages,
    loading,
    sending,
    live,
    chatIdentity,
    loadIdentity,
    fetchRooms,
    selectRoom,
    leaveRoom,
    send,
    sendVoice,
    joinRoom,
    createTopic,
  } = useChatStore();
  const [topicOpen, setTopicOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetchRooms().catch((e) => toast.error(apiError(e)));
    loadIdentity?.().catch(() => {});
    return () => leaveRoom();
  }, [fetchRooms, leaveRoom, loadIdentity]);

  // deep link: /chat?room=<id> — from groups, lists, vendor cards and deal buttons
  useEffect(() => {
    if (!roomParam || activeRoom?.id === roomParam) return;
    const known = rooms.find((r) => r.id === roomParam);
    if (known) selectRoom(known);
    else
      chatAPI
        .room(roomParam)
        .then(({ data }) => {
          selectRoom(data);
          fetchRooms().catch(() => {});
        })
        .catch(() => toast.error("That room isn't available to you"));
  }, [roomParam, rooms, activeRoom?.id, selectRoom, fetchRooms]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeRoom?.id]);

  const pick = (room) => setParams({ room: room.id }, { replace: true });
  const back = () => {
    leaveRoom();
    setParams({}, { replace: true });
  };

  const onJoin = async () => {
    try {
      await joinRoom(activeRoom.id);
      useChatStore.setState((s) => ({ activeRoom: { ...s.activeRoom, joined: true } }));
      toast.success(`Joined #${activeRoom.name}`);
    } catch (e) {
      toast.error(apiError(e, "Couldn't join"));
    }
  };

  const canPost = activeRoom && (activeRoom.joined || activeRoom.room_type !== "niche");

  const headerIdentity = resolveIdentityDisplay({
    vendor: me,
    chatIdentity,
    location: "message_header",
  });

  const otherParticipant =
    activeRoom && (activeRoom.participants || []).find((p) => p.id !== me?.id);

  return (
    <div className="h-full flex border-t border-edge-1 lg:border-t-0 bg-surface-0">
      <aside className={cn("w-full lg:w-72 xl:w-80 shrink-0 border-r border-edge-1 bg-surface-0", activeRoom ? "hidden lg:block" : "block")}>
        <RoomList
          rooms={rooms}
          activeId={activeRoom?.id}
          onSelect={pick}
          onNewTopic={() => setTopicOpen(true)}
          onOpenIdentity={() => setIdentityOpen(true)}
        />
      </aside>

      <section className={cn("flex-1 min-w-0 flex flex-col bg-surface-0", activeRoom ? "flex" : "hidden lg:flex")}>
        {!activeRoom ? (
          <div className="flex-1 flex items-center justify-center p-6 bg-surface-1">
            <EmptyState
              icon={Hash}
              illustration="messages"
              title="Pick a room"
              description="Direct messages, deal rooms, group chats and open topics all live here. Start a topic if the conversation doesn't exist yet."
              action={<Button size="sm" onClick={() => setTopicOpen(true)}>New topic</Button>}
              secondaryAction={
                <Button size="sm" variant="secondary" icon={UserCheck} onClick={() => setIdentityOpen(true)}>
                  Chat identity
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <header className="h-14 shrink-0 flex items-center gap-2.5 px-3.5 border-b border-edge-1 bg-surface-0 shadow-2xs">
              <button onClick={back} className="lg:hidden p-1.5 -ml-1 rounded-lg text-ink-3 hover:text-ink-1" aria-label="Back to rooms">
                <ArrowLeft size={16} />
              </button>
              {chatIdentity?.locations?.message_header !== false && (
                <Avatar
                  name={otherParticipant?.business_name || activeRoom.name}
                  personalName={otherParticipant?.sender_name || headerIdentity.personalName}
                  businessName={otherParticipant?.business_name || activeRoom.name}
                  src={otherParticipant?.avatar_url || headerIdentity.avatarUrl || undefined}
                  logoSrc={otherParticipant?.logo_url || headerIdentity.logoUrl || undefined}
                  mode={headerIdentity.mode}
                  size="sm"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-ink-1 truncate">{activeRoom.name}</h2>
                  <Badge variant="gray" size="xs">
                    {titleCase(activeRoom.room_type)}
                  </Badge>
                </div>
                <p className="text-2xs text-ink-4 truncate">
                  {activeRoom.topic || `${activeRoom.participant_count} vendors`}
                  {activeRoom.topic_tags?.length ? ` · ${activeRoom.topic_tags.map((t) => `#${t}`).join(" ")}` : ""}
                  {chatIdentity?.locations?.message_header !== false && (
                    <span className="hidden sm:inline text-ink-3">
                      {" · "}Speaking as {headerIdentity.primaryTitle}
                      {headerIdentity.mode === "business_with_role" && headerIdentity.roleTitle
                        ? ` (${headerIdentity.roleTitle})`
                        : ""}
                    </span>
                  )}
                </p>
              </div>
              {activeRoom.stock_movement_id && (
                <Link
                  to={`/orders/${activeRoom.stock_movement_id}`}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-edge-2 bg-surface-0 px-2 text-2xs font-semibold text-ink-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <Receipt size={13} aria-hidden="true" />
                  <span className="hidden sm:inline">Order</span>
                  <span className="sr-only">View linked order</span>
                </Link>
              )}
              <Button
                size="xs"
                variant="secondary"
                icon={UserCheck}
                onClick={() => setIdentityOpen(true)}
                title="Configure personal photo and business logo"
              >
                <span className="hidden sm:inline">Chat identity</span>
              </Button>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-2xs",
                  live ? "text-brand-600 dark:text-brand-400" : "text-ink-4"
                )}
                title={live ? "Live" : "Reconnecting…"}
              >
                {live ? <Wifi size={12} /> : <WifiOff size={12} />}
                <span className="hidden sm:inline">{live ? "live" : "offline"}</span>
              </span>
              <span className="inline-flex items-center gap-1 text-2xs text-ink-4">
                <Users size={12} /> {activeRoom.participant_count}
              </span>
            </header>

            <div className="flex-1 overflow-y-auto py-3 bg-surface-0">
              {loading ? (
                <Spinner className="py-10" />
              ) : messages.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    compact
                    icon={MessageSquare}
                    illustration="messages"
                    title="No messages in this room yet"
                    description="Start the conversation, share a stock line from your shelf, or propose a structured deal."
                  />
                </div>
              ) : (
                messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const grouped =
                    prev &&
                    prev.sender_id === m.sender_id &&
                    parseApiDate(m.sent_at) - parseApiDate(prev.sent_at) < 5 * 60 * 1000;
                  return <MessageBubble key={m.id || i} message={m} mine={m.sender_id === me?.id} showHeader={!grouped} />;
                })
              )}
              <div ref={bottomRef} />
            </div>

            {canPost ? (
              <ChatInput
                onSend={send}
                onSendVoice={sendVoice}
                sending={sending}
                placeholder={`Message ${activeRoom.room_type === "direct" ? activeRoom.name : "#" + activeRoom.name}`}
              />
            ) : (
              <div className="border-t border-edge-1 bg-surface-1 p-3 flex items-center justify-between gap-3">
                <p className="text-xs text-ink-4">You're reading an open topic. Join to post.</p>
                <Button size="sm" icon={LogIn} onClick={onJoin}>
                  Join topic
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <NewTopicModal
        open={topicOpen}
        onClose={() => setTopicOpen(false)}
        onCreate={createTopic}
        onCreated={(id) => setParams({ room: id })}
      />
      <ChatIdentityModal open={identityOpen} onClose={() => setIdentityOpen(false)} />
    </div>
  );
}

function NewTopicModal({ open, onClose, onCreate, onCreated }) {
  const [form, setForm] = useState({ name: "", topic: "", tags: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (form.name.trim().length < 2 || !form.topic.trim()) return toast.error("Name and topic are required");
    setBusy(true);
    try {
      const res = await onCreate({ name: form.name.trim(), topic: form.topic.trim(), topic_tags: splitList(form.tags) });
      toast.success(res?.message || "Topic created");
      setForm({ name: "", topic: "", tags: "" });
      onClose();
      if (res?.room_id) onCreated(res.room_id);
    } catch (err) {
      toast.error(apiError(err, "Couldn't create the topic"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Start a niche topic" description="Open to every vendor on the network." size="sm">
      <form onSubmit={submit} className="space-y-3">
        <Input label="Room name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Import regulations" autoFocus />
        <Input label="Topic" required value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="KEBS, KRA and clearing agents for small importers" />
        <Input label="Tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="imports, compliance" hint="Comma separated" />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Create topic
          </Button>
        </div>
      </form>
    </Modal>
  );
}
