import { Toaster } from "react-hot-toast";
export { default as toast } from "react-hot-toast";

export function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      gutter={8}
      toastOptions={{
        duration: 3500,
        style: {
          background: "#1f1f23",
          color: "#fafafa",
          border: "1px solid #3f3f46",
          fontSize: "13px",
          borderRadius: "10px",
          padding: "10px 14px",
          maxWidth: "380px",
        },
        success: { iconTheme: { primary: "#F59E0B", secondary: "#09090b" } },
        error: { iconTheme: { primary: "#f87171", secondary: "#09090b" }, duration: 5000 },
      }}
    />
  );
}
