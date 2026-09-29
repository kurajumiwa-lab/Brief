import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ListChecks, Plus, Crown, Users, Lock, Unlock, Check, X, MessageSquare, Settings2, Star } from "lucide-react";
import Tabs from "@/components/ui/Tabs";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import VendorListForm from "@/components/forms/VendorListForm";
import ReviewsDrawer, { Stars } from "@/components/lists/ReviewPanel";
import { useListStore } from "@/stores/listStore";
import { useVendorStore } from "@/stores/vendorStore";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { apiError } from "@/lib/api";
import { num, shortDate } from "@/lib/formatters";
import { titleCase } from "@/lib/utils";

const TABS = [
  { value: "browse", label: "Browse" },
  { value: "mine", label: "My Lists" },
];

const STATUS_BADGE = { approved: "brand", pending: "amber", rejected: "red" };

export default function VendorLists() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "mine" ? "mine" : "browse";
  const [category, setCategory] = useState("");
  const [region, setRegion] = useState("");
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(null);
  const [reviews, setReviews] = useState(null);
  const me = useAuthStore((s) => s.vendor);
  const { lists, mine, loading, fetchLists, fetchMine, register } = useListStore();
  const { patron, fetchPatron, becomePatron } = useVendorStore();
  const confirm = useConfirm();

  useEffect(() => {
    fetchPatron().catch(() => {});
  }, [fetchPatron]);
  useEffect(() => {
    if (tab === "browse") fetchLists({ category, region }).catch((e) => toast.error(apiError(e)));
    else fetchMine().catch((e) => toast.error(apiError(e)));
  }, [tab, category, region, fetchLists, fetchMine]);

  const onBecomePatron = async () => {
    if (!(await confirm({ title: "Become a patron?", message: "Patrons run vendor lists and organise events. You start on the Starter tier: 1 list, up to 20 vendors.", confirmLabel: "Become a patron" }))) return;
    try {
      const res = await becomePatron();
      toast.success(res?.message || "You're a patron now");
    } catch (e) {
      toast.error(apiError(e, "Couldn't upgrade you"));
    }
  };

  const onRegister = async (list) => {
    try {
      const res = await register(list);
      toast.success(res?.message || "Registered");
    } catch (e) {
      toast.error(apiError(e, "Registration failed"));
    }
  };

  const isPatron = me?.is_patron || patron?.is_patron;
  const source = tab === "browse" ? lists : mine;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Vendor Lists</h2>
          <p className="text-xs text-ink-4">Curated rosters run by patrons — market days, supplier panels, sourcing pools. Register to get in; patrons vet the list.</p>
        </div>
        {isPatron ? (
          <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
            New list
          </Button>
        ) : (
          <Button size="sm" variant="secondary" icon={Crown} onClick={onBecomePatron}>
            Become a patron
          </Button>
        )}
      </div>

      {isPatron && patron?.is_patron && (
        <Card padding="px-4 py-3" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
            <Crown size={13} /> {titleCase(patron.tier || "starter")} patron
          </span>
          <span className="text-ink-4">
            lists <span className="font-mono text-ink-2">{patron.max_lists ?? "∞"}</span>
          </span>
          <span className="text-ink-4">
            vendors / list <span className="font-mono text-ink-2">{patron.max_vendors_per_list ?? "∞"}</span>
          </span>
          <span className="text-ink-4">
            managed <span className="font-mono text-ink-2">{num(patron.total_vendors_managed || 0)}</span>
          </span>
          <span className="text-ink-4">
            events <span className="font-mono text-ink-2">{num(patron.total_events_organized || 0)}</span>
          </span>
        </Card>
      )}

      <Tabs tabs={TABS} value={tab} onChange={(v) => setParams(v === "mine" ? { tab: "mine" } : {}, { replace: true })} />

      {tab === "browse" && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" />
          <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Region" />
        </div>
      )}

      {loading && source.length === 0 ? (
        <PageSpinner />
      ) : source.length === 0 ? (
        <EmptyState icon={ListChecks} title={tab === "mine" ? "You're not on any list yet" : "No lists match"} description={tab === "mine" ? "Lists you run or have registered for appear here." : "Patrons haven't opened a list for this filter yet."} />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {source.map((l) => (
            <ListCard key={l.id} list={l} onRegister={onRegister} onManage={setManaging} onReviews={setReviews} />
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Create a vendor list" description="Vendors register; you approve. Add entry criteria to let the API pre-screen them.">
        <VendorListForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} maxVendorsCap={patron?.max_vendors_per_list} />
      </Modal>
      <ManageDrawer list={managing} onClose={() => setManaging(null)} />
      <ReviewsDrawer list={reviews} onClose={() => setReviews(null)} />
    </div>
  );
}

function ListCard({ list: l, onRegister, onManage, onReviews }) {
  const navigate = useNavigate();
  const fetchRooms = useChatStore((s) => s.fetchRooms);
  const openRoom = async () => {
    const rooms = await fetchRooms({ mine_only: true }).catch(() => []);
    const room = rooms.find((r) => r.vendor_list_id === l.id);
    room ? navigate(`/chat?room=${room.id}`) : toast("This list has no chat room yet");
  };
  const full = l.max_vendors && l.member_count >= l.max_vendors;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink-1 truncate">{l.name}</h3>
          <p className="text-2xs text-ink-4 mt-0.5">
            run by <span className="text-ink-3">{l.patron_business}</span> <span className="font-mono">@{l.patron_handle}</span>
          </p>
          {l.review_count > 0 && (
            <button
              onClick={() => onReviews(l)}
              className="mt-1 inline-flex items-center gap-1.5 text-2xs text-ink-4 hover:text-ink-2 transition-colors"
              title="Read member reviews"
            >
              <Stars value={l.avg_rating} size={10} />
              <span className="font-mono">{Number(l.avg_rating || 0).toFixed(1)}</span>
              <span>· {num(l.review_count)} review{l.review_count === 1 ? "" : "s"}</span>
            </button>
          )}
        </div>
        {l.i_run_it ? (
          <Badge variant="amber" size="xs">
            <Crown size={10} /> yours
          </Badge>
        ) : l.my_status ? (
          <Badge variant={STATUS_BADGE[l.my_status] || "gray"} size="xs">
            {l.my_status}
          </Badge>
        ) : null}
      </div>
      {l.description && <p className="text-xs text-ink-3 line-clamp-2">{l.description}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {l.category && (
          <Badge variant="outline" size="xs">
            {l.category}
          </Badge>
        )}
        {l.region && (
          <Badge variant="outline" size="xs">
            {l.region}
          </Badge>
        )}
        {l.is_group_created && (
          <Badge variant="purple" size="xs">
            group list
          </Badge>
        )}
        <Badge variant={l.is_open ? "brand" : "gray"} size="xs">
          {l.is_open ? <Unlock size={9} /> : <Lock size={9} />} {l.is_open ? "open" : "closed"}
        </Badge>
        {l.requires_approval && (
          <Badge variant="gray" size="xs">
            approval
          </Badge>
        )}
      </div>
      {l.entry_criteria && Object.keys(l.entry_criteria).length > 0 && (
        <p className="text-2xs text-ink-4">
          Criteria: {Object.entries(l.entry_criteria).map(([k, v]) => `${titleCase(k)} ${Array.isArray(v) ? v.join("/") : v}`).join(" · ")}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="inline-flex items-center gap-1 text-xs text-ink-4 font-mono">
          <Users size={12} /> {num(l.member_count)}
          {l.max_vendors ? ` / ${num(l.max_vendors)}` : ""}
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="xs" variant="ghost" icon={Star} onClick={() => onReviews(l)}>
            Reviews
          </Button>
          {(l.i_run_it || l.my_status === "approved") && <Button size="xs" variant="ghost" icon={MessageSquare} onClick={openRoom} aria-label="Open list chat" />}
          {l.i_run_it ? (
            <Button size="xs" variant="secondary" icon={Settings2} onClick={() => onManage(l)}>
              Manage
            </Button>
          ) : l.my_status === "approved" ? (
            <Badge variant="brand">
              <Check size={10} /> Member
            </Badge>
          ) : l.my_status === "pending" ? (
            <span className="text-2xs text-amber-300">Awaiting approval</span>
          ) : (
            <Button size="xs" onClick={() => onRegister(l)} disabled={!l.is_open || full}>
              {full ? "Full" : !l.is_open ? "Closed" : l.my_status === "rejected" ? "Re-apply" : "Register"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function ManageDrawer({ list, onClose }) {
  const { members, approve, reject, setOpen } = useListStore();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const load = () => list && members(list.id).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    setRows([]);
    load();
  }, [list?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn, vendorId, label) => {
    setBusy(vendorId);
    try {
      await fn(list.id, vendorId);
      toast.success(label);
      load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(null);
    }
  };

  const pending = rows.filter((r) => r.status === "pending");
  const approved = rows.filter((r) => r.status === "approved");

  return (
    <Drawer open={!!list} onClose={onClose} title={list?.name} description={list ? `${num(list.member_count)} members · ${list.is_open ? "open" : "closed"} for registrations` : ""}>
      {list && (
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-lg border border-edge-1 bg-surface-2 px-3 py-2">
            <span className="text-xs text-ink-3">Registrations</span>
            <Button size="xs" variant={list.is_open ? "secondary" : "primary"} icon={list.is_open ? Lock : Unlock} onClick={() => setOpen(list, !list.is_open).catch((e) => toast.error(apiError(e)))}>
              {list.is_open ? "Close list" : "Open list"}
            </Button>
          </div>

          <section>
            <h4 className="text-xs font-semibold text-ink-2 mb-2">
              Pending approval <span className="font-mono text-ink-4">{pending.length}</span>
            </h4>
            {pending.length === 0 ? (
              <p className="text-2xs text-ink-4">Nobody waiting.</p>
            ) : (
              <ul className="space-y-2">
                {pending.map((r) => (
                  <li key={r.vendor_id} className="flex items-center gap-2.5 rounded-lg border border-edge-1 bg-surface-1 p-2.5">
                    <Avatar name={r.business_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-ink-1 truncate">{r.business_name}</p>
                      <p className="text-2xs text-ink-4 font-mono truncate">
                        @{r.vendor_handle} · {(r.business_categories || []).slice(0, 3).join(", ")}
                      </p>
                    </div>
                    <Button size="xs" icon={Check} loading={busy === r.vendor_id} onClick={() => act(approve, r.vendor_id, `Approved @${r.vendor_handle}`)} />
                    <Button size="xs" variant="dangerGhost" icon={X} disabled={busy === r.vendor_id} onClick={() => act(reject, r.vendor_id, `Rejected @${r.vendor_handle}`)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="text-xs font-semibold text-ink-2 mb-2">
              Members <span className="font-mono text-ink-4">{approved.length}</span>
            </h4>
            <ul className="space-y-1.5">
              {approved.map((r) => (
                <li key={r.vendor_id} className="flex items-center gap-2.5 text-xs">
                  <Avatar name={r.business_name} size="xs" />
                  <span className="text-ink-2 truncate">{r.business_name}</span>
                  <span className="font-mono text-ink-4 truncate">@{r.vendor_handle}</span>
                  <span className="ml-auto text-2xs text-ink-4">{shortDate(r.joined_at)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Drawer>
  );
}
