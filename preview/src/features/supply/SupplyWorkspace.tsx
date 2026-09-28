import React, { useEffect, useState } from "react";
import * as api from "../../api/briefApi";
import type { Enterprise, Capability } from "../../api/supplyTypes";
import { SessionSignIn } from "../../components/SessionSignIn";
import { supplyPath } from "./shared";
import { EnterpriseEditor } from "./EnterpriseEditor";
import { CapabilityEditor } from "./CapabilityEditor";
import { SourcingEditor } from "./SourcingEditor";
import { SupplyProfile } from "./SupplyProfile";
import { CapabilitySearch } from "./CapabilitySearch";
import { VerificationPanel, ReviewQueue } from "./VerificationPanel";
import { VendorLeadCapture } from "./VendorLeadCapture";
import "../requests/requests.css";
import "./supply.css";
// Lazy: the map engine is heavy and only the map section pays for it.
const VendorLeadMap = React.lazy(() => import("./VendorLeadMap"));
export function SupplyWorkspace({ route = "mine" }: { route?: string }) {
  const [section, id] = route.split("?")[0].split("/");
  const isPublic = section === "profile";
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [auth, setAuth] = useState(false),
    [reload, setReload] = useState(0),
    [editing, setEditing] = useState<
      "enterprise" | "capability" | "sourcing" | "verification" | null
    >(null),
    [cap, setCap] = useState<Capability | undefined>(),
    [reviewer, setReviewer] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () => {
    setEditing(null);
    setCap(undefined);
    setReload((n) => n + 1);
  };
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setEditing(null);
    setEnterprise(null);
    setAuth(false);
    if (section === "search" || section === "review" || section === "leads" || section === "map") {
      setLoading(false);
      return;
    }
    (async () => {
      const r = isPublic
        ? await api.getEnterprise(id, true)
        : await api.getMyEnterprise();
      if (!live) return;
      setLoading(false);
      if (r.ok)
        setEnterprise("enterprise" in r.data ? r.data.enterprise : r.data);
      else {
        setError(r.error);
        setAuth(r.status === 401);
      }
    })();
    return () => {
      live = false;
    };
  }, [section, id, isPublic, reload]);
  useEffect(() => setNotice(""), [section, id]);
  useEffect(() => {
    let live = true;
    api.whoAmI().then((r) => {
      if (live)
        setReviewer(r.ok && !!r.data.capabilities?.includes("moderate"));
    });
    return () => {
      live = false;
    };
  }, [reload]);
  const saved = () => {
    supplyPath("mine");
    refresh();
    setNotice("Saved. Your enterprise and capabilities are kept on Brief.");
  };
  return (
    <div className="requests-workspace supply-workspace">
      <header className="supply-workspace-nav">
        <span className="request-eyebrow">Brief / Supply network</span>
        <nav aria-label="Supply workspace">
          <button onClick={() => supplyPath("mine")}>My enterprise</button>
          <button onClick={() => supplyPath("search")}>
            Explore capabilities
          </button>
          <button onClick={() => supplyPath("leads")}>
            Vendor leads
          </button>
          <button onClick={() => supplyPath("map")}>
            Map
          </button>
          {reviewer && (
            <button onClick={() => supplyPath("review")}>
              Review submissions
            </button>
          )}
          <button
            onClick={() => {
              window.location.hash = "requests/new";
            }}
          >
            Create Request
          </button>
        </nav>
      </header>
      {section === "search" ? (
        <CapabilitySearch requestId={id} />
      ) : section === "review" ? (
        <ReviewQueue />
      ) : section === "leads" ? (
        <VendorLeadCapture />
      ) : section === "map" ? (
        <React.Suspense fallback={<p role="status">Loading the map…</p>}>
          <VendorLeadMap />
        </React.Suspense>
      ) : loading ? (
        <p role="status">Loading enterprise…</p>
      ) : auth ? (
        <SessionSignIn
          title="Sign in to build your enterprise profile"
          onSignedIn={refresh}
        />
      ) : error ? (
        <section className="request-panel">
          <h2>Enterprise unavailable</h2>
          <p role="alert">{error}</p>
          <button onClick={refresh}>Retry enterprise</button>
        </section>
      ) : (
        <>
          {notice && (
            <p role="status" className="supply-notice">
              {notice}
            </p>
          )}
          {!enterprise && !isPublic ? (
            section === "new" || section === "agent" ? (
              <EnterpriseEditor
                agentPath={section === "agent"}
                onSaved={saved}
                onCancel={() => supplyPath("mine")}
                onReload={saved}
              />
            ) : (
              <section className="supply-onboarding">
                <span className="request-eyebrow">
                  Built around what you can do
                </span>
                <h1>What can your business help someone get done?</h1>
                <p>
                  Describe an actual capability, where you can serve, your usual
                  capacity and turnaround. Start small. Verification can follow.
                </p>
                <div className="supply-paths">
                  <button
                    className="supply-path"
                    onClick={() => supplyPath("new")}
                  >
                    <span className="supply-path-number">01</span>
                    <strong>We make, supply or deliver</strong>
                    <span>
                      Manufacturing, distribution, services, logistics and more.
                    </span>
                    <b>Start a business profile →</b>
                  </button>
                  <button
                    className="supply-path"
                    onClick={() => supplyPath("agent")}
                  >
                    <span className="supply-path-number">02</span>
                    <strong>I help businesses source things</strong>
                    <span>
                      An independent sourcing path. Clear role, private
                      networks, honest verification.
                    </span>
                    <b>Start a sourcing profile →</b>
                  </button>
                </div>
                <p className="request-hint">
                  Already have a Brief business? This adds capabilities to that
                  same identity. It does not create a second account or public
                  listing.
                </p>
              </section>
            )
          ) : (
            enterprise && (
              <>
                {editing === "enterprise" ? (
                  <EnterpriseEditor
                    key={`enterprise-${enterprise.revision}`}
                    initial={enterprise}
                    onSaved={saved}
                    onCancel={() => setEditing(null)}
                    onReload={refresh}
                  />
                ) : editing === "capability" ? (
                  <CapabilityEditor
                    key={`${cap?.id ?? "new"}-${cap?.revision ?? 0}`}
                    enterprise={enterprise}
                    initial={cap}
                    onSaved={saved}
                    onCancel={() => setEditing(null)}
                    onReload={refresh}
                  />
                ) : editing === "sourcing" ? (
                  <SourcingEditor
                    enterprise={enterprise}
                    onSaved={saved}
                    onCancel={() => setEditing(null)}
                    onReload={refresh}
                  />
                ) : editing === "verification" ? (
                  <VerificationPanel enterprise={enterprise} onDone={refresh} />
                ) : (
                  <SupplyProfile
                    enterprise={enterprise}
                    owner={!isPublic}
                    onEdit={() => setEditing("enterprise")}
                    onAdd={() => {
                      setCap(undefined);
                      setEditing("capability");
                    }}
                    onCapability={(c) => {
                      setCap(c);
                      setEditing("capability");
                    }}
                    onSourcing={() => setEditing("sourcing")}
                    onVerification={() => setEditing("verification")}
                    onArchive={async (c) => {
                      if (
                        busy ||
                        !window.confirm(
                          `Archive “${c.name}”? It will leave search. Historical references are retained; archiving cannot be undone.`,
                        )
                      )
                        return;
                      setBusy(true);
                      const r = await api.archiveCapability(c.id, c.revision);
                      setBusy(false);
                      if (r.ok) {
                        refresh();
                        setNotice("Capability archived.");
                      } else {
                        setNotice(r.error);
                        if (r.status === 401) setAuth(true);
                      }
                    }}
                  />
                )}
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
