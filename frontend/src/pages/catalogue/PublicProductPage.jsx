import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { offeringsAPI } from "@/lib/api";
import ProductGallery from "@/components/stock/ProductGallery";
import { priceLine } from "@/config/showcase";

/** Read only published offerings; no private account fields or invented checkout. */
export default function PublicProductPage() {
  const { handle, id } = useParams();
  const [state, setState] = useState({ loading: true, item: null, error: false });
  useEffect(() => {
    let active = true;
    setState({ loading: true, item: null, error: false });
    offeringsAPI.publicItem(handle, "goods", id).then(({ data }) => {
      if (active) setState({ loading: false, item: data || null, error: false });
    }).catch(() => { if (active) setState({ loading: false, item: null, error: true }); });
    return () => { active = false; };
  }, [handle, id]);
  if (state.loading) return <main className="p-6" role="status">Loading product…</main>;
  if (!state.item) return <main className="mx-auto max-w-xl space-y-3 p-6"><h1 className="text-xl font-bold">{state.error ? "Product unavailable right now" : "Product not available"}</h1><p className="text-sm">It may have been removed or made private. Try the seller’s page.</p><Link className="underline" to={`/p/${encodeURIComponent(handle)}`}>Visit seller’s page</Link></main>;
  const item = state.item;
  return <main className="mx-auto max-w-xl space-y-5 p-4 sm:p-6"><Link to={`/p/${encodeURIComponent(handle)}`} className="text-sm text-ink-3">← @{handle}</Link>
    <ProductGallery images={item.photos} name={item.title} category={item.category} />
    <div><h1 className="text-2xl font-extrabold text-ink-1">{item.title}</h1><p className="mt-2 text-lg font-bold text-ink-1">{priceLine(item)}</p>
      <p className="mt-1 text-sm text-ink-3">{item.available ? `${item.quantity ?? ""} available` : "Not available right now"}</p>
      {item.description && <p className="mt-3 whitespace-pre-line text-sm text-ink-2">{item.description}</p>}</div>
    {item.available && <Link to={`/listing/${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-bold text-white">View and request · sign-in required</Link>}
    <p className="text-xs text-ink-3">Prices and availability are stated by the seller. A request is not payment or a confirmed order.</p>
  </main>;
}
