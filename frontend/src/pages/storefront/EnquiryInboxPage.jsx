import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Inbox, RefreshCw } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { catalogAPI, apiError } from "@/lib/api";
import { tintForDesk } from "@/config/categoryTints";
import { cn } from "@/lib/utils";

/**
 * ENQUIRY INBOX — where a request lands.
 *
 * The desk is customer-facing and this is not: it answers one question, "what
 * came in that nobody has picked up yet", and lets an operator move a request
 * along. It is deliberately a list, not a dashboard — the enquiry IS the lead,
 * the offer's fixed scope is what gets quoted, and no money moves here.
 *
 * Access is decided by the server (market-ops roles). A vendor who is not
 * operations staff sees a plain "not available to you" instead of an empty
 * table, because a 403 dressed up as "no enquiries" would be a lie.
 */

const STATUSES = ["new", "contacted", "quoted", "won", "lost"];

export default function EnquiryInboxPage() {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await catalogAPI.inbox();
      setState({ loading: false, error: null, data });
    } catch (err) {
      if (err?.response?.status === 403) {
        setForbidden(true);
        setState({ loading: false, error: null, data: null });
        return;
      }
      setState({ loading: false, error: err, data: null });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const move = async (enquiry, status) => {
    setBusyId(enquiry.id);
    try {
      await catalogAPI.setEnquiryStatus(enquiry.id, status);
      toast.success(`${enquiry.offer_name || enquiry.desk_title || "Enquiry"} → ${status}`);
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not update the enquiry"));
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="min-h-screen bg-surface-1">
      <header className="border-b border-edge-1 bg-surface-0">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3">
          <Link to="/storefront" className="inline-flex items-center gap-1.5 text-sm font-bold text-ink-1">
            <ArrowLeft size={14} aria-hidden="true" /> Business Desk
          </Link>
          <span className="inline-flex items-center gap-1.5 text-2xs font-semibold text-ink-3">
            <Inbox size={13} aria-hidden="true" /> Enquiry management
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-5">
        {state.loading && <PageSpinner label="Loading enquiries…" />}

        {forbidden && !state.loading && (
          <div className="rounded-xl border border-edge-1 bg-surface-1 p-6 text-center" data-testid="inbox-forbidden">
            <p className="text-sm font-semibold text-ink-1">Enquiries are reviewed by operations staff.</p>
            <p className="mt-1 text-2xs text-ink-3">
              Your own requests stay visible under “Your requests” on the desk.
            </p>
            <Link to="/storefront" className="mt-3 inline-block">
              <Button size="sm" variant="secondary">Back to the desk</Button>
            </Link>
          </div>
        )}

        {!state.loading && state.error && (
          <div className="rounded-xl border border-edge-1 bg-surface-1 p-6 text-center">
            <p className="text-sm font-semibold text-ink-1">{apiError(state.error, "That didn't load.")}</p>
            <Button className="mt-3" size="sm" variant="secondary" icon={RefreshCw} onClick={load}>
              Try again
            </Button>
          </div>
        )}

        {!state.loading && state.data && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h1 className="text-xl font-extrabold tracking-tight text-ink-1">Enquiry inbox</h1>
                <p className="mt-0.5 text-2xs text-ink-3">{state.data.note}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={state.data.unpicked ? "amber" : "gray"} size="sm">
                  {state.data.unpicked} new
                </Badge>
                <Badge variant="gray" size="sm">{state.data.count} total</Badge>
              </div>
            </div>

            {state.data.items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-edge-1 p-6 text-center" data-testid="inbox-empty">
                <p className="text-sm font-semibold text-ink-1">No enquiries yet.</p>
                <p className="mt-1 text-2xs text-ink-3">
                  When a business submits the desk, its request appears here with the offer's scope attached.
                </p>
              </div>
            ) : (
              <ul className="space-y-2" data-testid="inbox-list">
                {state.data.items.map((enquiry) => {
                  const tint = tintForDesk(enquiry.desk_key);
                  return (
                    <li
                      key={enquiry.id}
                      data-testid="inbox-item"
                      data-desk={enquiry.desk_key}
                      className="rounded-xl border border-edge-1 bg-surface-1 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink-1">
                            {enquiry.offer_name || "Custom request"}
                            <span className={cn("rounded-full px-1.5 py-0.5 text-micro font-semibold", tint.wash, tint.ink)}>
                              {enquiry.desk_title}
                            </span>
                          </p>
                          <p className="mt-0.5 text-2xs text-ink-3">
                            {enquiry.kind} · {enquiry.vendor_business || enquiry.vendor_handle}
                            {enquiry.organisation_name ? ` · ${enquiry.organisation_name}` : ""}
                          </p>
                          {enquiry.notes && (
                            <p className="mt-1 line-clamp-2 text-2xs text-ink-2">{enquiry.notes}</p>
                          )}
                        </div>
                        <Badge variant={enquiry.status === "new" ? "amber" : "gray"} size="sm">
                          {enquiry.status}
                        </Badge>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {STATUSES.filter((s) => s !== enquiry.status).map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => move(enquiry, status)}
                            disabled={busyId === enquiry.id}
                            className="rounded-full border border-edge-2 px-2 py-0.5 text-micro font-semibold text-ink-3 transition-colors hover:border-ink-4 hover:text-ink-1 disabled:opacity-50"
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
