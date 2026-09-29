import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Users, Plus, MessageSquare, LogOut, Crown, ListPlus, Globe, Lock, Check } from "lucide-react";
import Tabs from "@/components/ui/Tabs";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import Drawer from "@/components/ui/Drawer";
import Select from "@/components/ui/Select";
import SearchInput from "@/components/ui/SearchInput";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import GroupForm from "@/components/forms/GroupForm";
import VendorListForm from "@/components/forms/VendorListForm";
import { useGroupStore } from "@/stores/groupStore";
import { GROUP_TYPES } from "@/config/constants";
import { apiError } from "@/lib/api";
import { num } from "@/lib/formatters";
import { titleCase } from "@/lib/utils";

const TABS = [
  { value: "browse", label: "Browse" },
  { value: "mine", label: "My Groups" },
];

export default function Groups() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "mine" ? "mine" : "browse";
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const { groups, mine, loading, fetchGroups, fetchMine, join, leave } = useGroupStore();
  const confirm = useConfirm();
  const navigate = useNavigate();

  useEffect(() => {
    if (tab === "browse") fetchGroups({ search, group_type: type }).catch((e) => toast.error(apiError(e)));
    else fetchMine().catch((e) => toast.error(apiError(e)));
  }, [tab, search, type, fetchGroups, fetchMine]);

  const onJoin = async (g) => {
    try {
      const res = await join(g);
      toast.success(res?.message || `Joined ${g.name}`);
    } catch (e) {
      toast.error(apiError(e, "Couldn't join"));
    }
  };
  const onLeave = async (g) => {
    if (!(await confirm({ title: `Leave ${g.name}?`, message: "You'll lose access to its chat room and any group-only lists.", confirmLabel: "Leave", danger: true }))) return;
    try {
      await leave(g);
      toast(`Left ${g.name}`);
    } catch (e) {
      toast.error(apiError(e, "Couldn't leave"));
    }
  };
  const openChat = (g) => (g.chat_room_id ? navigate(`/chat?room=${g.chat_room_id}`) : toast("No chat room for this group"));

  const source = tab === "browse" ? groups : mine;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Vendor Groups</h2>
          <p className="text-xs text-ink-4">Niche, regional, trade and sourcing collectives. Every group gets a chat room; admins can spin up vendor lists.</p>
        </div>
        <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
          New group
        </Button>
      </div>

      <Tabs tabs={TABS.map((t) => (t.value === "mine" && mine.length ? { ...t, count: mine.length } : t))} value={tab} onChange={(v) => setParams(v === "mine" ? { tab: "mine" } : {}, { replace: true })} />

      {tab === "browse" && (
        <div className="grid sm:grid-cols-[1fr_12rem] gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search groups" />
          <Select value={type} onChange={(e) => setType(e.target.value)} placeholder="Any type" options={GROUP_TYPES} />
        </div>
      )}

      {loading && source.length === 0 ? (
        <PageSpinner />
      ) : source.length === 0 ? (
        <EmptyState icon={Users} title={tab === "mine" ? "You haven't joined a group" : "No groups match"} description={tab === "mine" ? "Browse the network's groups or start your own." : "Be the first: start a group for your trade or your area."} action={<Button size="sm" icon={Plus} onClick={() => setCreating(true)}>Start a group</Button>} />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {source.map((g) => (
            <Card key={g.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => setOpen(g)} className="min-w-0 text-left">
                  <h3 className="text-sm font-semibold text-ink-1 truncate hover:text-brand-300">{g.name}</h3>
                  <p className="text-2xs text-ink-4 mt-0.5">
                    {titleCase(g.group_type)}
                    {g.region ? ` · ${g.region}` : ""}
                    {g.category ? ` · ${g.category}` : ""}
                  </p>
                </button>
                <RoleBadge role={g.my_role} />
              </div>
              {g.description && <p className="text-xs text-ink-3 line-clamp-2">{g.description}</p>}
              <div className="flex flex-wrap gap-1">
                {(g.tags || []).slice(0, 4).map((t) => (
                  <Badge key={t} variant="outline" size="xs">
                    {t}
                  </Badge>
                ))}
                <Badge variant="gray" size="xs">
                  {g.is_public ? <Globe size={9} /> : <Lock size={9} />} {g.is_public ? "public" : "private"}
                </Badge>
                {g.requires_approval && (
                  <Badge variant="gray" size="xs">
                    approval
                  </Badge>
                )}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="inline-flex items-center gap-1 text-xs text-ink-4 font-mono">
                  <Users size={12} /> {num(g.member_count)}
                </span>
                <div className="flex items-center gap-1.5">
                  {g.my_role && g.my_role !== "pending" ? (
                    <>
                      <Button size="xs" variant="secondary" icon={MessageSquare} onClick={() => openChat(g)}>
                        Chat
                      </Button>
                      <Button size="xs" variant="ghost" icon={LogOut} onClick={() => onLeave(g)} aria-label="Leave group" />
                    </>
                  ) : g.my_role === "pending" ? (
                    <span className="text-2xs text-amber-300">Awaiting approval</span>
                  ) : (
                    <Button size="xs" onClick={() => onJoin(g)}>
                      {g.requires_approval ? "Request to join" : "Join"}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Start a group">
        <GroupForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
      </Modal>
      <GroupDrawer group={open} onClose={() => setOpen(null)} onChat={openChat} />
    </div>
  );
}

function RoleBadge({ role }) {
  if (!role) return null;
  const map = { admin: ["amber", Crown], moderator: ["purple", null], member: ["brand", Check], pending: ["gray", null] };
  const [variant, Icon] = map[role] || ["gray", null];
  return (
    <Badge variant={variant} size="xs">
      {Icon && <Icon size={9} />} {role}
    </Badge>
  );
}

function GroupDrawer({ group, onClose, onChat }) {
  const { members, approve, createList } = useGroupStore();
  const [rows, setRows] = useState([]);
  const [listing, setListing] = useState(false);
  const load = () => group && members(group.id).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    setRows([]);
    setListing(false);
    load();
  }, [group?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const admin = group?.my_role === "admin" || group?.my_role === "moderator";
  const pending = rows.filter((m) => !m.is_active);
  const active = rows.filter((m) => m.is_active);

  return (
    <Drawer open={!!group} onClose={onClose} title={group?.name} description={group ? `${titleCase(group.group_type)} · ${num(group.member_count)} members · created by @${group.created_by || "?"}` : ""}>
      {group && (
        <div className="space-y-5">
          {group.description && <p className="text-sm text-ink-3 leading-relaxed">{group.description}</p>}
          <div className="flex flex-wrap gap-2">
            {group.my_role && group.my_role !== "pending" && (
              <Button size="sm" icon={MessageSquare} onClick={() => onChat(group)}>
                Open chat
              </Button>
            )}
            {admin && (
              <Button size="sm" variant="secondary" icon={ListPlus} onClick={() => setListing((v) => !v)}>
                Create vendor list
              </Button>
            )}
          </div>

          {listing && (
            <div className="rounded-xl border border-edge-1 bg-surface-2 p-4">
              <p className="text-xs text-ink-4 mb-3">A list owned by this group. You must be a patron; members of the group can register.</p>
              <VendorListForm onSubmit={(payload) => createList(group.id, payload)} onDone={() => setListing(false)} onCancel={() => setListing(false)} />
            </div>
          )}

          {admin && pending.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-ink-2 mb-2">
                Join requests <span className="font-mono text-ink-4">{pending.length}</span>
              </h4>
              <ul className="space-y-2">
                {pending.map((m) => (
                  <li key={m.vendor_id} className="flex items-center gap-2.5 rounded-lg border border-edge-1 bg-surface-1 p-2.5">
                    <Avatar name={m.business_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-ink-1 truncate">{m.business_name}</p>
                      <p className="text-2xs text-ink-4 font-mono">@{m.vendor_handle}</p>
                    </div>
                    <Button
                      size="xs"
                      icon={Check}
                      onClick={() =>
                        approve(group.id, m.vendor_id)
                          .then(() => {
                            toast.success(`Approved @${m.vendor_handle}`);
                            load();
                          })
                          .catch((e) => toast.error(apiError(e)))
                      }
                    >
                      Approve
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h4 className="text-xs font-semibold text-ink-2 mb-2">
              Members <span className="font-mono text-ink-4">{active.length}</span>
            </h4>
            {active.length === 0 ? (
              <p className="text-2xs text-ink-4">Members are visible once you've joined.</p>
            ) : (
              <ul className="space-y-1.5">
                {active.map((m) => (
                  <li key={m.vendor_id} className="flex items-center gap-2.5 text-xs">
                    <Avatar name={m.business_name} size="xs" />
                    <span className="text-ink-2 truncate">{m.business_name}</span>
                    <span className="font-mono text-ink-4 truncate">@{m.vendor_handle}</span>
                    <span className="ml-auto flex items-center gap-2 text-2xs text-ink-4">
                      {m.deals_made_in_group > 0 && <span>{m.deals_made_in_group} deals</span>}
                      <RoleBadge role={m.role} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
