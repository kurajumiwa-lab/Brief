import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import { routineAPI } from "@/lib/api";

/**
 * A window onto Today on the home screen. Shows only the items with a dot, and
 * nothing at all when nothing is waiting.
 */
export default function TodayCard() {
  const [today, setToday] = useState(null);

  useEffect(() => {
    let live = true;
    routineAPI.today()
      .then(({ data }) => { if (live) setToday(data); })
      .catch(() => { if (live) setToday({ items: [], dots: 0 }); });
    return () => { live = false; };
  }, []);

  if (!today || today.dots === 0) return null;
  const waiting = today.items.filter((i) => i.dot).slice(0, 3);

  return (
    <Card className="space-y-2" aria-label="Today">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-1">Today</h2>
        <Link to="/today" className="text-xs font-medium text-brand-700 underline">
          {today.dots} waiting
        </Link>
      </div>
      <ul className="space-y-1">
        {waiting.map((i) => (
          <li key={i.key} className="flex items-center gap-2 text-sm text-ink-2">
            <span className="inline-block h-2 w-2 rounded-full bg-accent-500" aria-hidden="true" />
            <Link to={i.link} className="hover:underline">{i.label}</Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
