import { ArrowRight, Share2, Users } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { appUrl, shareLink } from "@/lib/share";
import { BRAND } from "@/config/brand";

/**
 * INVITE FRIENDS — the one promotional moment on Home.
 *
 * The background is the plum from the Ogallo design sketch (#963F70), deepened
 * into the theme's orchid and trade-green tokens — so the one promotional
 * surface is the bravest colour in the product, and still the product's own.
 *
 * A marketplace grows when its members bring the businesses they already trade
 * with, so this sits between the discovery shelves where a vendor is already in
 * a browsing frame of mind.
 *
 * It states no reward, because having one would be a promise the product cannot
 * keep: there is no referral programme, no credits and no commission in this
 * build. What it does is call the app's existing sharing flow — the device
 * share sheet, with a clipboard fallback — pointing at the public storefront,
 * which is the one page an invited business can read without an account.
 */
export default function ReferralBanner({ className }) {
  const invite = async () => {
    const result = await shareLink({
      title: `${BRAND.name} — the trade network`,
      text: `Bring your business into ${BRAND.name} and trade with the network.`,
      url: appUrl("/storefront"),
    });
    if (result === "copied") toast.success("Invite link copied — send it to a business you trade with");
    if (result === "failed") toast.error("This device couldn't open the share sheet. Try again from your phone's browser.");
  };

  return (
    <section
      aria-labelledby="invite-friends"
      data-testid="invite-friends-banner"
      className={`relative isolate overflow-hidden rounded-3xl border border-orchid-900/40 bg-gradient-to-br from-[#963F70] via-orchid-800 to-brand-800 text-white shadow-md ${className || ""}`}
    >
      {/* Two soft rings — texture belongs to the banner, not to a photo we would have to pretend is real. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full border border-white/15"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 right-10 h-40 w-40 rounded-full border border-white/10"
      />

      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-7 sm:py-6">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.14em] text-white/80">
            <Users size={12} aria-hidden="true" /> Grow the network
          </p>
          <h2 id="invite-friends" className="mt-2 text-lg font-extrabold leading-tight tracking-tight sm:text-xl">
            Invite friends. Grow together.
          </h2>
          <p className="mt-1.5 max-w-md text-2xs leading-relaxed text-white/85 sm:text-xs">
            Bring more businesses into {BRAND.name} and expand your trading network — the vendors you already buy from,
            and the ones who buy from you.
          </p>
        </div>

        <button
          type="button"
          onClick={invite}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-bold text-[#7a2f59] shadow-sm transition-transform hover:bg-orchid-50 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-orchid-800"
        >
          <Share2 size={16} aria-hidden="true" />
          Invite friends
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
