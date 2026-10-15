import { useCallback, useEffect, useState } from "react";
import {
  Building2, Lock, MapPin, ShieldCheck, Smartphone, Trash2, UserPlus, Users,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { enterpriseAPI, apiError } from "@/lib/api";
import { num } from "@/lib/formatters";

const kes = (n) => (n ? `KSh ${num(n)}/mo` : "Free");
const MANAGE = ["owner", "admin"];
const FIELD = ["owner", "admin", "field_officer"];

export default function EnterprisePage() {
  const [plans, setPlans] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [members, setMembers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [commands, setCommands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", org_type: "trade_association", region: "Kisumu", description: "", is_public: false });
  const [memberForm, setMemberForm] = useState({ vendor_handle: "", role: "member" });
  const [deviceForm, setDeviceForm] = useState({ label: "", enrolment_mode: "work_profile", assigned_handle: "", policy_name: "" });
  const [commandDraft, setCommandDraft] = useState(null); // {deviceId, command_type, reason}
  const [bindForm, setBindForm] = useState({ android_enterprise_id: "", emm_provider: "" });
  const [busy, setBusy] = useState(false);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); setMembers([]); setDevices([]); setCommands([]); return; }
    const [dash, mem, dev, cmd] = await Promise.all([
      enterpriseAPI.dashboard(id), enterpriseAPI.members(id),
      enterpriseAPI.devices(id), enterpriseAPI.commands(id),
    ]);
    setDetail(dash.data);
    setMembers(mem.data.members || []);
    setDevices(dev.data.devices || []);
    setCommands(cmd.data || []);
    setBindForm({
      android_enterprise_id: dash.data.android?.android_enterprise_id || "",
      emm_provider: dash.data.android?.emm_provider === "none" ? "" : dash.data.android?.emm_provider || "",
    });
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const [p, mine, pub] = await Promise.all([
        enterpriseAPI.plans(), enterpriseAPI.myWorkspaces(), enterpriseAPI.discover(),
      ]);
      setPlans(p.data);
      setWorkspaces(mine.data || []);
      setDiscover(pub.data || []);
      setSelectedId((prev) => prev || mine.data?.[0]?.id || "");
    } catch (err) {
      setError(apiError(err, "Could not load enterprise workspaces"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!selectedId) return;
    loadDetail(selectedId).catch((err) => toast.error(apiError(err, "Could not load this workspace")));
  }, [selectedId, loadDetail]);

  const myRole = detail?.my_role || workspaces.find((w) => w.id === selectedId)?.my_role;
  const canManage = MANAGE.includes(myRole);
  const canField = FIELD.includes(myRole);

  const act = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await load();
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      toast.error(apiError(err, "That did not work"));
    } finally {
      setBusy(false);
    }
  };

  const createWorkspace = (e) => {
    e.preventDefault();
    act(async () => {
      const res = await enterpriseAPI.createWorkspace(form);
      setSelectedId(res.data.id);
      setForm({ name: "", org_type: "trade_association", region: "Kisumu", description: "", is_public: false });
    }, "Workspace created — you are its owner");
  };

  const issueCommand = (e) => {
    e.preventDefault();
    if (!commandDraft) return;
    act(
      () => enterpriseAPI.requestCommand(selectedId, commandDraft.deviceId, {
        command_type: commandDraft.command_type, reason: commandDraft.reason,
      }).then((res) => {
        if (!res.data.dispatched) {
          toast.success("Recorded for audit — not sent to the device (no EMM bound)");
        }
        setCommandDraft(null);
      }),
      "Command recorded",
    );
  };

  if (loading) return <PageSpinner label="Loading enterprise workspaces…" />;
  if (error) return <EmptyState icon={Building2} tone="brand" title="Workspaces could not be loaded" description={error} />;

  const dash = detail?.dashboard;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Business", to: "/me" }, { label: "Enterprise" }]} />
      <header>
        <h1 className="text-2xl font-bold text-ink-1 tracking-tight">Enterprise workspaces</h1>
        <p className="text-sm text-ink-3 mt-1 max-w-2xl">
          The paid, private side of Brief_ — for associations, cooperatives, employers and county
          programmes. Members stay discoverable on the public marketplace; the workspace adds the
          member register, field officers and managed Android phones. No separate app.
        </p>
      </header>

      {/* ── Create ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 space-y-3">
        <h2 className="text-sm font-bold text-ink-1 flex items-center gap-2"><Building2 size={16} /> Start a workspace</h2>
        <form onSubmit={createWorkspace} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Organisation name" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kisumu Retail Traders Association" />
          <Select label="Organisation type" value={form.org_type}
            onChange={(e) => setForm({ ...form, org_type: e.target.value })}
            options={[
              { value: "trade_association", label: "Trade association" },
              { value: "cooperative", label: "Cooperative" },
              { value: "business", label: "Business" },
              { value: "employer", label: "Employer" },
              { value: "county_org", label: "County organisation" },
              { value: "other", label: "Other" },
            ]} />
          <Input label="Region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
          <Select label="Marketplace listing" value={form.is_public ? "public" : "private"}
            onChange={(e) => setForm({ ...form, is_public: e.target.value === "public" })}
            options={[{ value: "private", label: "Private — members only" }, { value: "public", label: "Public — discoverable" }]} />
          <div className="sm:col-span-2 lg:col-span-3">
            <Input label="Description (optional)" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Who this workspace is for" />
          </div>
          <div className="flex items-end"><Button type="submit" loading={busy} fullWidth>Create workspace</Button></div>
        </form>
        <p className="text-2xs text-ink-3 flex items-start gap-1.5">
          <MapPin size={13} className="mt-0.5 shrink-0" />
          Starting locally? Begin with one or two associations and a concentrated group of businesses
          in one area — enough active vendors in one place for customers to find what they need.
        </p>
      </section>

      {/* ── Mine ───────────────────────────────────────────────────────── */}
      {workspaces.length === 0 ? (
        <EmptyState icon={Users} tone="brand" title="No workspace yet"
          description="Create one above, or ask an association admin to add your @handle to theirs." />
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Your workspaces">
            {workspaces.map((w) => (
              <button key={w.id} type="button" role="tab" aria-selected={w.id === selectedId}
                onClick={() => setSelectedId(w.id)}
                className={`rounded-xl border px-3 py-2 text-left text-sm ${w.id === selectedId ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-edge-1 bg-surface-0"}`}>
                <span className="font-semibold text-ink-1">{w.name}</span>
                <span className="block text-2xs text-ink-3">{w.region} · {w.plan.name} · {w.my_role}</span>
              </button>
            ))}
          </div>

          {detail && dash && (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Members" value={`${detail.usage.members_used} / ${detail.usage.members_limit}`} />
                <Stat label="Field officers" value={`${detail.usage.field_officers_used} / ${detail.usage.field_officers_limit}`} />
                <Stat label="Managed devices" value={`${detail.usage.devices_used} / ${detail.usage.devices_limit}`} />
                <Stat label="Pending device commands" value={dash.pending_device_commands} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* Members */}
                <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 space-y-3">
                  <h3 className="text-sm font-bold text-ink-1 flex items-center gap-2"><Users size={15} /> Member register</h3>
                  {canField && (
                    <form onSubmit={(e) => { e.preventDefault(); act(() => enterpriseAPI.addMember(selectedId, memberForm), "Member added").then(() => setMemberForm({ vendor_handle: "", role: "member" })); }} className="flex flex-wrap gap-2">
                      <div className="flex-1 min-w-36"><Input label="Vendor @handle" required value={memberForm.vendor_handle} onChange={(e) => setMemberForm({ ...memberForm, vendor_handle: e.target.value })} placeholder="mama_mboga" /></div>
                      <Select label="Role" value={memberForm.role} onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}
                        options={[{ value: "member", label: "Member" }, { value: "field_officer", label: "Field officer" }, { value: "viewer", label: "Viewer" }, ...(canManage ? [{ value: "admin", label: "Admin" }] : [])]} />
                      <div className="flex items-end"><Button type="submit" size="sm" icon={UserPlus} loading={busy}>Add</Button></div>
                    </form>
                  )}
                  <ul className="divide-y divide-edge-1">
                    {members.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                        <span className="flex-1 min-w-0"><span className="font-medium text-ink-1">{m.business_name}</span>
                          <span className="block text-2xs text-ink-3">@{m.vendor_handle}{m.registered_by_handle ? ` · registered by @${m.registered_by_handle}` : ""}</span></span>
                        <Badge variant="gray" size="xs">{m.role}</Badge>
                        {canManage && m.role !== "owner" && (
                          <Button variant="dangerGhost" size="xs" icon={Trash2} aria-label={`Revoke ${m.vendor_handle}`}
                            onClick={() => act(() => enterpriseAPI.revokeMember(selectedId, m.id), "Membership revoked")}>Revoke</Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {dash.field_registrations_last_30d?.length > 0 && (
                    <p className="text-2xs text-ink-3">
                      Field registrations (last 30 days): {dash.field_registrations_last_30d.map((r) => `@${r.officer_handle} — ${r.registrations}`).join(" · ")}.{" "}
                      Counts of named registrations, not an officer score.
                    </p>
                  )}
                </section>

                {/* Devices */}
                <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 space-y-3">
                  <h3 className="text-sm font-bold text-ink-1 flex items-center gap-2"><Smartphone size={15} /> Managed Android devices</h3>
                  {canField && (
                    <form onSubmit={(e) => { e.preventDefault(); act(() => enterpriseAPI.enrolDevice(selectedId, deviceForm), "Device enrolled").then(() => setDeviceForm({ label: "", enrolment_mode: "work_profile", assigned_handle: "", policy_name: "" })); }} className="grid gap-2 sm:grid-cols-2">
                      <Input label="Device label" required value={deviceForm.label} onChange={(e) => setDeviceForm({ ...deviceForm, label: e.target.value })} placeholder="Field phone 1" />
                      <Select label="Enrolment mode" value={deviceForm.enrolment_mode} onChange={(e) => setDeviceForm({ ...deviceForm, enrolment_mode: e.target.value })}
                        options={[{ value: "work_profile", label: "Work profile (officer's own phone)" }, { value: "fully_managed", label: "Fully managed (organisation phone)" }, { value: "dedicated", label: "Dedicated (field kit)" }]} />
                      <Input label="Assigned @handle (optional)" value={deviceForm.assigned_handle} onChange={(e) => setDeviceForm({ ...deviceForm, assigned_handle: e.target.value })} />
                      <Input label="Policy name (optional)" value={deviceForm.policy_name} onChange={(e) => setDeviceForm({ ...deviceForm, policy_name: e.target.value })} placeholder="From your EMM console" />
                      <div className="sm:col-span-2"><Button type="submit" size="sm" loading={busy}>Enrol device</Button></div>
                    </form>
                  )}
                  <ul className="space-y-2">
                    {devices.map((d) => (
                      <li key={d.id} className="rounded-xl border border-edge-1 p-3 text-sm space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink-1">{d.label}</span>
                          <Badge variant="gray" size="xs">{d.enrolment_mode.replace("_", " ")}</Badge>
                          <Badge variant={d.status === "active" || d.status === "enrolled" ? "brand" : "gray"} size="xs">{d.status}</Badge>
                          {d.assigned_handle && <span className="text-2xs text-ink-3">@{d.assigned_handle}</span>}
                        </div>
                        <p className="text-2xs text-ink-3">{d.enrolment_note}</p>
                        {canManage && (
                          <div className="flex flex-wrap gap-1.5">
                            {d.allowed_commands.map((c) => (
                              <Button key={c} variant="outline" size="xs" icon={Lock}
                                onClick={() => setCommandDraft({ deviceId: d.id, command_type: c, reason: "" })}>
                                {c.replaceAll("_", " ")}
                              </Button>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                    {devices.length === 0 && <li className="text-2xs text-ink-3">No devices enrolled yet.</li>}
                  </ul>
                  {commandDraft && (
                    <form onSubmit={issueCommand} className="rounded-xl bg-surface-2 p-3 space-y-2">
                      <p className="text-xs font-semibold text-ink-1">Request: {commandDraft.command_type.replaceAll("_", " ")}</p>
                      <Input label="Reason (kept in the audit trail)" required value={commandDraft.reason}
                        onChange={(e) => setCommandDraft({ ...commandDraft, reason: e.target.value })}
                        placeholder="e.g. Phone reported lost at the market, 12 Oct" />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" loading={busy}>Record request</Button>
                        <Button variant="ghost" size="sm" onClick={() => setCommandDraft(null)}>Cancel</Button>
                      </div>
                    </form>
                  )}
                </section>
              </div>

              {/* Android Enterprise binding + audit */}
              <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 space-y-3">
                <h3 className="text-sm font-bold text-ink-1 flex items-center gap-2"><ShieldCheck size={15} /> Android Enterprise & command audit</h3>
                <p className="text-2xs text-ink-3 max-w-3xl">{detail.android.note} Remote lock and company-data
                  removal depend on the enrolment mode: a work-profile phone can lose only its company
                  data — the officer's personal data is untouchable, and Brief_ refuses that command.</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={detail.android.enterprise_bound ? "brand" : "amber"} size="xs">
                    {detail.android.enterprise_bound ? `EMM bound: ${detail.android.emm_provider}` : "No EMM bound — commands are audit-only"}
                  </Badge>
                  <Badge variant="gray" size="xs">Dispatch {detail.android.dispatch_enabled ? "enabled" : "disabled in this deployment"}</Badge>
                </div>
                {myRole === "owner" && (
                  <form onSubmit={(e) => { e.preventDefault(); act(() => enterpriseAPI.updateWorkspace(selectedId, bindForm), "Android Enterprise binding saved"); }} className="grid gap-2 sm:grid-cols-3">
                    <Input label="Android Enterprise ID" value={bindForm.android_enterprise_id} onChange={(e) => setBindForm({ ...bindForm, android_enterprise_id: e.target.value })} placeholder="enterprises/…" />
                    <Input label="EMM provider" value={bindForm.emm_provider} onChange={(e) => setBindForm({ ...bindForm, emm_provider: e.target.value })} placeholder="e.g. your EMM console name" />
                    <div className="flex items-end"><Button type="submit" size="sm" loading={busy}>Save binding</Button></div>
                  </form>
                )}
                {commands.length > 0 ? (
                  <ul className="divide-y divide-edge-1 text-sm">
                    {commands.map((c) => (
                      <li key={c.id} className="py-2 flex flex-wrap gap-2 items-center">
                        <span className="font-medium text-ink-1">{c.command_type.replaceAll("_", " ")}</span>
                        <Badge variant={c.dispatched ? "brand" : "amber"} size="xs">{c.dispatched ? "dispatched" : "requested — not sent"}</Badge>
                        <span className="text-2xs text-ink-3">{c.reason} · {c.enrolment_mode.replace("_", " ")}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-2xs text-ink-3">No device commands requested yet.</p>}
              </section>
            </div>
          )}
        </section>
      )}

      {/* ── Discover + plans ───────────────────────────────────────────── */}
      {discover.filter((w) => !workspaces.some((m) => m.id === w.id)).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-ink-1">Public workspaces</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {discover.filter((w) => !workspaces.some((m) => m.id === w.id)).map((w) => (
              <div key={w.id} className="rounded-2xl border border-edge-1 bg-surface-0 p-4">
                <p className="text-sm font-semibold text-ink-1">{w.name}</p>
                <p className="text-2xs text-ink-3 mt-0.5">{w.region} · {num(w.member_count || 0)} members — ask an admin to add your @handle.</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {plans && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-ink-1">Workspace plans</h2>
          <div className="grid gap-2 md:grid-cols-3">
            {plans.plans.map((p) => {
              const current = detail?.plan?.key === p.key;
              return (
                <div key={p.key} className={`rounded-2xl border p-4 space-y-2 ${current ? "border-brand-500" : "border-edge-1"} bg-surface-0`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-ink-1">{p.name}</p>
                    {current && <Badge variant="brand" size="xs">Current</Badge>}
                  </div>
                  <p className="text-lg font-extrabold text-ink-1">{kes(p.price_kes_monthly)}</p>
                  <p className="text-2xs text-ink-3">{p.audience}. Up to {num(p.max_members)} members, {p.max_field_officers} field officers, {num(p.max_devices)} devices.</p>
                  <ul className="text-2xs text-ink-3 space-y-1 list-disc pl-4">
                    {p.features.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                  {detail && canManage && !current && (
                    <Button size="sm" variant="outline" loading={busy}
                      onClick={() => act(() => enterpriseAPI.updateWorkspace(selectedId, { plan_key: p.key }), `Plan changed to ${p.name}`)}>
                      Switch workspace to {p.name}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-2xs text-ink-3">
            The organisation buys the workspace once; members keep their own vendor plans on the
            marketplace side. Android Enterprise provides enrolment, policy and remote actions
            through your EMM — it does not provide the marketplace or job matching, which stay in Brief_.
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-edge-1 bg-surface-0 p-4">
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <p className="text-xl font-extrabold text-ink-1 mt-1">{value}</p>
    </div>
  );
}
