import { useState } from "react";
import ReceiptsView from "@/components/receipts/ReceiptsView";
import ReceiptScanner from "@/components/receipts/ReceiptScanner";
import { useReceiptStore } from "@/stores/receiptStore";
import { useAuthStore } from "@/stores/authStore";
import { regionFromPlace } from "@/config/regions";

/**
 * `/receipts` — the ledger behind the home-feed scanner.
 *
 * Local-first: the rows live on this device until the server has a receipts
 * endpoint. That is a deliberate MVP boundary, not a claim of sync. The store
 * is the same one the home card and the scanner write to, so a scan appears in
 * all three places immediately.
 */
export default function ReceiptLedgerPage() {
  const receipts = useReceiptStore((s) => s.receipts);
  const points = useReceiptStore((s) => s.points);
  const vendor = useAuthStore((s) => s.vendor);
  const [open, setOpen] = useState(false);

  const region = regionFromPlace(vendor?.physical_location || "") || null;

  return (
    <>
      <ReceiptsView
        receipts={receipts}
        points={points}
        region={region}
        onScan={() => setOpen(true)}
      />
      <ReceiptScanner open={open} onClose={() => setOpen(false)} />
    </>
  );
}
