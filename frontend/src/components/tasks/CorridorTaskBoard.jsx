import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Briefcase, Camera, Clock3, Copy, Loader2, Plus, Send,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { corridorTaskAPI, fileAPI, apiError } from "@/lib/api";
import { mediaUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

/**
 * THE WORK BOARD inside the Inbox week.
 *
 * Every row answers three questions in one line: what the work is, where, and
 * what it pays. The one action is the next step the viewer can actually take.
 *
 * The bottom line is not a footnote. A handoff code, a timestamped photo and a
 * pasted M-Pesa note are structured evidence for the poster to judge; they are
 * not platform verification, and completing a task adds no standing credit.
 */

const TYPE_TONE = {
  DELIVERY_HANDOFF: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  ERRAND_PICKUP: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  DEAL_SPOT_CHECK: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  MERCHANT_ONBOARD: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  QR_DISTRIBUTION: "bg-orchid-50 text-orchid-700 dark:bg-orchid-500/15 dark:text-orchid-300",
  CUSTOMER_ACQUISITION: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
};

const STATUS_TONE = {
  OPEN: "border-edge-2 bg-surface-0 text-ink-2",
  CLAIMED: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
  PROOF_SUBMITTED: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
  COMPLETED: "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300",
  EXPIRED: "border-edge-2 bg-surface-2 text-ink-4",
  DISPUTED: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200",
};

const METHOD_LABEL = { SEND_MONEY: "Send Money", POCHI: "Pochi", TILL: "Buy Goods Till", PAYBILL: "Paybill" };

function dueLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

const ksh = (value) => `KSh ${Math.round(Number(value) || 0).toLocaleString("en-KE")}`;

function paymentText(tag) {
  if (!tag?.number) return "";
  const base = `${METHOD_LABEL[tag.method] || tag.method}: ${tag.number}`;
  return tag.method === "PAYBILL" && tag.account ? `${base} · Acc ${tag.account}` : base;
}

export default function CorridorTaskBoard({ data, onChanged, defaultRegion = "nairobi-metro", town = "" }) {
  const [busy, setBusy] = useState(null);
  const [proofFor, setProofFor] = useState(null);
  const [payment, setPayment] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const earnings = data?.earnings || null;
  const actionable = useMemo(
    () => (data?.tasks || []).filter((task) =>
      task.can_claim
      || task.can_submit_proof
      || task.can_approve
      // A completed row stays for the creator while the payment tag matters, and
      // for the worker as a receipt that the poster approved. Without this the
      // number disappears on the first reload after approving.
      || (task.status === "COMPLETED" && (task.is_creator || task.is_assignee)),
    ),
    [data],
  );

  async function act(task, kind) {
    setBusy(`${task.id}:${kind}`);
    try {
      if (kind === "claim") {
        await corridorTaskAPI.claim(task.id);
        toast.success("Task claimed — submit proof within 4 hours.");
      }
      if (kind === "approve") {
        const { data: result } = await corridorTaskAPI.approve(task.id);
        setPayment({ task, ...result });
        toast.success("Approved. Pay the worker directly.");
      }
      await onChanged?.();
    } catch (err) {
      toast.error(apiError(err, "That task could not be updated."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="work-board-heading" className="mt-3 space-y-2.5" data-testid="corridor-task-board">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Work-from-home</p>
          <h2 id="work-board-heading" className="mt-0.5 text-sm font-extrabold tracking-tight text-ink-1">
            Find work
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/routines" className="text-micro font-bold text-ink-3 hover:text-ink-1 hover:underline">
            Weekly routines
          </Link>
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setComposerOpen(true)}>
            Post a task
          </Button>
        </div>
      </div>

      {earnings && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 text-micro">
          <span className="font-bold text-ink-1">Earned {ksh(earnings.earned_kes)}</span>
          <span className="text-ink-3">Pending {ksh(earnings.pending_kes)}</span>
          <span className="text-ink-4">Fees recorded {ksh(earnings.platform_fees_recorded_kes)}</span>
        </div>
      )}

      {actionable.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge-2 bg-surface-0 px-3 py-4 text-center">
          <Briefcase size={18} className="mx-auto text-ink-4" aria-hidden="true" />
          <p className="mt-1.5 text-xs font-semibold text-ink-1">No work on your strip yet</p>
          <p className="mx-auto mt-1 max-w-sm text-2xs leading-relaxed text-ink-3">
            Post a delivery handoff, a shop check or a merchant onboarding and a
            neighbour who is already out can take it.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-edge-1 overflow-hidden rounded-xl border border-edge-1 bg-surface-0">
          {actionable.map((task) => {
            const claiming = busy === `${task.id}:claim`;
            const approving = busy === `${task.id}:approve`;
            return (
              <li key={task.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-3" data-testid="corridor-task-row">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn("rounded-md px-1.5 py-0.5 text-2xs font-bold", TYPE_TONE[task.task_type])}>
                      {task.type_label} • {task.town}
                    </span>
                    <span className={cn("rounded-md border px-1.5 py-0.5 text-2xs font-semibold", STATUS_TONE[task.status])}>
                      {task.status_label}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs font-bold text-ink-1">{task.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-2xs text-ink-4">
                    <Clock3 size={10} aria-hidden="true" />
                    {dueLabel(task.due_at)}
                    {task.claim_expires_at && task.status === "CLAIMED" && (
                      <span className="text-amber-700 dark:text-amber-300">
                        · releases {dueLabel(task.claim_expires_at)}
                      </span>
                    )}
                  </p>
                  {task.is_creator && task.handoff_code && task.status !== "COMPLETED" && (
                    <p className="mt-1 text-2xs text-ink-3">
                      Handoff code <span className="font-mono font-bold text-ink-1">{task.handoff_code}</span> — give it
                      to the recipient, not the worker.
                    </p>
                  )}
                </div>

                <div className="shrink-0 text-right sm:w-auto">
                  <p className="text-xs font-extrabold tabular-nums text-ink-1">
                    Earn {ksh(task.worker_payout_kes)}
                  </p>
                  {task.can_claim && (
                    <Button
                      size="sm"
                      className="mt-1.5 min-h-[44px] w-full sm:w-auto"
                      loading={claiming}
                      onClick={() => act(task, "claim")}
                    >
                      Claim task
                    </Button>
                  )}
                  {task.can_submit_proof && (
                    <Button size="sm" className="mt-1.5 min-h-[44px] w-full sm:w-auto" variant="secondary" onClick={() => setProofFor(task)}>
                      Submit proof
                    </Button>
                  )}
                  {task.can_approve && (
                    <Button
                      size="sm"
                      className="mt-1.5 min-h-[44px] w-full sm:w-auto"
                      loading={approving}
                      onClick={() => act(task, "approve")}
                    >
                      Approve &amp; pay
                    </Button>
                  )}
                  {task.status === "COMPLETED" && task.payment_tag?.number && (
                    <div className="mt-1.5">
                      <p className="max-w-[10rem] truncate text-2xs font-semibold text-brand-700 dark:text-brand-300">
                        Pay {paymentText(task.payment_tag)}
                      </p>
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={Copy}
                        className="min-h-[44px]"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(task.payment_tag.number);
                            toast.success("Number copied");
                          } catch {
                            toast.error("Copy is blocked in this browser.");
                          }
                        }}
                      >
                        Copy number
                      </Button>
                    </div>
                  )}
                  {task.status === "COMPLETED" && task.is_assignee && !task.payment_tag?.number && (
                    <p className="mt-1.5 max-w-[9rem] text-2xs leading-tight text-brand-700 dark:text-brand-300">
                      Approved — the poster pays you directly.
                    </p>
                  )}
                  {task.can_claim === false && task.claim_blocked_reason && !task.is_creator && !task.is_assignee && (
                    <p className="mt-1 max-w-[9rem] text-2xs leading-tight text-ink-4">{task.claim_blocked_reason}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {payment?.payment_tag?.number && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 dark:border-brand-500/30 dark:bg-brand-500/10" data-testid="corridor-payment-tag">
          <p className="text-xs font-bold text-brand-800 dark:text-brand-200">Pay {payment.task?.assignee?.name || "the worker"} directly</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-0 px-2 py-1.5 text-xs font-bold text-ink-1">
              {paymentText(payment.payment_tag)}
            </code>
            <Button
              size="sm"
              variant="secondary"
              icon={Copy}
              className="min-h-[44px]"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(payment.payment_tag.number);
                  toast.success("Number copied");
                } catch {
                  toast.error("Copy is blocked in this browser.");
                }
              }}
            >
              Copy
            </Button>
          </div>
          <p className="mt-1.5 text-2xs leading-relaxed text-brand-800/80 dark:text-brand-200/80">
            {payment.payment_instruction || "The platform never holds this money."}
          </p>
        </div>
      )}

      <p className="px-1 text-2xs leading-relaxed text-ink-4">
        Completed tasks add no standing credit. Photographs, handoff codes and
        pasted M-Pesa text are signals, not platform verification.
      </p>

      <ProofSheet
        task={proofFor}
        onClose={() => setProofFor(null)}
        onSaved={async () => {
          setProofFor(null);
          await onChanged?.();
        }}
      />
      <TaskComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        defaultRegion={defaultRegion}
        town={town}
        onCreated={async () => {
          setComposerOpen(false);
          await onChanged?.();
        }}
      />
    </section>
  );
}

function ProofSheet({ task, onClose, onSaved }) {
  const [handoff, setHandoff] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState("SEND_MONEY");
  const [number, setNumber] = useState("");
  const [account, setAccount] = useState("");
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    try {
      const { data } = await fileAPI.upload(file);
      setPhoto(data.url);
      toast.success("Photo attached");
    } catch (err) {
      toast.error(apiError(err, "That photo could not be uploaded."));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!number.trim()) return toast.error("Add the M-Pesa number the poster should pay.");
    setSaving(true);
    try {
      await corridorTaskAPI.submitProof(task.id, {
        handoff_code: handoff.trim() || null,
        photo_url: photo || null,
        note: note.trim() || null,
        payout_tag: { method, number: number.trim(), account: account.trim() || null },
      });
      toast.success("Proof sent. The poster decides and pays you directly.");
      await onSaved?.();
    } catch (err) {
      toast.error(apiError(err, "That proof could not be submitted."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={Boolean(task)} onClose={onClose} title="Submit proof" description={task?.title} size="sm">
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-ink-2">
          Handoff code (from the recipient)
          <input
            className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-3 py-2 text-sm"
            placeholder="HO-XXX"
            value={handoff}
            onChange={(event) => setHandoff(event.target.value.toUpperCase())}
          />
        </label>
        <label className="block text-xs font-semibold text-ink-2">
          What you saw or handed over
          <textarea
            className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-3 py-2 text-sm"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-edge-2 px-3 py-2 text-xs font-semibold text-ink-2">
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          {photo ? "Photo attached" : "Add a timestamped photo"}
          <input type="file" accept="image/*" className="sr-only" onChange={(event) => upload(event.target.files?.[0])} />
        </label>
        {photo && <img src={mediaUrl(photo)} alt="" className="h-24 w-full rounded-lg object-cover" />}

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-2xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Your M-Pesa details are shown only to the poster after they approve. The
          platform does not hold or move this money.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-semibold text-ink-2">
            Method
            <select
              className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              <option value="SEND_MONEY">Send Money</option>
              <option value="POCHI">Pochi</option>
              <option value="TILL">Till</option>
              <option value="PAYBILL">Paybill</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-ink-2">
            Number
            <input
              className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm"
              inputMode="tel"
              placeholder="07XX XXX XXX"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
          </label>
        </div>
        {method === "PAYBILL" && (
          <label className="block text-xs font-semibold text-ink-2">
            Account
            <input
              className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
            />
          </label>
        )}
        <Button fullWidth size="lg" icon={Send} loading={saving} onClick={submit} disabled={uploading}>
          Send proof
        </Button>
      </div>
    </Modal>
  );
}

function TaskComposer({ open, onClose, onCreated, defaultRegion, town }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    task_type: "DELIVERY_HANDOFF",
    title: "",
    instructions: "",
    region_slug: defaultRegion,
    town: town || "",
    scheduled_date: today,
    due_time: "18:00",
    worker_payout_kes: "250",
    min_standing_level: "2",
  });
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function save() {
    setSaving(true);
    try {
      const due = new Date(`${form.scheduled_date}T${form.due_time || "18:00"}:00`);
      await corridorTaskAPI.create({
        task_type: form.task_type,
        title: form.title.trim(),
        instructions: form.instructions.trim(),
        region_slug: form.region_slug.trim().toLowerCase(),
        town: form.town.trim(),
        scheduled_date: form.scheduled_date,
        due_at: due.toISOString(),
        worker_payout_kes: Number(form.worker_payout_kes),
        min_standing_level: Number(form.min_standing_level),
      });
      toast.success("Task posted to the week.");
      await onCreated?.();
    } catch (err) {
      toast.error(apiError(err, "That task could not be posted."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Post a local task" description="Pay a neighbour directly over M-Pesa." size="sm">
      <div className="space-y-2.5">
        <label className="block text-xs font-semibold text-ink-2">
          Type
          <select className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm" value={form.task_type} onChange={set("task_type")}>
            <option value="DELIVERY_HANDOFF">Delivery handoff</option>
            <option value="DEAL_SPOT_CHECK">Shop check</option>
            <option value="MERCHANT_ONBOARD">Merchant onboarding</option>
            <option value="ERRAND_PICKUP">Errand pickup</option>
            <option value="QR_DISTRIBUTION">QR distribution</option>
            <option value="CUSTOMER_ACQUISITION">Customer acquisition</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-ink-2">
          Title
          <input className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm" value={form.title} onChange={set("title")} placeholder="Deliver a parcel to Kondele" />
        </label>
        <label className="block text-xs font-semibold text-ink-2">
          Instructions
          <textarea className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm" rows={3} value={form.instructions} onChange={set("instructions")} placeholder="Where to collect, who to ask for, what to check." />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-semibold text-ink-2">
            Region
            <input className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm" value={form.region_slug} onChange={set("region_slug")} />
          </label>
          <label className="block text-xs font-semibold text-ink-2">
            Town
            <input className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm" value={form.town} onChange={set("town")} placeholder="Kondele" />
          </label>
          <label className="block text-xs font-semibold text-ink-2">
            Day
            <input type="date" className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm" value={form.scheduled_date} onChange={set("scheduled_date")} />
          </label>
          <label className="block text-xs font-semibold text-ink-2">
            Due by
            <input type="time" className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm" value={form.due_time} onChange={set("due_time")} />
          </label>
          <label className="block text-xs font-semibold text-ink-2">
            Pay (KSh)
            <input type="number" min="20" className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm" value={form.worker_payout_kes} onChange={set("worker_payout_kes")} />
          </label>
          <label className="block text-xs font-semibold text-ink-2">
            Min level
            <select className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm" value={form.min_standing_level} onChange={set("min_standing_level")}>
              {[1, 2, 3, 4].map((level) => <option key={level} value={level}>Level {level}+</option>)}
            </select>
          </label>
        </div>
        <p className="text-2xs leading-relaxed text-ink-4">
          A 5–8% platform fee is recorded on your ledger. The worker&apos;s payout is
          paid by you directly; the platform holds no money.
        </p>
        <Button fullWidth size="lg" loading={saving} onClick={save} disabled={!form.title.trim() || !form.town.trim() || form.instructions.trim().length < 10}>
          Post task
        </Button>
      </div>
    </Modal>
  );
}
