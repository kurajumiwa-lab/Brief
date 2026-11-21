import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, BadgeCheck, Briefcase, Check, Copy, MapPin, ShieldCheck, Users, Wallet,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { hiringAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

const money = (n) => `KSh ${Number(n || 0).toLocaleString("en-KE")}`;

/**
 * JOBS — free to post for an employer, free to apply forever.
 *
 * The rule that shapes the whole screen: **the person looking for work never
 * pays.** It is on every card, because a job board that takes money from the
 * person who needs the job is the exact shape of the recruitment scam every
 * Kenyan public body warns about.
 *
 * The employer pays, and only after a hire is confirmed. Who pays is decided by
 * what the poster is: the business that will do the hiring posts free; an agency
 * or aggregator reselling our attention is a paid poster.
 */
export function JobsBoardPage() {
  const token = useAuthStore((s) => s.token);
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const town = params.get("town") || "";

  const load = useCallback(async () => {
    setError("");
    try {
      const { data: body } = await hiringAPI.board({ town });
      setData(body);
    } catch (err) {
      setError(apiError(err, "Could not load the jobs"));
    }
  }, [town]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <header className="space-y-1.5">
        <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
          <Briefcase size={13} aria-hidden="true" /> Jobs
        </p>
        <h1 className="text-xl font-semibold text-ink-1">Work being hired for, near you</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-3">
          Posted by the business doing the hiring, free.{" "}
          <span className="font-semibold text-ink-2">Applying costs you nothing</span> — not
          now, not at the interview, not out of your first pay.
        </p>
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <Input
            label="Town"
            value={town}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set("town", e.target.value);
              else next.delete("town");
              setParams(next, { replace: true });
            }}
            placeholder="All towns"
          />
          <Link to="/jobs/mine">
            <Button type="button" variant="secondary" size="sm">
              {token ? "My jobs and claims" : "Sign in"}
            </Button>
          </Link>
        </div>
      </header>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!data && !error && <PageSpinner />}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={Briefcase}
          title="No open jobs here yet"
          description="Posting a job for your own business is free, and it stays free. An agency posting on behalf of an unnamed employer pays."
        />
      )}

      <div className="space-y-2.5">
        {(data?.items || []).map((job) => (
          <Card key={job.id} padding="p-3.5" className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-1">{job.role_title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-ink-4">
                  <span className="inline-flex items-center gap-1">
                    <Briefcase size={11} aria-hidden="true" /> {job.employer_name}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={11} aria-hidden="true" /> {job.town}
                  </span>
                  {job.salary_kes ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-ink-2">
                      <Wallet size={11} aria-hidden="true" /> {money(job.salary_kes)} / {job.salary_unit}
                    </span>
                  ) : (
                    <span className="font-semibold text-ink-3">Salary not stated</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant="brand">Free to apply</Badge>
                {job.poster_is_employer ? (
                  <span className="inline-flex items-center gap-1 text-micro font-bold text-ink-3">
                    <BadgeCheck size={11} className="text-tech-600" aria-hidden="true" /> Direct employer
                  </span>
                ) : (
                  <span className="text-micro font-bold text-ink-4">Via an agency</span>
                )}
              </div>
            </div>
            <p className="line-clamp-2 text-xs leading-relaxed text-ink-3">{job.role_summary}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="inline-flex items-center gap-1 text-micro text-ink-4">
                <Users size={11} aria-hidden="true" /> {job.applications} applied
                {job.hire_count > 0 && ` · ${job.hire_count} hired through this`}
              </p>
              <Link
                to={`/jobs/${job.id}`}
                className="text-xs font-bold text-brand-700 hover:underline dark:text-brand-300"
              >
                See the role →
              </Link>
            </div>
          </Card>
        ))}
      </div>

      <p className="flex items-start gap-1.5 rounded-card border border-edge-1 bg-surface-1 p-3 text-micro leading-relaxed text-ink-3">
        <ShieldCheck size={12} className="mt-0.5 shrink-0 text-tech-600" aria-hidden="true" />
        <span>
          If anyone asks you to pay for a job — a processing fee, a uniform, a medical, an
          “interview slot” — it is not us and it is not legitimate.{" "}
          <Link to="/jobs/post" className="font-bold text-brand-700 hover:underline dark:text-brand-300">
            Post a job
          </Link>{" "}
          and see who pays.
        </span>
      </p>
    </div>
  );
}

