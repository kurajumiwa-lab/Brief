import { Toaster } from "react-hot-toast";
export { default as toast } from "react-hot-toast";

/**
 * Feedback after every consequential action. Toasts read the live theme
 * tokens, so they are legible in both modes without a second config.
 */
export function ToastProvider() {
  return (
    <Toaster
      position="bottom-center"
      gutter={10}
      containerStyle={{ bottom: "calc(env(safe-area-inset-bottom) + 72px)" }}
      toastOptions={{
        duration: 3500,
        style: {
          background: "rgb(var(--surface-inverse))",
          color: "rgb(var(--ink-inverse))",
          fontSize: "13px",
          fontWeight: 500,
          borderRadius: "12px",
          padding: "10px 14px",
          maxWidth: "420px",
          boxShadow: "var(--shadow-lg)",
        },
        success: { iconTheme: { primary: "rgb(var(--brand-500))", secondary: "rgb(var(--surface-inverse))" } },
        error: { iconTheme: { primary: "#ef4444", secondary: "rgb(var(--surface-inverse))" }, duration: 5500 },
      }}
    />
  );
}
