import { useLayoutEffect, useRef, type RefObject } from 'react';

const stack: HTMLElement[] = [];
export function isTopDialog(node: HTMLElement | null): boolean {
  return !!node && stack[stack.length - 1] === node;
}
const SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Shared focus lifecycle for the sheet and navigation dialog. Top dialog
 * alone handles Tab/Escape; a nested dialog never closes its parent. */
export function useDialogFocus(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const node = panel.current;
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(node);
    const focusables = () => [...node.querySelectorAll<HTMLElement>(SELECTOR)]
      .filter(el => !el.closest('[hidden], [inert], [aria-hidden="true"]'));
    (focusables()[0] ?? node).focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== node) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const items = focusables();
        if (!items.length) { event.preventDefault(); node.focus(); return; }
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    // Window also receives hardware/embedded-webview keys, including tests
    // that dispatch directly there. Capture handles ordinary DOM key bubbling.
    window.addEventListener('keydown', keydown, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      const index = stack.lastIndexOf(node);
      if (index !== -1) stack.splice(index, 1);
      if (invoker?.isConnected) invoker.focus({ preventScroll: true });
      else if (stack.length) stack[stack.length - 1].focus({ preventScroll: true });
    };
  }, [open, panel]);
}
