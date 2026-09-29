import { useState } from "react";
import { UserPlus, UserCheck, UserMinus } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { useVendorStore } from "@/stores/vendorStore";
import { useAuthStore } from "@/stores/authStore";
import { apiError } from "@/lib/api";

/** Connect / disconnect toggle for any vendor object (accepts `id` or `vendor_id`). */
export default function ConnectionButton({ vendor, size = "sm", onChange, className, fullWidth }) {
  const me = useAuthStore((s) => s.vendor);
  const { connect, disconnect } = useVendorStore();
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const id = vendor?.id || vendor?.vendor_id;
  const connected = !!vendor?.connected;

  if (!id || id === me?.id) return null;

  const toggle = async (e) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    setBusy(true);
    try {
      if (connected) {
        await disconnect(id);
        toast(`Disconnected from @${vendor.vendor_handle}`);
      } else {
        await connect(id);
        toast.success(`Connected with @${vendor.vendor_handle}`);
      }
      onChange?.(!connected);
    } catch (err) {
      toast.error(apiError(err, "Connection failed"));
    } finally {
      setBusy(false);
    }
  };

  if (connected) {
    return (
      <Button
        size={size}
        variant="outline"
        loading={busy}
        onClick={toggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        icon={hover ? UserMinus : UserCheck}
        className={className}
        fullWidth={fullWidth}
      >
        {hover ? "Disconnect" : "Connected"}
      </Button>
    );
  }
  return (
    <Button size={size} variant="primary" loading={busy} onClick={toggle} icon={UserPlus} className={className} fullWidth={fullWidth}>
      Connect
    </Button>
  );
}
