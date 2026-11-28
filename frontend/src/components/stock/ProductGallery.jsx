import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import Media from "@/components/ui/Media";
import { StockIllustration } from "@/components/stock/StockThumb";
import { cn } from "@/lib/utils";

/** Show every recorded photo; never silently substitute the cover for a missing file. */
export default function ProductGallery({ images = [], name = "Product", category, compact = false }) {
  const photos = Array.isArray(images) ? images.filter((src) => typeof src === "string" && src.trim()) : [];
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [images]);
  const current = Math.min(index, Math.max(photos.length - 1, 0));
  return <div className="space-y-2" aria-label={`${name} photos`}>
    <div className={cn("relative overflow-hidden rounded-2xl bg-surface-2", compact ? "aspect-[4/3]" : "aspect-[2/1]")}>
      <Media key={photos[current]} src={photos[current]} alt={`${name}, photo ${current + 1} of ${photos.length}`} className="h-full w-full object-contain" fallback={photos.length ? <div className="grid h-full place-items-center text-center text-xs text-ink-3"><div><ImageOff className="mx-auto mb-1" size={20} />Photo unavailable</div></div> : <StockIllustration item={{ name, category }} />} />
      {photos.length > 1 && <>
        <button type="button" aria-label="Previous photo" onClick={() => setIndex((current + photos.length - 1) % photos.length)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-surface-0/90 p-2 shadow"><ChevronLeft size={18} /></button>
        <button type="button" aria-label="Next photo" onClick={() => setIndex((current + 1) % photos.length)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-surface-0/90 p-2 shadow"><ChevronRight size={18} /></button>
        <span className="absolute bottom-2 right-2 rounded-full bg-ink-1/80 px-2 py-1 text-xs text-white">{current + 1} / {photos.length}</span>
      </>}
    </div>
    {photos.length > 1 && <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={`Choose ${name} photo`}>
      {photos.map((photo, i) => <button key={`${photo}-${i}`} type="button" onClick={() => setIndex(i)} aria-label={`Show photo ${i + 1}`} aria-pressed={i === current} className={cn("h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2", i === current ? "border-brand-600" : "border-transparent")}><Media src={photo} alt="" className="h-full w-full object-cover" fallback={<span className="grid h-full place-items-center bg-surface-2"><ImageOff size={16} /></span>} /></button>)}
    </div>}
  </div>;
}
