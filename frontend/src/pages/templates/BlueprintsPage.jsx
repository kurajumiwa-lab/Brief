import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { PageSpinner } from "@/components/ui/Spinner";
import { blueprintsAPI, apiError } from "@/lib/api";

/** TEMPLATES — free starter blueprints for small ventures. Read them freely. */
export default function BlueprintsPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    blueprintsAPI.library()
      .then(({ data }) => setRows(data.blueprints))
      .catch((err) => setError(apiError(err, "Could not load the templates")));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-ink-1">Free business templates</h1>
        <p className="text-sm text-ink-3">
          Step-by-step starters for a small venture. Free to read and free to use. Start one and its next step appears in your Today window.
        </p>
      </header>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!rows && !error && <PageSpinner />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(rows || []).map((b) => (
          <Link key={b.key} to={`/templates/${b.key}`} className="block rounded-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20">
            <Card hover padding="p-4" className="h-full space-y-2">
              <div className="flex gap-2"><Badge variant="brand">Free</Badge><Badge variant="gray">{b.step_count} steps</Badge></div>
              <p className="text-sm font-semibold text-ink-1">{b.title}</p>
              <p className="text-xs text-ink-2">{b.summary}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