export function JobDetailPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const via = params.get("via") || "";

  const load = useCallback(async () => {
    try {
      const { data } = await hiringAPI.broadcast(id);
      setJob(data);
    } catch (err) {
      setError(apiError(err, "Could not load that job"));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async () => {
    if (!token) {
      toast.error("Sign in to apply. It is free, and we never ask for a fee.");
      return;
    }
    setSending(true);
    try {
      await hiringAPI.apply(id, { cover_note: note.trim() || null, via: via || null });
      toast.success("Applied. Nothing is owed by you at any point.");
      load();
    } catch (err) {
      toast.error(apiError(err, "Couldn't send the application."));
    } finally {
      setSending(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <p role="alert" className="text-sm text-red-600">{error}</p>
        <Link to="/jobs" className="mt-3 inline-block text-xs font-bold text-brand-700">All jobs</Link>
      </div>
    );
  }
  if (!job) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <Link to="/jobs" className="inline-flex items-center gap-1 text-2xs font-bold text-ink-3 hover:text-ink-1">
        <ArrowLeft size={12} aria-hidden="true" /> All jobs
      </Link>

      <header className="space-y-1.5">
        <h1 className="text-xl font-semibold text-ink-1">{job.role_title}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-4">
          <span className="inline-flex items-center gap-1 font-semibold text-ink-2">
            <Briefcase size={11} aria-hidden="true" /> {job.employer_name}
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin size={11} aria-hidden="true" /> {job.town}
          </span>
          <span>{job.applications} applied · {job.hire_count} hired</span>
        </p>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Badge variant="brand">Free to apply</Badge>
          {job.poster_is_employer ? (
            <Badge variant="gray">Direct employer · free to post</Badge>
          ) : (
            <Badge variant="amber">Posted by an agency</Badge>
          )}
        </div>
      </header>

      <Card padding="p-4" className="space-y-2">
        <p className="whitespace-pre-line text-sm leading-relaxed text-ink-2">{job.role_summary}</p>
        {job.salary_kes ? (
          <p className="text-xs font-semibold text-ink-1">
            {money(job.salary_kes)} per {job.salary_unit}
          </p>
        ) : (
          <p className="text-xs text-ink-3">Salary not stated on this post.</p>
        )}
        {job.contact_note && <p className="text-xs text-ink-3">{job.contact_note}</p>}
      </Card>

      {!job.applicants && (
        <Card padding="p-4" className="space-y-2.5">
          <p className="text-sm font-semibold text-ink-1">Apply</p>
          <p className="text-micro leading-relaxed text-ink-3">
            Free, always.{" "}
            {via && (
              <span className="font-semibold text-ink-2">
                You arrived through a broadcaster’s link — that is who this hire credits.
              </span>
            )}
          </p>
          <Textarea
            label="A line about you (optional)"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What you have done, and when you can start."
          />
          <Button type="button" onClick={apply} disabled={sending}>
            {sending ? "Sending…" : token ? "Apply — free" : "Sign in to apply"}
          </Button>
        </Card>
      )}

      {job.applicants && (
        <Card padding="p-4" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-1">Applicants</p>
            <Badge variant="gray">{job.applicants?.length || 0}</Badge>
          </div>
          {(job.applicants || []).length === 0 && (
            <p className="text-xs text-ink-3">Nobody has applied yet.</p>
          )}
          <ul className="divide-y divide-edge-1">
            {(job.applicants || []).map((a) => (
              <li key={a.id} className="space-y-1.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-ink-1">
                    {a.applicant.name || a.applicant.handle || "Applicant"}
                    {a.attributed_via && (
                      <span className="ml-1.5 text-micro font-normal text-ink-4">
                        via {a.attributed_via}
                      </span>
                    )}
                  </p>
                  <span className="text-micro font-bold uppercase tracking-wide text-ink-4">{a.status}</span>
                </div>
                {a.cover_note && <p className="text-micro leading-relaxed text-ink-3">{a.cover_note}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {a.status === "applied" && (
                    <>
                      <Button type="button" size="xs" variant="secondary"
                        onClick={() => hiringAPI.shortlist(a.id).then(load).catch((e) => toast.error(apiError(e, "Couldn't update.")))}>
                        Shortlist
                      </Button>
                      <Button type="button" size="xs" variant="ghost"
                        onClick={() => hiringAPI.reject(a.id).then(load).catch((e) => toast.error(apiError(e, "Couldn't update.")))}>
                        Not this time
                      </Button>
                    </>
                  )}
                  {(a.status === "applied" || a.status === "shortlisted") && (
                    <Button type="button" size="xs"
                      onClick={() => hiringAPI.hire(a.id).then(load).catch((e) => toast.error(apiError(e, "Couldn't confirm the hire.")))}>
                      <Check size={12} aria-hidden="true" /> Hired
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-micro leading-relaxed text-ink-4">
            Marking someone hired records the fee as <strong>accrued</strong> — nobody is paid
            until the hire is confirmed by a second signal, and you settle it directly.
          </p>
        </Card>
      )}
    </div>
  );
}

export function PostJobPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    role_title: "", employer_name: "", role_summary: "", poster_kind: "direct",
    town: "", salary_kes: "", salary_unit: "month", contact_note: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));
  const fee = form.salary_kes ? Math.ceil(Number(form.salary_kes) * 0.115) : 0;

  const submit = async (e) => {
    e.preventDefault();
    if (form.role_summary.trim().length < 20) {
      toast.error("Say what the job is, in a sentence or two.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await hiringAPI.post({
        ...form,
        salary_kes: form.salary_kes ? Number(form.salary_kes) : null,
      });
      toast.success("Posted. Free, and it stays free.");
      navigate(`/jobs/${data.id}`);
    } catch (err) {
      toast.error(apiError(err, "Couldn't post that job."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-16">
      <header className="space-y-1.5">
        <h1 className="text-xl font-semibold text-ink-1">Post a job</h1>
        <p className="text-sm leading-relaxed text-ink-3">
          Free if you are the business doing the hiring — for as long as this exists, not
          free-then-charged. An agency posting for an unnamed employer is a paid poster.
        </p>
      </header>

      <Card as="form" padding="p-4" className="space-y-3" onSubmit={submit}>
        <Select
          label="Who is posting?"
          value={form.poster_kind}
          onChange={set("poster_kind")}
          options={[
            { value: "direct", label: "My own business — we are doing the hiring" },
            { value: "agency", label: "An agency or recruiter" },
            { value: "aggregator", label: "A jobs group or aggregator" },
          ]}
          hint="A direct employer posts free and never pays to publish."
        />
        <Input label="Role" value={form.role_title} onChange={set("role_title")} required
          placeholder="e.g. Shop assistant" />
        <Input label="Employer" value={form.employer_name} onChange={set("employer_name")} required
          hint="The business the person would actually work for. A vacancy with no employer is not a job." />
        <Textarea label="The job" rows={4} value={form.role_summary} onChange={set("role_summary")} required
          hint="What they will do, the hours, and what you need from them." />
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Town" value={form.town} onChange={set("town")} />
          <Input label="Salary (KES, optional)" type="number" min="0" inputMode="numeric"
            value={form.salary_kes} onChange={set("salary_kes")} />
          <Select label="Per" value={form.salary_unit} onChange={set("salary_unit")}
            options={[
              { value: "month", label: "Month" },
              { value: "week", label: "Week" },
              { value: "day", label: "Day" },
              { value: "job", label: "Job" },
            ]} />
        </div>
        <Input label="How to reach you (optional)" value={form.contact_note} onChange={set("contact_note")} />

        {fee > 0 && (
          <div className={cn("rounded-lg p-3 text-xs leading-relaxed",
            form.poster_kind === "direct"
              ? "bg-brand-50 text-brand-900 dark:bg-brand-500/10 dark:text-brand-100"
              : "bg-accent-50 text-accent-900 dark:bg-accent-500/10 dark:text-accent-100")}>
            {form.poster_kind === "direct" ? (
              <>
                <strong>Posting is free.</strong> If you hire through this, the fee is{" "}
                {money(fee)} — about half a week’s pay — payable by you{" "}
                <strong>after the hire is confirmed</strong>, and never deducted from anyone’s
                salary.
              </>
            ) : (
              <>
                As an intermediary the hire fee is {money(fee)} per confirmed hire. The
                applicant is still never charged anything.
              </>
            )}
          </div>
        )}

        <p className="flex items-start gap-1.5 text-micro leading-relaxed text-ink-4">
          <ShieldCheck size={12} className="mt-0.5 shrink-0 text-tech-600" aria-hidden="true" />
          Your applicants will never be asked for money by us. If you ever ask them for a
          fee, the post comes down.
        </p>

        <Button type="submit" disabled={saving}>{saving ? "Posting…" : "Post it — free"}</Button>
      </Card>
    </div>
  );
}

export function MyJobsPage() {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [refs, setRefs] = useState({});

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const { data: body } = await hiringAPI.mine();
      setData(body);
    } catch (err) {
      setError(apiError(err, "Could not load your jobs"));
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (!token) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <p className="text-sm text-ink-3">Sign in to see your jobs, applications and claims.</p>
        <Link to="/auth" className="mt-2 inline-block text-xs font-bold text-brand-700">Sign in →</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-ink-1">My jobs</h1>
        <p className="text-sm text-ink-3">
          Numbers that exist, and money that has not moved. Accrued is a claim, not a balance.
        </p>
      </header>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!data && !error && <PageSpinner />}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Accrued", data.accrued_kes, "awaiting confirmation"],
              ["Payable", data.payable_kes, "confirmed hires"],
              ["Settled", data.settled_kes, "paid directly"],
            ].map(([label, value, hint]) => (
              <Card key={label} padding="p-3">
                <p className="text-micro font-bold uppercase tracking-wide text-ink-4">{label}</p>
                <p className="text-lg font-extrabold tabular-nums text-ink-1">{money(value)}</p>
                <p className="text-micro text-ink-4">{hint}</p>
              </Card>
            ))}
          </div>

          <Card padding="p-4" className="space-y-2">
            <p className="text-sm font-semibold text-ink-1">Claims</p>
            {data.claims.length === 0 && <p className="text-xs text-ink-3">No claims yet.</p>}
            <ul className="divide-y divide-edge-1">
              {data.claims.map((c) => (
                <li key={c.id} className="space-y-1.5 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-ink-1">
                      {c.kind === "hire_fee" ? "Hire fee" : "Broadcaster share"} · {money(c.amount_kes)}
                    </p>
                    <Badge variant={c.status === "settled" ? "brand" : c.status === "void" ? "red" : "amber"}>
                      {c.status}
                    </Badge>
                  </div>
                  {c.note && <p className="text-micro leading-relaxed text-ink-4">{c.note}</p>}
                  {c.status === "payable" && (
                    <div className="flex flex-wrap items-end gap-2">
                      <Input
                        label="M-Pesa reference"
                        value={refs[c.id] || ""}
                        onChange={(e) => setRefs((r) => ({ ...r, [c.id]: e.target.value }))}
                        placeholder="e.g. QK12ABC34"
                      />
                      <Button
                        type="button" size="sm"
                        onClick={() =>
                          hiringAPI.settle(c.id, (refs[c.id] || "").trim())
                            .then(() => { toast.success("Recorded. Brief moved no money."); load(); })
                            .catch((e) => toast.error(apiError(e, "Couldn't record that payment.")))
                        }
                      >
                        Record payment
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-micro leading-relaxed text-ink-4">
              A claim becomes payable only when a hire is confirmed by two signals — the
              employer and the hiree, or a second hire in the same role.
            </p>
          </Card>

          <Card padding="p-4" className="space-y-2">
            <p className="text-sm font-semibold text-ink-1">My broadcasts</p>
            {data.broadcasts.length === 0 && <p className="text-xs text-ink-3">Nothing posted yet.</p>}
            <ul className="divide-y divide-edge-1">
              {data.broadcasts.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link to={`/jobs/${b.id}`} className="truncate text-xs font-semibold text-ink-1 hover:underline">
                      {b.role_title}
                    </Link>
                    <p className="text-micro text-ink-4">
                      {b.applications} applied · {b.hire_count} hired
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/jobs/${b.id}?via=${b.via_code}`;
                      navigator.clipboard?.writeText(url);
                      toast.success("Link copied. Whoever you forward it to is credited to you.");
                    }}
                    className="inline-flex items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-300"
                  >
                    <Copy size={11} aria-hidden="true" /> Share
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card padding="p-4" className="space-y-2">
            <p className="text-sm font-semibold text-ink-1">My applications</p>
            {data.applications.length === 0 && <p className="text-xs text-ink-3">None yet.</p>}
            <ul className="divide-y divide-edge-1">
              {data.applications.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <p className="text-xs text-ink-2">{a.status}</p>
                  <p className="text-micro text-ink-4">
                    {a.hired_at ? `hired ${a.hired_at.slice(0, 10)}` : a.created_at?.slice(0, 10)}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-micro text-ink-4">Applying never costs you anything.</p>
          </Card>
        </>
      )}
    </div>
  );
}
