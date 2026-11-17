import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PresetContent from "@/components/page/PresetContent";
import PortfolioView from "@/components/you/PortfolioView";
import { PageSpinner } from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import { rankFor } from "@/config/identity";
import { vendorAPI, professionalAPI } from "@/lib/api";
import { pageUrl } from "@/lib/pageShare";

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
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.vendor);
  const identity = useIdentityStore();
  const loadIdentity = useIdentityStore((s) => s.load);

  const [vendor, setVendor] = useState(null);
  const [pageCard, setPageCard] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const own = Boolean(me?.vendor_handle && handle && me.vendor_handle === handle.replace(/^@/, ""));

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setPageCard(null);
    professionalAPI.page(String(handle).replace(/^@/, "")).then(({data}) => { if (alive && data.handle && data.handle !== String(handle).replace(/^@/, "").toLowerCase()) navigate(`/p/${data.handle}`, {replace:true}); else if (alive) setPageCard(data); }).catch(() => {});
    vendorAPI
      .byHandle(String(handle).replace(/^@/, ""))
      .then(({ data }) => {
        if (alive && data.vendor_handle && data.vendor_handle !== String(handle).replace(/^@/, "").toLowerCase()) navigate(`/p/${data.vendor_handle}`, {replace:true});
        else if (alive) setVendor(data);
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
  }, [handle, own, loadIdentity, navigate]);

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
    const url = pageUrl(vendor.vendor_handle);
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
      <div className="mx-auto max-w-2xl px-4">
        {pageCard?.whatsapp_phone && /^\+254[17]\d{8}$/.test(pageCard.whatsapp_phone) && <a className="mt-4 inline-block rounded-xl bg-[#128C4A] px-4 py-2 text-sm font-bold text-white" href={`https://wa.me/${pageCard.whatsapp_phone.slice(1)}`} target="_blank" rel="noreferrer">{pageCard.preset === "service" ? "Book / Request Slot on WhatsApp" : "Chat on WhatsApp"}</a>}
        <PresetContent card={pageCard} />
      </div>
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
