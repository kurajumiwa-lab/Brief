import { useState } from "react";
import ReceiptsView from "@/components/receipts/ReceiptsView";
import VoucherWallet from "@/components/receipts/VoucherWallet";
import ReceiptScanner from "@/components/receipts/ReceiptScanner";
import { useReceiptStore } from "@/stores/receiptStore";
import { useReceiptSync } from "@/hooks/useReceiptSync";
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
  const { syncing, error } = useReceiptSync();

  const region = regionFromPlace(vendor?.physical_location || "") || null;
  const pending = receipts.filter((receipt) => receipt.sync && receipt.sync !== "synced").length;

  return (
    <>
      <ReceiptsView
        receipts={receipts}
        points={points}
        region={region}
        sync={{ syncing, error, pending }}
        onScan={() => setOpen(true)}
      />
      <div className="mx-auto mt-5 w-full max-w-2xl">
        <VoucherWallet region={region} />
      </div>
      <ReceiptScanner open={open} onClose={() => setOpen(false)} />
    </>
  );
}
