import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { knowledgeAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

/**
 * LEARN — a directory of seminars, courses and mentor sessions, by sector.
 * Each card says what was promised. A session shows what was delivered only
 * after the organiser has written it down, and ratings come only from people
 * who attended.
 */

const KIND_LABEL = { seminar: "Seminar", course: "Course", mentor_session: "Mentor session" };
const money = (v) => (v == null ? "Free to view" : `KSh ${Number(v).toLocaleString("en-KE")}`);

export default function LearnPage() {
  const signedIn = useAuthStore((s) => !!s.vendor);
  const [sectors, setSectors] = useState([]);
  const [sector, setSector] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    knowledgeAPI.sectors().then(({ data }) => setSectors(data.sectors)).catch(() => setSectors([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let live = true;
    setRows(null);
    knowledgeAPI.listings({ sector: sector || undefined, kind: kind || undefined, q: term || undefined })
      .then(({ data }) => { if (live) { setRows(data.listings); setError(null); } })
      .catch((err) => { if (live) setError(apiError(err, "Could not load the directory")); });
    return () => { live = false; };
  }, [sector, kind, term]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-ink-1">Learn from businesses</h1>
          <p className="text-sm text-ink-3">
            Seminars, courses and mentor sessions, by sector. Read what was promised, then what was delivered.
          </p>
        </div>
        {signedIn && <Link to="/learn/new"><Button size="sm">Host a session</Button></Link>}
      </header>

      <Input placeholder="Search by title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sessions" />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Sectors">
        <button type="button" onClick={() => setSector("")}
          className={`rounded-full border px-3 py-1 text-xs ${!sector ? "border-brand-600 bg-brand-600 text-white" : "border-edge-2 text-ink-2"}`}>
          All sectors
        </button>
        {sectors.map((s) => (
          <button key={s.key} type="button" onClick={() => setSector(s.key)} aria-pressed={sector === s.key}
            className={`rounded-full border px-3 py-1 text-xs ${sector === s.key ? "border-brand-600 bg-brand-600 text-white" : "border-edge-2 text-ink-2"}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {[["", "Any kind"], ...Object.entries(KIND_LABEL)].map(([v, l]) => (
          <button key={v || "any"} type="button" onClick={() => setKind(v)}
            className={`rounded-lg border px-2.5 py-1 text-xs ${kind === v ? "border-ink-1 font-semibold text-ink-1" : "border-edge-2 text-ink-3"}`}>
            {l}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!rows && !error && <PageSpinner />}
      {rows && rows.length === 0 && <p className="text-sm text-ink-4">No sessions in this sector yet.</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(rows || []).map((l) => (
          <Link key={l.id} to={`/learn/${l.id}`} className="block focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20 rounded-2xl">
            <Card hover padding="p-4" className="h-full space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="blue">{KIND_LABEL[l.kind]}</Badge>
                <Badge variant={l.status === "completed" ? "brand" : "gray"}>
                  {l.status === "completed" ? "Delivered record" : "Promised"}
                </Badge>
              </div>
              <p className="text-sm font-semibold text-ink-1">{l.title}</p>
              <p className="line-clamp-2 text-xs text-ink-2">{l.promised_outcomes}</p>
              <p className="text-xs text-ink-3">
                {money(l.price_kes)}
                {l.rating != null ? ` · ${l.rating} from ${l.review_count} attended` : " · no reviews yet"}
                {l.organiser.verified ? " · verified host" : ""}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
