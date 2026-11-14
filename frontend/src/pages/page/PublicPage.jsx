import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { PageSpinner } from "@/components/ui/Spinner";
import { professionalAPI, apiError } from "@/lib/api";
import { num } from "@/lib/formatters";
import { offersFor, verifiedOnly } from "./pageRules";

/**
 * THE PUBLIC PAGE — /page/:handle. A mini website for one person or business.
 * Sections: Hero, About, Offers (price for each way), Hours and area, Credentials (verified only).
 * Every value comes from the business's own rows. Nothing is filled in as an example.
 */
export default function PublicPage() {
  const { handle = "" } = useParams();
  const [card, setCard] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setCard(null);
    setError(null);
    professionalAPI.page(handle)
      .then((r) => { if (live) setCard(r.data); })
      .catch((e) => { if (live) setError(apiError(e, "This page is not available.")); });
    return () => { live = false; };
  }, [handle]);

  if (error) {
    return (
      <Shell>
        <Card className="text-center">
          <p className="font-medium">This page is not available.</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
        </Card>
      </Shell>
    );
  }
  if (!card) return <PageSpinner />;

  const sections = card.sections || {};
  const offers = offersFor(card.services);
  const registrations = verifiedOnly(card.registrations);

  return (
    <Shell>
      {/* Hero */}
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">{card.name || `@${card.handle}`}</h1>
        <p className="text-sm text-gray-500">
          @{card.handle}{card.location ? ` · ${card.location}` : ""}
        </p>
        <p className="text-sm">
          {card.tagline && <span className="block mt-1 text-base text-ink-2">{card.tagline}</span>}
          {card.completed_appointments > 0
            ? `${num(card.completed_appointments)} completed booking${card.completed_appointments === 1 ? "" : "s"}`
            : "No completed bookings yet."}
        </p>
      </section>

      {/* About */}
      {card.description && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold mb-2">About</h2>
          <Card><p className="text-sm whitespace-pre-line">{card.description}</p></Card>
        </section>
      )}

      {/* Offers */}
      {sections.offers !== false && (
      <section className="mt-6">
        <h2 className="text-lg font-semibold mb-2">Offers</h2>
        {offers.length === 0 ? (
          <Card><p className="text-sm text-gray-500">Nothing is offered right now.</p></Card>
        ) : (
          <div className="space-y-3">
            {offers.map((s) => (
              <Card key={s.id}>
                <CardHeader>
                  <CardTitle>{s.name}</CardTitle>
                  {s.domain_label && <Badge variant="gray">{s.domain_label}</Badge>}
                </CardHeader>
                <p className="text-xs text-gray-500">{s.duration_minutes} min</p>
                {s.modes.length === 0 ? (
                  <p className="text-sm mt-2">Ask me for a price</p>
                ) : (
                  <ul className="mt-2 divide-y">
                    {s.modes.map((m) => (
                      <li key={m.mode} className="flex justify-between gap-3 py-2 text-sm">
                        <span>{m.label}</span>
                        <span className="font-medium text-right">{m.price}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      )}

      {/* Hours and area */}
      {sections.hours !== false && (
      <section className="mt-6">
        <h2 className="text-lg font-semibold mb-2">Hours and area</h2>
        <Card>
          {card.location && <p className="text-sm mb-2">{card.location}</p>}
          {card.hours.length === 0 ? (
            <p className="text-sm text-gray-500">Hours are not published yet.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {card.hours.map((h) => (
                <li key={h.day} className="flex justify-between gap-3">
                  <span className="font-medium">{h.day}</span>
                  <span>{h.windows.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      )}

      {/* Credentials: verified only */}
      {sections.credentials !== false && registrations.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold mb-2">Credentials</h2>
          <Card>
            <ul className="text-sm space-y-2">
              {registrations.map((r, i) => (
                <li key={`${r.issuing_body}-${r.title}-${i}`}>
                  <span className="font-medium">{r.title}</span>
                  <span className="text-gray-500"> · {r.issuing_body}</span>
                  <Badge variant="brand" className="ml-2">Verified</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-xl">{children}</div>
    </main>
  );
}
