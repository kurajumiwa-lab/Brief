import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import YouView from "@/components/you/YouView";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useStockStore } from "@/stores/stockStore";
import { useOffice } from "@/hooks/useOffice";
import { rankFor } from "@/config/identity";
import { pageUrl } from "@/lib/pageShare";
import { vendorAPI } from "@/lib/api";

/**
 * You. One page, four decisions: what the page says, what you can do, what has
 * been checked, and where you belong.
 *
 * The studio, passport, business desk, analytics and membership are not repeated
 * here. They are records, not identity, and they live behind one "Settings &
 * records" link — which is the difference between a workspace and a junk drawer.
 */
export default function YouPage() {
  const vendor = useAuthStore((s) => s.vendor);
  const identity = useIdentityStore();
  const loadIdentity = useIdentityStore((s) => s.load);
  const toggleCapability = useIdentityStore((s) => s.toggleCapability);
  const mine = useStockStore((s) => s.mine);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const { office } = useOffice();
  const [profile, setProfile] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadIdentity();
    fetchMine().catch(() => {});
    vendorAPI
      .profile()
      .then(({ data }) => setProfile(data))
      .catch(() => setProfile(null));
  }, [loadIdentity, fetchMine]);

  const rank = rankFor({ vendor, profile, identity });
  const handle = vendor?.vendor_handle;

  async function share() {
    if (typeof window === "undefined" || !handle) return;
    const url = pageUrl(handle);
    if (navigator.share) {
      try {
        await navigator.share({ title: vendor?.business_name || "My page", url });
        return;
      } catch {
        // The person dismissed the sheet; fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the address is on screen and can be selected.
    }
  }

  return (
    <div className="space-y-4">
      <YouView
        vendor={vendor}
        profile={profile || {}}
        identity={identity}
        rank={rank}
        institution={
          office
            ? { name: office.name, line: `${office.my_role || "Member"}${office.area ? ` · ${office.area}` : ""}` }
            : null
        }
        counts={{
          offers: mine.length,
          trades: vendor?.movements_completed || 0,
          verified: rank.level >= 5 || Boolean(vendor?.is_verified),
        }}
        copied={copied}
        onCopy={share}
        onShare={share}
        onToggleCapability={toggleCapability}
      />

      <p className="text-center text-micro text-ink-4">
        Running a business?{" "}
        <Link to="/workspace" className="font-semibold text-ink-3 hover:underline">
          The business workspace
        </Link>{" "}
        says where you stand and what is waiting on you.
      </p>

      <p className="text-center text-micro text-ink-4">
        Need the long tail?{" "}
        <Link to="/more" className="font-semibold text-ink-3 hover:underline">
          Settings & records
        </Link>{" "}
        has every remaining tool in one list.
      </p>
    </div>
  );
}
