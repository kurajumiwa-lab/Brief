import { AlertTriangle } from "lucide-react";
import Modal from "./Modal";
import Button from "./Button";
import { useUIStore } from "@/stores/uiStore";

/** Rendered once in the Shell; driven by `useUIStore().askConfirm(...)`. */
export default function ConfirmDialog() {
  const confirm = useUIStore((s) => s.confirm);
  const resolve = useUIStore((s) => s.resolveConfirm);
  return (
    <Modal
      open={!!confirm}
      onClose={() => resolve(false)}
      size="sm"
      title={confirm?.title || "Are you sure?"}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => resolve(false)}>
            Cancel
          </Button>
          <Button variant={confirm?.danger ? "danger" : "primary"} size="sm" onClick={() => resolve(true)} autoFocus>
            {confirm?.confirmLabel || "Confirm"}
          </Button>
        </>
      }
    >
      <div className="flex gap-3 text-sm text-ink-3">
        {confirm?.danger && <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />}
        <p>{confirm?.message}</p>
      </div>
    </Modal>
  );
}

export const useConfirm = () => useUIStore((s) => s.askConfirm);
