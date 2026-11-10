import { useEffect } from "react";
import { ShieldCheck, Store } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import VendorCard from "@/components/vendor/VendorCard";
import { useVendorStore } from "@/stores/vendorStore";

/**
 * The Mall: a curated directory of VERIFIED businesses only.
 *
 * P1 (information architecture) gives the Mall its own tab and page. The rule
 * that makes it a mall rather than an open market is enforced here as a
 * display gate: only businesses whose `is_verified` flag is true are shown.
 * The server-side gate (`mall_status`, staff approval, a database check) is
 * phase P3 and is not built yet, so this page must not be treated as the
 * authority on who is listed.
 *
 * Ordering is by the existing network score, which is organic. Nothing on
 * this page is paid. If a paid placement is ever added it must carry a
 * visible "Ad" or "Featured" label and sit outside this ordering (plan P3).
 */
export default function Mall() {
  const { network, loading, fetchNetwork } = useVendorStore();

  useEffect(() => {
    fetchNetwork({}).catch(() => {});
  }, [fetchNetwork]);

  const verified = network.filter((business) => business.is_verified === true);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-ink-1 tracking-tight flex items-center gap-2">
          <Store size={20} aria-hidden="true" /> Mall
        </h2>
        <p className="text-xs text-ink-4 mt-1">
          Verified businesses, checked by staff. Unverified businesses appear in{" "}
          <span className="font-medium text-ink-3">Local network</span>, not here.
        </p>
      </div>

      <p
        className="flex items-start gap-2 rounded-xl border border-edge-1 bg-surface-1 px-3 py-2 text-2xs text-ink-3"
        data-testid="mall-rule"
      >
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
        Listing here is not for sale. Order follows the network score, not payment.
      </p>

      {loading && network.length === 0 ? (
        <PageSpinner label="Loading the mall…" />
      ) : verified.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No verified businesses yet"
          description="Businesses appear here once staff have verified them. Until then they are visible in Local network, marked as not verified."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="mall-list">
          {verified.map((business) => (
            <VendorCard key={business.id} vendor={business} />
          ))}
        </div>
      )}
    </div>
  );
}
