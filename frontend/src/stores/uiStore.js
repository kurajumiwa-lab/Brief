import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useUIStore = create(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      confirm: null, // { title, message, confirmLabel, danger, resolve }

      // v3: light is the default marketplace theme; dark is a full peer.
      // index.html applies the class before paint, so this only has to mirror
      // what is already on <html> and let the user flip it.
      theme: typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light",

      setTheme: (theme) => {
        if (typeof document !== "undefined") {
          document.documentElement.classList.toggle("dark", theme === "dark");
          try {
            localStorage.setItem("brief-theme", theme);
          } catch {
            /* private mode — the class is still applied for this session */
          }
        }
        set({ theme });
      },
      toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),

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
