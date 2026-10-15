import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, BookOpen, Search } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Input from "@/components/ui/Input";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { apiError, ordersAPI } from "@/lib/api";
import { preciseCurrency, num, relativeTime, shortDate } from "@/lib/formatters";
import { tradeRecordsCsv } from "@/lib/tradeRecordsCsv";

const PAGE_SIZE = 30;
const FALLBACK_NOTICE = "This is your record of trades on Brief_. It is not a receipt, an invoice, or a tax document.";
const stateLabel = (value) => value?.replaceAll("_", " ") || "not recorded";

/** Search and CSV share a cursor + filter, so export means exactly this page. */
export default function TradeRecordsPage() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [cursors, setCursors] = useState([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [page, setPage] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [now, setNow] = useState(Date.now());
  const cursor = cursors[pageIndex];

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await ordersAPI.records({ q, cursor, limit: PAGE_SIZE });
      setPage(data);
      setLoadedAt(new Date());
    } catch (err) {
      setError(apiError(err, "Could not load your trade records"));
    } finally {
      setLoading(false);
    }
  }, [q, cursor]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onOnline = () => { setOnline(true); load(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const ticker = window.setInterval(() => setNow(Date.now()), 30000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(ticker);
    };
  }, [load]);

  const search = (event) => {
    event.preventDefault();
    if (!online) { setError("Reconnect to search your records"); return; }
    setCursors([null]);
    setPageIndex(0);
    setPage(null);
    setQ(text.trim());
    if (text.trim() === q && pageIndex === 0) load();
  };

  const exportPage = () => {
    try {
      // Export the rows actually displayed, not a later server re-query. The
      // server has already bounded this page to 30 records (API max 100).
      const url = URL.createObjectURL(tradeRecordsCsv(page));
      const link = document.createElement("a");
      link.href = url;
      link.download = `brief-trade-records-page-${pageIndex + 1}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Displayed trade records exported for this page");
    } catch (err) {
      toast.error(err.message || "The export did not complete");
    }
  };

  const isStale = loadedAt && now - loadedAt.getTime() > 60000;
  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-10">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Orders", to: "/orders" }, { label: "My records" }]} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-micro font-bold uppercase tracking-widest text-brand-700 dark:text-brand-300">Your business, your history</p>
          <h1 className="text-2xl font-bold text-ink-1">My trade records</h1>
          <p className="text-xs text-ink-3 mt-1">Amounts are recorded product prices. Goods and settlement are separate; a completed handover is not proof of payment.</p>
        </div>
        {page?.items?.length > 0 && <Button size="sm" variant="secondary" icon={ArrowDownToLine} onClick={exportPage}>Export this page (CSV)</Button>}
      </header>

      <form onSubmit={search} role="search" aria-label="Search my trade records" className="flex flex-wrap items-end gap-2">
        <Input label="Search item, SKU or @handle" wrapperClassName="min-w-[220px] flex-1" value={text} maxLength={100} onChange={(event) => setText(event.target.value)} placeholder="e.g. tomatoes" />
        <Button size="sm" type="submit" icon={Search}>Search</Button>
      </form>

      {!online && <p role="status" className="rounded-xl bg-accent-50 p-3 text-xs text-accent-900 dark:bg-accent-500/10 dark:text-accent-200">You are offline. Results and CSV exports use your last loaded view, not a live status. Search and page changes need a connection.</p>}
      {isStale && <p role="status" className="text-2xs text-ink-4">Last updated {relativeTime(loadedAt)} · <button type="button" className="underline" onClick={load}>Refresh</button></p>}
      {error && page && <p role="alert" className="text-2xs text-red-700 dark:text-red-400">{error} — showing your last loaded view. <button type="button" className="underline" onClick={load}>Retry</button></p>}
      {error && !page ? <ErrorState title="Records unavailable" description={error} onRetry={load} /> : loading && !page ? <SkeletonRows count={3} /> : page?.items?.length === 0 ? (
        <EmptyState icon={BookOpen} tone="brand" title={q ? "No trades match your search" : "Your trade record starts with one handover"}
          description={q ? "Try an item, SKU or supplier handle from a different order." : "Find stock from a vendor you already trade with, then confirm the handover. Your record will appear here."}
          action={q ? <Button size="sm" variant="secondary" onClick={() => { setText(""); setQ(""); setCursors([null]); setPageIndex(0); setPage(null); }}>Clear search</Button>
            : <Link to="/browse?type=goods"><Button size="sm">Find stock</Button></Link>} />
      ) : page?.items?.length > 0 ? (
        <>
          <p className="text-2xs text-ink-3">{num(page.summary?.received)} confirmed handover{page.summary?.received === 1 ? "" : "s"} · {num(page.summary?.recorded)} recorded movement{page.summary?.recorded === 1 ? "" : "s"} in total</p>
          <ol className="space-y-2">
            {page.items.map((row) => <li key={row.id} className="rounded-2xl border border-edge-1 bg-surface-0 p-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link to={`/orders/${row.id}`} className="text-sm font-bold text-ink-1 hover:underline underline-offset-2">{row.item}</Link>
                  <p className="text-xs text-ink-3">{row.direction === "incoming" ? "From" : "To"} @{row.counterparty_handle} · {shortDate(row.date)} · ref {row.reference.slice(0, 8)}</p>
                </div>
                <strong className="tabular-nums text-sm text-ink-1">{preciseCurrency(row.total_kes)}</strong>
              </div>
              <p className="text-2xs text-ink-3">{num(row.quantity)} {row.unit} × {preciseCurrency(row.unit_price_kes)}/{row.unit}</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant={row.goods_status === "received" ? "brand" : row.goods_status === "cancelled" ? "red" : "amber"} size="xs">Goods: {stateLabel(row.goods_status)}</Badge>
                <Badge variant="gray" size="xs">Settlement: {stateLabel(row.settlement_status)}</Badge>
              </div>
            </li>) }
          </ol>
          <nav aria-label="Trade record pages" className="flex items-center justify-between gap-2">
            <Button size="sm" variant="secondary" disabled={!online || pageIndex === 0 || loading} onClick={() => { setPage(null); setPageIndex(pageIndex - 1); }}>Previous</Button>
            <span className="text-2xs text-ink-4">Page {pageIndex + 1} · CSV exports this page only</span>
            <Button size="sm" variant="secondary" disabled={!online || !page.next_cursor || loading} onClick={() => { setCursors([...cursors.slice(0, pageIndex + 1), page.next_cursor]); setPage(null); setPageIndex(pageIndex + 1); }}>Next</Button>
          </nav>
        </>
      ) : null}
      <footer className="border-t border-edge-1 pt-4 text-xs text-ink-3" role="note">{page?.disclaimer || FALLBACK_NOTICE}</footer>
    </div>
  );
}
