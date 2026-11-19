import { useCallback, useEffect, useState } from "react";
import { Globe2, Lock, Plus, Trash2, Users } from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Select from "@/components/ui/Select";
import { officeAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";

const PRIVACY = [
  { value: "vault_private", label: "My vault — only me" },
  { value: "family_shared", label: "Home office — active members" },
  { value: "public_showcase", label: "Public Page — anyone" },
];

const PRIVACY_META = {
  vault_private: { label: "Vault", icon: Lock, variant: "gray" },
  family_shared: { label: "Home office", icon: Users, variant: "blue" },
  public_showcase: { label: "Public", icon: Globe2, variant: "brand" },
};

const emptyDraft = () => ({ label: "", url: "", handle: "", privacy: "vault_private", note: "" });

/**
 * Three-zone saved items. The default is the vault. The API enforces the same
 * rule, so a family member's screen cannot reveal another member's vault even
 * if this component is wrong.
 */
export default function SavedItemsPanel({ officeId, role }) {
  const [data, setData] = useState(null);
  const [scope, setScope] = useState("all");
  const [draft, setDraft] = useState(emptyDraft);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!officeId || !officeAPI.saved) return;
    try {
      const { data: body } = await officeAPI.saved(officeId, scope);
      setData(body);
    } catch (error) {
      toast.error(apiError(error, "Saved items could not be loaded."));
    }
  }, [officeId, scope]);

  useEffect(() => { load(); }, [load]);

  if (!officeAPI.saved) return null;

  const save = async () => {
    if (!draft.label.trim() && !draft.handle.trim()) {
      toast.error("Give this saved item a name or a business handle.");
      return;
    }
    setBusy(true);
    try {
      const { data: body } = await officeAPI.saveItem(officeId, {
        target_kind: draft.handle.trim() ? "vendor" : "external",
        target_handle: draft.handle.trim().replace(/^@/, "") || null,
        target_label: draft.label.trim(),
        target_url: draft.url.trim() || null,
        privacy: draft.privacy,
        private_note: draft.note.trim() || null,
      });
      toast.success(body.created ? "Saved" : "Saved item updated");
      setDraft(emptyDraft());
      setAdding(false);
      await load();
    } catch (error) {
      toast.error(apiError(error, "That could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const changePrivacy = async (item, privacy) => {
    try {
      await officeAPI.updateSaved(officeId, item.id, { privacy });
      toast.success("Privacy changed");
      await load();
    } catch (error) {
      toast.error(apiError(error, "Privacy could not be changed."));
    }
  };

  const remove = async (item) => {
    try {
      await officeAPI.deleteSaved(officeId, item.id);
      toast.success("Removed");
      await load();
    } catch (error) {
      toast.error(apiError(error, "That could not be removed."));
    }
  };

  const counts = data?.counts || {};
  const visible = (data?.items || []).filter((item) => {
    if (scope === "all") return true;
    if (scope === "mine") return item.saved_by_me;
    if (scope === "vault") return item.saved_by_me && item.privacy === "vault_private";
    if (scope === "shared") return item.privacy !== "vault_private";
    if (scope === "public") return item.privacy === "public_showcase";
    return true;
  });

  return (
    <Card className="space-y-3" data-testid="saved-items-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-1">
            <Lock size={14} aria-hidden="true" /> Saved people & things
          </h2>
          <p className="text-micro text-ink-4">
            The vault is private. Home office items are visible to active members. Only public items reach your Page.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding((v) => !v)}>
          Save something
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[
          ["all", `All ${counts.mine ?? 0}`],
          ["vault", `Vault ${counts.vault ?? 0}`],
          ["shared", `Shared ${counts.shared ?? 0}`],
          ["public", `Public ${counts.public ?? 0}`],
        ].map(([value, label]) => (
          <button key={value} type="button" onClick={() => setScope(value)}
                  className={`rounded-full border px-2.5 py-1 text-2xs font-semibold ${
                    scope === value ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                      : "border-edge-2 text-ink-3 hover:text-ink-1"
                  }`}>
            {label}
          </button>
        ))}
      </div>

      {adding && (
        <div className="space-y-2 rounded-xl border border-edge-1 bg-surface-0 p-3">
          <div className="grid sm:grid-cols-2 gap-2">
            <Input label="Name" value={draft.label} maxLength={160}
                   onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                   placeholder="Gas delivery, Kondele" />
            <Input label="Business handle (optional)" value={draft.handle} maxLength={100}
                   onChange={(e) => setDraft({ ...draft, handle: e.target.value })}
                   placeholder="@trusted_fundi" />
          </div>
          <Input label="Link (optional)" value={draft.url} maxLength={500}
                 onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                 placeholder="https://... or /p/handle" />
          <Select label="Who can see this?" value={draft.privacy} onChange={(e) => setDraft({ ...draft, privacy: e.target.value })}
                  options={PRIVACY.filter((p) => p.value !== "public_showcase" || role === "owner")} />
          <Textarea label="Private note" rows={2} value={draft.note} maxLength={2000}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                    placeholder="Only you see this." />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} loading={busy}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft(emptyDraft()); }}>Cancel</Button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing here yet. Save a trusted contact or a private item.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => {
            const meta = PRIVACY_META[item.privacy] || PRIVACY_META.vault_private;
            const Icon = meta.icon;
            return (
              <li key={item.id} className="rounded-xl border border-edge-1 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <a href={item.target_url || "#"} target={item.target_url?.startsWith("http") ? "_blank" : undefined}
                       rel="noreferrer" className="text-sm font-semibold text-ink-1 hover:text-brand-600">
                      {item.target_label}
                    </a>
                    <p className="text-2xs text-ink-4 mt-0.5">
                      Saved by {item.saved_by}{item.private_note ? ` · ${item.private_note}` : ""}
                    </p>
                  </div>
                  <Badge variant={meta.variant} size="xs"><Icon size={10} /> {meta.label}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {item.can_edit && (
                    <select value={item.privacy} onChange={(e) => changePrivacy(item, e.target.value)}
                            className="rounded-lg border border-edge-2 bg-surface-0 px-2 py-1 text-2xs text-ink-2">
                      {PRIVACY.filter((p) => p.value !== "public_showcase" || role === "owner").map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  )}
                  {item.can_remove && (
                    <Button size="xs" variant="dangerGhost" icon={Trash2} onClick={() => remove(item)}>
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
