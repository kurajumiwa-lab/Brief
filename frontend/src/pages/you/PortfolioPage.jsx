import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PresetContent from "@/components/page/PresetContent";
import PaymentTag from "@/components/page/PaymentTag";
import PortfolioView from "@/components/you/PortfolioView";
import SocialTrustCard from "@/components/social/SocialTrustCard";
import { PageSpinner } from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import { rankFor } from "@/config/identity";
import { vendorAPI, professionalAPI, socialTrustAPI, offeringsAPI } from "@/lib/api";
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
 *
 * Four things arrive in parallel, and each one is allowed to fail alone:
 *   · the page card — the preset's public content
 *   · the account — name, place, contact, work and gallery
 *   · the trust signals — optional, the page still works without them
 *   · the offers — the real listings, which is what a visitor came for
 */
export default function PortfolioPage() {
  const { handle } = useParams();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.vendor);
  const identity = useIdentityStore();
  const loadIdentity = useIdentityStore((s) => s.load);

  const [vendor, setVendor] = useState(null);
  const [pageCard, setPageCard] = useState(null);
  const [trustCard, setTrustCard] = useState(null);
  const [offers, setOffers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const slug = String(handle).replace(/^@/, "");
  const own = Boolean(me?.vendor_handle && handle && me.vendor_handle === slug);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setPageCard(null);
    setTrustCard(null);
    setOffers([]);
    professionalAPI.page(slug).then(({ data }) => { if (alive && data.handle && data.handle !== slug.toLowerCase()) navigate(`/p/${data.handle}`, { replace: true }); else if (alive) setPageCard(data); }).catch(() => {});
    vendorAPI
      .byHandle(slug)
      .then(({ data }) => {
        if (alive && data.vendor_handle && data.vendor_handle !== slug.toLowerCase()) navigate(`/p/${data.vendor_handle}`, { replace: true });
        else if (alive) setVendor(data);
      })
      .catch((err) => {
        if (alive) setError(err?.response?.status === 404 ? "not-found" : "failed");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    socialTrustAPI
      ?.publicCard?.(slug)
      ?.then(({ data }) => { if (alive) setTrustCard(data); })
      ?.catch(() => { /* the page still works without its trust signals */ });
    // The listings are public and need no account. A page with none simply
    // shows none; a failure here must not take the page down with it.
    offeringsAPI
      ?.of?.(slug)
      ?.then(({ data }) => {
        if (alive) setOffers(Array.isArray(data?.items) ? data.items : []);
      })
      ?.catch(() => {});
    if (own) loadIdentity();
    return () => {
      alive = false;
    };
  }, [handle, own, loadIdentity, navigate, slug]);

  /**
   * The owner's one write on this page: the gallery board.
   *
   * It sends the whole list because that is what the API contract says — a list
   * is the board, so removing a photo is the same call as adding one. The board
   * is re-read afterwards so what is on screen is what was actually stored.
   */
  const saveGallery = useCallback(async (items) => {
    await vendorAPI.updateProfile({ gallery_items: items });
    const { data } = await vendorAPI.byHandle(slug);
    setVendor(data);
  }, [slug]);

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
        {trustCard && <SocialTrustCard card={trustCard} className="mt-4" />}
        {pageCard?.whatsapp_phone && /^\+254[17]\d{8}$/.test(pageCard.whatsapp_phone) && <a className="mt-4 inline-block rounded-xl bg-[#128C4A] px-4 py-2 text-sm font-bold text-white" href={`https://wa.me/${pageCard.whatsapp_phone.slice(1)}`} target="_blank" rel="noreferrer">{pageCard.preset === "service" ? "Book / Request Slot on WhatsApp" : "Chat on WhatsApp"}</a>}
        <PaymentTag tag={pageCard?.payment_tag} className="mt-4" />
        <PresetContent card={pageCard} />
      </div>
      <PortfolioView
        vendor={vendor}
        profile={{
          about: vendor.business_description,
          work_items: vendor.work_items || [],
          gallery_items: vendor.gallery_items || [],
          avatar_url: vendor.avatar_url,
          banner_url: vendor.banner_url,
        }}
        offers={offers}
        identity={effectiveIdentity}
        rank={rank}
        isOwner={own}
        onShare={share}
        onSaveGallery={own ? saveGallery : undefined}
      />
    </div>
  );
}
