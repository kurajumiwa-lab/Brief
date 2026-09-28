import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isTopDialog, useDialogFocus } from './useDialogFocus';

// ---------------------------------------------------------------------------
// SHEET — the one lower-segment primitive.
//
// A tile is a selection. Selection is not a scroll: the panel it opens must
// not appear under the grid the operator just tapped. This sheet rises from
// the lower segment, the grid stays where it is (scrollY is not written),
// and the body of the panel scrolls inside the sheet when it is taller than
// the first detent.
//
// Detents, derived from the panel's own height, never padded:
//   fit   — the panel is shorter than ~56vh; the sheet is as tall as the
//           panel. No dead space.
//   half  — first detent, ~56vh, with the body scrolling inside. Used when
//           the panel does not fit.
//   full  — only after the operator drags up, and only when half was
//           already required.
//
// Dismiss: scrim tap, drag-down past the threshold, Escape, hardware back
// (popstate). No Back button — that is OverlayScreen, which covers the
// groups. This component does not.
//
// Nothing here is remembered across opens. Detent and drag offset reset
// when `open` becomes false.
// ---------------------------------------------------------------------------

export type SheetDetent = 'fit' | 'half' | 'full';

const HALF = 0.56;
const FULL = 0.92;
const DRAG_CLOSE_PX = 80;
const DRAG_EXPAND_PX = 40;

export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** When false, the visible title is omitted (the listing detail already
      prints its own). aria-label still uses `title`. */
  showTitle?: boolean;
  testId?: string;
}

export function Sheet({
  open,
  title,
  onClose,
  children,
  showTitle = true,
  testId
}: SheetProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, panelRef, () => onCloseRef.current());
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [detent, setDetent] = useState<SheetDetent>('fit');

  const close = () => onCloseRef.current();

  const measure = () => {
    const body = bodyRef.current;
    const vh = typeof window !== 'undefined' ? window.innerHeight || 800 : 800;
    const raw = body ? body.scrollHeight : 0;
    if (raw <= vh * HALF) {
      setDetent('fit');
      return;
    }
    setDetent(expanded ? 'full' : 'half');
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, children, expanded, title, showTitle]);

  useEffect(() => {
    if (!open) {
      setExpanded(false);
      setOffset(0);
      dragging.current = false;
      return;
    }
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = 'hidden';

    const onPop = () => {
      if (isTopDialog(panelRef.current)) close();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      html.style.overflow = prevOverflow;
      window.removeEventListener('popstate', onPop);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMove = (clientY: number) => {
      if (!dragging.current) return;
      const dy = clientY - startY.current;
      if (dy > 0) setOffset(dy);
      else {
        setOffset(0);
        if (-dy > DRAG_EXPAND_PX) setExpanded(true);
      }
    };
    const onUp = (clientY: number) => {
      if (!dragging.current) return;
      dragging.current = false;
      const dy = clientY - startY.current;
      setOffset(0);
      if (dy > DRAG_CLOSE_PX) close();
      else if (dy < -DRAG_EXPAND_PX) setExpanded(true);
    };
    const move = (e: MouseEvent) => onMove(e.clientY);
    const up = (e: MouseEvent) => onUp(e.clientY);
    const pmove = (e: PointerEvent) => onMove(e.clientY);
    const pup = (e: PointerEvent) => onUp(e.clientY);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('pointermove', pmove);
    window.addEventListener('pointerup', pup);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('pointermove', pmove);
      window.removeEventListener('pointerup', pup);
    };
  }, [open]);

  if (!open) return null;

  const startDrag = (clientY: number) => {
    dragging.current = true;
    startY.current = clientY;
  };

  const vhHeight =
    detent === 'full' ? `${FULL * 100}vh` : detent === 'half' ? `${HALF * 100}vh` : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId ?? 'sheet'}
      className="fixed inset-0 z-[60] flex items-end justify-center"
    >
      <button
        type="button"
        data-testid="sheet-scrim"
        aria-label="Dismiss"
        onClick={close}
        className="absolute inset-0 cursor-pointer"
        style={{ background: 'rgba(10, 14, 20, 0.45)' }}
      />
      <div
        data-testid="sheet-panel"
        ref={panelRef}
        tabIndex={-1}
        data-detent={detent}
        className="relative w-full max-w-lg flex flex-col rounded-t-3xl brief-sheet-up"
        style={{
          background: 'var(--color-paper)',
          boxShadow: 'var(--lift-4)',
          height: vhHeight,
          maxHeight: detent === 'fit' ? `${HALF * 100}vh` : vhHeight,
          transform: offset ? `translateY(${offset}px)` : undefined
        }}
      >
        <div
          data-testid="sheet-handle"
          role="presentation"
          onMouseDown={(e) => startDrag(e.clientY)}
          onPointerDown={(e) => startDrag(e.clientY)}
          className="w-full h-11 flex items-center justify-center shrink-0 cursor-grab"
          style={{ touchAction: 'none' }}
        >
          <span
            className="w-10 h-1 rounded-full"
            style={{ background: 'var(--brief-line)' }}
          />
        </div>
        {showTitle && title ? (
          <h2
            data-testid="sheet-title"
            className="px-5 pb-2 text-[16px] font-extrabold leading-tight shrink-0"
            style={{ color: 'var(--color-text)' }}
          >
            {title}
          </h2>
        ) : (
          <span data-testid="sheet-title" className="sr-only">{title}</span>
        )}
        <div
          ref={bodyRef}
          data-testid="sheet-body"
          className="px-5 pb-6 flex-1 min-h-0 overflow-y-auto"
          style={{ overscrollBehavior: 'contain' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default Sheet;
