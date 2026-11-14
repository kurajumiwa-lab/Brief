import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import PortfolioView from "@/components/you/PortfolioView";
import { PageSpinner } from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import { rankFor } from "@/config/identity";
import { vendorAPI } from "@/lib/api";

/**
 * `/p/<handle>` — the page a buyer opens.
 *
 * A handle is a URL, not an identity: it is never the headline, never what we
 * ask someone to remember, and never what the page is called. The page is the
 * person or institution's name.
 *
 * Identity claims live on the owner's device until the server returns them, so
 * they are read only when the viewer *is* the owner. Showing the viewer's own
 * claims on somebody else's page would be the worst kind of leak: a green badge
 * that means nothing.
 */
export default function PortfolioPage() {
  const { handle } = useParams();
  const me = useAuthStore((s) => s.vendor);
  const identity = useIdentityStore();
  const loadIdentity = useIdentityStore((s) => s.load);

  const [vendor, setVendor] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const own = Boolean(me?.vendor_handle && handle && me.vendor_handle === handle.replace(/^@/, ""));

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    vendorAPI
      .byHandle(String(handle).replace(/^@/, ""))
      .then(({ data }) => {
        if (alive) setVendor(data);
      })
      .catch((err) => {
        if (alive) setError(err?.response?.status === 404 ? "not-found" : "failed");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    if (own) loadIdentity();
    return () => {
      alive = false;
    };
  }, [handle, own, loadIdentity]);

  if (loading) return <PageSpinner label="Opening the page…" />;

  if (error === "not-found") {
    return (
      <EmptyState
        title="That page does not exist"
        description="The address may have changed, or the page may have been taken down. Region pages list everyone who is currently published."
      />
    );
  }

  if (error || !vendor) {
    return (
      <EmptyState
        title="The page didn't load"
        description="The server did not return this page. Nothing was changed. Try again in a moment."
      />
    );
  }

  const effectiveIdentity = own ? identity : {};
  const rank = rankFor({ vendor, identity: effectiveIdentity });

  async function share() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/p/${vendor.vendor_handle}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: vendor.business_name, url });
        return;
      } catch {
        // dismissed
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard blocked
    }
  }

  return (
    <div className="pb-4">
      <PortfolioView
        vendor={vendor}
        profile={{
          about: vendor.business_description,
          work_items: vendor.work_items || [],
          avatar_url: vendor.avatar_url,
          banner_url: vendor.banner_url,
        }}
        identity={effectiveIdentity}
        rank={rank}
        isOwner={own}
        onShare={share}
      />
    </div>
  );
}
