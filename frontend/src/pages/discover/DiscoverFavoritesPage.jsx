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
    <div className="mx-auto max-w-3xl space-y-s4 p-4 sm:p-6" data-testid="discover-favorites">
      <header>
        <p className="eyebrow flex items-center gap-1.5 text-ink-4"><Heart size={11} aria-hidden="true" /> Saved on this device</p>
        <h1 className="mt-1 text-title-page font-extrabold text-ink-1">Saved</h1>
        <p className="mt-1 max-w-xl text-sm text-ink-3">
          Cards you saved while browsing. They stay on this phone or browser; the owner is not
          notified, and a save does not verify anything or award standing.
        </p>
      </header>

      {items.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-edge-2 bg-surface-0 p-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"><Heart size={22} aria-hidden="true" /></span>
          <h2 className="mt-3 text-title-section font-extrabold text-ink-1">Nothing saved yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-3">Tap the heart on any card in Discover to keep it here.</p>
          <Link to="/regions" className="mt-4 inline-flex h-10 items-center rounded-lg bg-brand-700 px-4 text-xs font-bold text-white">Browse Discover</Link>
        </section>
      ) : (
        <MerchGrid items={items} />
      )}

      {items.length > 0 && (
        <p className="text-micro text-ink-4">{items.length} saved card{items.length === 1 ? "" : "s"} · {items.map(favoriteKey).length} local record{items.length === 1 ? "" : "s"}</p>
      )}
    </div>
  );
}
