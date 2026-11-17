import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { eventAPI } from "@/lib/api";
import { PageSpinner } from "@/components/ui/Spinner";

export default function EventShareRedirect() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    eventAPI.resolveShare(slug).then(({ data }) => {
      if (active) navigate(data.kind === "bulk_buy" ? `/activities/${data.id}` : `/events?event=${data.id}`, { replace: true });
    }).catch((err) => {
      if (active) setError(err?.response?.status === 404 ? "This event is unavailable." : "Could not load this event. Check your connection and try again.");
    });
    return () => { active = false; };
  }, [slug, navigate]);
  if (error) return <div role="alert" className="p-5 space-y-3"><p>{error}</p><Link className="underline text-brand-700" to="/events">Browse events</Link></div>;
  return <PageSpinner label="Opening event…" />;
}
