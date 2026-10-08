import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Upload, Package, Globe, ArrowLeftRight, Filter } from "lucide-react";
import Tabs from "@/components/ui/Tabs";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import SearchInput from "@/components/ui/SearchInput";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import Badge from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import StockCard from "@/components/stock/StockCard";
import StockForm from "@/components/stock/StockForm";
import SourceDialog from "@/components/stock/SourceDialog";
import StockCompareModal from "@/components/stock/StockCompareModal";
import StockVerifyDialog from "@/components/stock/StockVerifyDialog";
import BulkImport from "@/components/stock/BulkImport";
import MovementRow from "@/components/stock/MovementRow";
import { useStockStore, needsMyAction } from "@/stores/stockStore";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { stockAPI, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "mine", label: "My Stock", icon: Package },
  { value: "network", label: "Network Stock", icon: Globe },
  { value: "movements", label: "Movements", icon: ArrowLeftRight },
];

export default function StockRoom() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "mine";
  const search = params.get("search") || "";
  const category = params.get("category") || "";
  const direction = params.get("direction") || "";

  const { mine, network, movements, categories, loading, networkLoading, fetchMine, fetchNetwork, fetchMovements, fetchCategories, remove, update, replaceItem } = useStockStore();
  const openDeal = useChatStore((s) => s.openDeal);
  const isPatron = useAuthStore((s) => !!s.vendor?.is_patron);

  const [editing, setEditing] = useState(null); // null | "new" | item
  const [importing, setImporting] = useState(false);
  const [sourcing, setSourcing] = useState(null);
  const [comparing, setComparing] = useState(null);
  const [verifying, setVerifying] = useState(null);

  const setParam = useCallback(
    (patch) => {
      const next = new URLSearchParams(params);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  useEffect(() => {
    if (params.get("new")) {
      setEditing("new");
      setParam({ new: "" });
    }
  }, [params, setParam]);

  useEffect(() => {
    fetchCategories().catch(() => {});
  }, [fetchCategories]);

  useEffect(() => {
    if (tab === "mine") fetchMine().catch((e) => toast.error(apiError(e)));
    if (tab === "network") fetchNetwork({ search, category }).catch((e) => toast.error(apiError(e)));
    if (tab === "movements") fetchMovements({ direction }).catch((e) => toast.error(apiError(e)));
  }, [tab, search, category, direction, fetchMine, fetchNetwork, fetchMovements]);

  const filteredMine = useMemo(() => {
    const q = search.toLowerCase();
    return mine.filter((i) => (!category || i.category === category) && (!q || `${i.name} ${i.sku || ""} ${(i.tags || []).join(" ")}`.toLowerCase().includes(q)));
  }, [mine, search, category]);

  const onRemove = async (item) => {
    if (!(await confirm({ title: `Remove ${item.name}?`, message: "It disappears from your shelf and the network. Existing movements keep their record.", confirmLabel: "Remove", danger: true }))) return;
    try {
      await remove(item.id);
      toast.success("Removed from your shelf");
    } catch (e) {
      toast.error(apiError(e, "Couldn't remove it"));
    }
  };

  const onToggleVisible = async (item) => {
    try {
      await update(item.id, { visible_to_network: !item.visible_to_network });
    } catch (e) {
      toast.error(apiError(e, "Couldn't change visibility"));
    }
  };

  const onDeal = async (item) => {
    try {
      const roomId = await openDeal(item.id);
      navigate(`/chat?room=${roomId}`);
    } catch (e) {
      toast.error(apiError(e, "Couldn't open a deal room"));
    }
  };

  const onPatronVerify = async (item) => {
    if (!(await confirm({ title: `Verify ${item.name}?`, message: `You vouch for @${item.vendor_handle}'s provenance on this item. It shows as patron-verified until they change the batch or origin.`, confirmLabel: "Verify" }))) return;
    try {
      const { data } = await stockAPI.patronVerify(item.id);
      const updated = data?.item || data;
      if (updated?.id) replaceItem(updated);
      else fetchNetwork({ search, category }).catch(() => {});
      toast.success("Marked patron-verified");
    } catch (e) {
      toast.error(apiError(e, "Couldn't verify this item"));
    }
  };

  const pendingCount = movements.filter(needsMyAction).length;
  const tabsWithCounts = TABS.map((t) => (t.value === "movements" && pendingCount ? { ...t, count: pendingCount } : t.value === "mine" ? { ...t, count: mine.length || undefined } : t));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Stock Room</h2>
          <p className="text-xs text-ink-4">Stock, not listings — what's on your shelf is what the network can source.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={Upload} onClick={() => setImporting(true)}>
            Import CSV
          </Button>
          <Button size="sm" icon={Plus} onClick={() => setEditing("new")}>
            Add stock
          </Button>
        </div>
      </div>

      <Tabs tabs={tabsWithCounts} value={tab} onChange={(v) => setParam({ tab: v })} />

      {tab !== "movements" ? (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            <SearchInput value={search} onChange={(v) => setParam({ search: v })} placeholder={tab === "mine" ? "Search your shelf" : "Search network stock"} className="sm:w-80" />
            {categories.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                <Filter size={13} className="text-ink-4 shrink-0" />
                <Chip active={!category} onClick={() => setParam({ category: "" })}>
                  All
                </Chip>
                {categories.map((c) => (
                  <Chip key={c} active={category === c} onClick={() => setParam({ category: category === c ? "" : c })}>
                    {c}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {tab === "mine" &&
            (loading && mine.length === 0 ? (
              <PageSpinner />
            ) : filteredMine.length === 0 ? (
              <EmptyState
                icon={Package}
                title={mine.length ? "Nothing matches" : "Your shelf is empty"}
                description={mine.length ? "Try another search or category." : "Add stock by hand, import your till's CSV, or connect a POS so it stays live on its own."}
                action={
                  !mine.length && (
                    <div className="flex gap-2">
                      <Button size="sm" icon={Plus} onClick={() => setEditing("new")}>
                        Add stock
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => navigate("/pos")}>
                        Connect POS
                      </Button>
                    </div>
                  )
                }
              />
            ) : (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {filteredMine.map((item) => (
                  <StockCard key={item.id} item={item} mode="mine" onEdit={setEditing} onRemove={onRemove} onToggleVisible={onToggleVisible} onVerify={setVerifying} />
                ))}
              </div>
            ))}

          {tab === "network" &&
            (networkLoading && network.length === 0 ? (
              <PageSpinner />
            ) : network.length === 0 ? (
              <EmptyState icon={Globe} title="No network stock here" description="Nobody is showing stock for this search yet. Connect with more vendors — visible stock from the whole network appears here." />
            ) : (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {network.map((item) => (
                  <StockCard key={item.id} item={item} mode="network" onSource={setSourcing} onDeal={onDeal} onCompare={setComparing} canPatronVerify={isPatron} onPatronVerify={onPatronVerify} />
                ))}
              </div>
            ))}
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            {[
              ["", "All"],
              ["incoming", "Incoming · I'm sourcing"],
              ["outgoing", "Outgoing · I'm supplying"],
            ].map(([v, l]) => (
              <Chip key={v} active={direction === v} onClick={() => setParam({ direction: v })}>
                {l}
              </Chip>
            ))}
            {pendingCount > 0 && (
              <Badge variant="amber" className="ml-auto">
                {pendingCount} need{pendingCount === 1 ? "s" : ""} your action
              </Badge>
            )}
          </div>
          {movements.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title="No movements yet" description="A movement is created when you source from a vendor or they source from you. Supplier confirms → ships, buyer receives — only received movements score." />
          ) : (
            <div className="space-y-2">
              {[...movements].sort((a, b) => Number(needsMyAction(b)) - Number(needsMyAction(a))).map((m) => (
                <MovementRow key={m.id} movement={m} />
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add stock" : `Edit ${editing?.name || ""}`} description="Quantities are live: reservations from pending movements are held automatically.">
        {editing && <StockForm item={editing === "new" ? null : editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal open={importing} onClose={() => setImporting(false)} title="Import stock from CSV" size="sm">
        <BulkImport onDone={() => setImporting(false)} />
      </Modal>
      <SourceDialog item={sourcing} open={!!sourcing} onClose={() => setSourcing(null)} onDone={() => fetchMovements().catch(() => {})} />
      <StockCompareModal
        item={comparing}
        open={!!comparing}
        onClose={() => setComparing(null)}
        onSource={(alt) => {
          setComparing(null);
          setSourcing(alt);
        }}
      />
      <StockVerifyDialog item={verifying} open={!!verifying} onClose={() => setVerifying(null)} />
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={cn("shrink-0 rounded-full border px-2.5 h-7 text-xs transition-colors", active ? "border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400" : "border-edge-1 bg-surface-1 text-ink-3 hover:border-edge-2 hover:text-ink-1")}>
      {children}
    </button>
  );
}
