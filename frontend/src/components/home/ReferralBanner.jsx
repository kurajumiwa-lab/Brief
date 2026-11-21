import { ArrowRight, Share2, Users } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { appUrl, shareLink } from "@/lib/share";
import { BRAND } from "@/config/brand";

/**
 * INVITE FRIENDS — the one promotional moment on Home.
 *
 * The surface is forest green, not plum. It used to run #963F70 → orchid-800 →
 * brand-800: a magenta nothing else in the product uses, which read as a
 * different app's banner pasted onto Home. An invitation is a *relationship*
 * gesture, so it belongs to the identity colour (brand), not to the
 * merchandising colour (mk-orange, which means "for sale"). The gradient now
 * stays inside one family, which is what makes it read as depth rather than as
 * a second brand.
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
      className={`relative isolate overflow-hidden rounded-3xl border border-brand-900/40 bg-gradient-to-br from-brand-600 via-brand-800 to-brand-900 text-white shadow-md ${className || ""}`}
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
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-bold text-brand-800 shadow-sm transition-transform hover:bg-brand-50 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-800 dark:text-brand-900"
        >
          <Share2 size={16} aria-hidden="true" />
          Invite friends
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
