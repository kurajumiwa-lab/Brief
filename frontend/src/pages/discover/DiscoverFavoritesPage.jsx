import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import { MerchGrid } from "@/components/discover/MerchCard";
import { favoriteKey, favoritesEvent, loadFavorites } from "@/lib/discoverFavorites";

/**
 * SAVED CARDS — held on this device.
 *
 * No server sync, no notification to the owner, no standing credit. The empty
 * state says exactly that rather than pretending a sync exists.
 */
export default function DiscoverFavoritesPage() {
  const [items, setItems] = useState(() => loadFavorites());

  useEffect(() => {
    const reload = () => setItems(loadFavorites());
    window.addEventListener(favoritesEvent, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(favoritesEvent, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-s4 bg-mk-cream p-4 text-mk-ink sm:p-6" data-testid="discover-favorites">
      <header>
        <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-mk-orange"><Heart size={11} aria-hidden="true" /> Saved on this device</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-mk-ink">Saved</h1>
        <p className="mt-1 max-w-xl text-sm text-mk-ink-soft">
          Cards you saved while browsing. They stay on this phone or browser; the owner is not
          notified, and a save does not verify anything or award standing.
        </p>
      </header>

      {items.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-mk-line bg-mk-card p-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-mk-orange-soft text-mk-orange"><Heart size={22} aria-hidden="true" /></span>
          <h2 className="mt-3 text-title-section font-extrabold text-mk-ink">Nothing saved yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-mk-ink-soft">Tap the heart on any card in Discover to keep it here.</p>
          <Link to="/regions" className="mt-4 inline-flex h-10 items-center rounded-lg bg-mk-ink px-4 text-xs font-extrabold text-mk-cream">Browse Discover</Link>
        </section>
      ) : (
        <MerchGrid items={items} />
      )}

      {items.length > 0 && (
        <p className="text-micro text-mk-ink-soft">{items.length} saved card{items.length === 1 ? "" : "s"} · {items.map(favoriteKey).length} local record{items.length === 1 ? "" : "s"}</p>
      )}
    </div>
  );
}
