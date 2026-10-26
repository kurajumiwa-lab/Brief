import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Scale } from "lucide-react";
import { useApp } from "@/store/appStore.js";
import { measure } from "@/lib/metrics.js";

/**
 * MEASUREMENT — the brief's last instruction, answered instead of ignored.
 *
 * The six things worth counting are printed next to the number this build can
 * actually compute for each. Retention is the one that says "not measurable",
 * because it is. A prototype that reported a retention figure would be
 * reporting on the person holding the phone.
 */
export default function MeasurePage() {
  const state = useApp();
  const metrics = useMemo(() => measure(state), [state]);
  const measurable = metrics.filter((metric) => metric.measurable).length;

  return (
    <>
      <div className="section-head" style={{ marginTop: 18 }}>
        <div>
          <div className="eyebrow">Prototype notes</div>
          <h1 className="title-lg">What this would measure</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 4, maxWidth: "58ch" }}>
            The brief asks for six things to be judged on — and explicitly not engagement alone. Five of them are
            computed below from the state this browser holds. The sixth is not measurable in a prototype, so it says
            so.
          </p>
        </div>
      </div>

      <div className="notice" style={{ marginBottom: 14 }}>
        <Scale size={16} className="notice__icon" aria-hidden="true" />
        <span>
          <strong>{measurable} of {metrics.length}</strong> computed from the seed network plus everything you have
          done here. These are not analytics: nothing leaves this browser, and no figure below is a projection.
        </span>
      </div>

      <div className="stack">
        {metrics.map((metric) => (
          <section key={metric.key} className="card card--pad" aria-labelledby={`metric-${metric.key}`}>
            <div className="row row--between" style={{ alignItems: "flex-start", gap: 12 }}>
              <div>
                <div className="eyebrow">{metric.label}</div>
                <h2 className="title-sm" id={`metric-${metric.key}`} style={{ marginTop: 2 }}>
                  {metric.question}
                </h2>
              </div>
              <span className={`chip ${metric.measurable ? "chip--green" : ""}`} style={{ flexShrink: 0 }}>
                {metric.measurable ? "measured" : "not measurable"}
              </span>
            </div>

            <div className="metric__headline">
              <span className="metric__value">{metric.headline}</span>
              <span className="tiny muted">{metric.sub}</span>
            </div>

            <dl className="metric__rows">
              {metric.rows.map((row) => (
                <div className="metric__row" key={row.label}>
                  <dt className="tiny muted">{row.label}</dt>
                  <dd className="tiny mono">{row.value}</dd>
                </div>
              ))}
            </dl>

            <p className="micro muted" style={{ marginTop: 10 }}>
              {metric.note}
            </p>
          </section>
        ))}
      </div>

      <div className="row" style={{ marginTop: 18, gap: 8, flexWrap: "wrap" }}>
        <Link className="btn btn--quiet" to="/">
          <ArrowLeft size={14} aria-hidden="true" />
          Back to the feed
        </Link>
        <Link className="btn btn--quiet" to="/safety">
          What this prototype does not do
        </Link>
      </div>
    </>
  );
}
