import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useUIStore = create(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      confirm: null, // { title, message, confirmLabel, danger, resolve }

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileSidebar: (open) => set({ mobileSidebarOpen: open }),

      /** Promise-based confirm: `if (await askConfirm({...})) …` */
      askConfirm: (opts) =>
        new Promise((resolve) => {
          set({ confirm: { confirmLabel: "Confirm", ...opts, resolve } });
        }),
      resolveConfirm: (answer) => {
        get().confirm?.resolve?.(answer);
        set({ confirm: null });
      },
    }),
    { name: "brief-ui", partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }) }
  )
);
