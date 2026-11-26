/**
 * A global confirmation is rendered in a portal, so keyboard handlers in the
 * page cannot rely on React's tree to know it is open. The dialog marks its
 * content; this one DOM check lets drawers and disclosure menus leave Escape
 * to the confirmation instead of closing themselves underneath it.
 */
export const hasOpenConfirmDialog = () =>
  typeof document !== "undefined" && Boolean(document.querySelector("[data-confirm-dialog]"));
