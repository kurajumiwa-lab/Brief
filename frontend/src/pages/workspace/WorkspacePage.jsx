import { useEffect, useMemo, useState } from "react";
import WorkspaceView from "@/components/workspace/WorkspaceView";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useStockStore, needsMyAction } from "@/stores/stockStore";
import { useSetupProgress } from "@/components/onboarding/useSetupProgress";
import { analyticsAPI } from "@/lib/api";
import { receiptsAPI } from "@/lib/receiptsApi";
import { rankFor } from "@/config/identity";

/**
 * THE WORKSPACE CONTAINER.
 *
 * Four readings, all of them already made by screens the business has open:
 *
 *   analytics   what settled, what is outstanding, who you trade with
 *   receipts    the trade proofs a receipt supports
 *   stock       the shelf, and the movements waiting on you
 *   setup       the six steps that make a business findable
 *
 * Every reading degrades to null rather than throwing, and a null reading is
 * shown as "—" rather than as a zero. "We do not know" and "there is none"
 * are different answers, and a business owner can tell the difference.
 */
export default function WorkspacePage() {
  const vendor = useAuthStore((s) => s.vendor);
  const identity = useIdentityStore();
  const loadIdentity = useIdentityStore((s) => s.load);
  const mine = useStockStore((s) => s.mine);
  const movements = useStockStore((s) => s.movements);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const fetchMovements = useStockStore((s) => s.fetchMovements);
  const setup = useSetupProgress();

  const [overview, setOverview] = useState(null);
  const [proofs, setProofs] = useState(null);

  useEffect(() => {
    loadIdentity();
    fetchMine().catch(() => {});
    fetchMovements().catch(() => {});
  }, [loadIdentity, fetchMine, fetchMovements]);

  useEffect(() => {
    let live = true;
    analyticsAPI
      .overview(90)
      .then(({ data }) => {
        if (live) setOverview(data?.summary || null);
      })
      .catch(() => {
        if (live) setOverview(null);
      });
    receiptsAPI
      .tradeProofs()
      .then(({ data }) => {
        if (live) setProofs(Array.isArray(data) ? data : data?.items || []);
      })
      .catch(() => {
        if (live) setProofs(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const rank = rankFor({ vendor, identity });

  const stats = useMemo(() => {
    const summary = overview;
    return {
      recorded: summary ? summary.movements_settled : null,
      outstanding: summary ? summary.open_movements_total : null,
      confirmed: proofs ? proofs.length : null,
      people: summary ? summary.counterparties : null,
    };
  }, [overview, proofs]);

  const pending = useMemo(() => {
    const rows = [];
    const openSteps = (setup.steps || []).filter((step) => !step.done);
    if (openSteps.length) {
      rows.push({
        id: "setup",
        title: `${openSteps.length} step${openSteps.length === 1 ? "" : "s"} left on your shop`,
        body: openSteps[0].title,
        to: openSteps[0].to,
      });
    }
    const waiting = movements.filter(needsMyAction);
    if (waiting.length) {
      rows.push({
        id: "movements",
        title: `${waiting.length} movement${waiting.length === 1 ? "" : "s"} waiting on you`,
        body: "Someone is waiting for the next step in a trade you agreed.",
        to: "/orders",
      });
    }
    const openProofs = (proofs || []).filter((p) => p.status === "pending");
    if (openProofs.length) {
      rows.push({
        id: "proofs",
        title: `${openProofs.length} trade confirmation${openProofs.length === 1 ? "" : "s"} to confirm`,
        body: "A receipt supports this trade. Confirming it puts it on both records.",
        to: "/trades/proofs",
      });
    }
    return rows;
  }, [setup.steps, movements, proofs]);

  const records = useMemo(
    () => [
      {
        label: "Receipts",
        value: vendor?.movements_completed ?? "—",
        hint: "Trades you have completed and that are on the record.",
        to: "/payments",
        action: "Open the receipts",
      },
    ],
    [vendor],
  );

  return (
    <WorkspaceView
      vendor={vendor}
      rank={rank}
      stats={stats}
      pending={pending}
      listings={mine.length}
      records={records}
    />
  );
}
