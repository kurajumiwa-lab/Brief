import * as supply from "../domain/supply.js";
import * as vendorLeads from "../domain/vendorLeads.js";
import * as verification from "../domain/supplyVerification.js";
import * as links from "../domain/requestParticipants.js";
import { RequestError } from "../domain/requests.js";
import { requireAuth, requireCap } from "./helpers.js";
import { requireFeature } from "../features.js";
export function register(app) {
  app.use(
    [
      "/api/enterprises",
      "/api/me/enterprise",
      "/api/public/enterprises",
      "/api/public/capabilities",
      "/api/capabilities/search",
      "/api/supply",
      "/api/ops/supply-verification",
      "/api/requests/:id/participants",
    ],
    requireFeature("supply"),
  );
  const handle =
    (fn, { publicRead = false, reviewer = false, status = 200 } = {}) =>
    (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const me = publicRead
        ? null
        : reviewer
          ? requireCap(req, res, "moderate")
          : requireAuth(req, res);
      if (!publicRead && (!me || !req.auth?.userId)) {
        if (!res.headersSent)
          res
            .status(401)
            .json({
              error: "Sign in to use the supply network",
              code: "no_token",
            });
        return;
      }
      try {
        res.status(status).json(fn(me, req));
      } catch (e) {
        if (e instanceof supply.SupplyError || e instanceof RequestError)
          return res.status(e.status).json({ error: e.message, code: e.code });
        console.error("Supply operation failed", e);
        res
          .status(503)
          .json({
            error: "Could not save or load this record. Please retry.",
            code: "storage_unavailable",
          });
      }
    };
  app.get(
    "/api/me/enterprise",
    handle((me) => ({ enterprise: supply.myEnterprise(me) })),
  );
  app.post(
    "/api/enterprises",
    handle((me, r) => ({ enterprise: supply.createEnterprise(me, r.body) }), {
      status: 201,
    }),
  );
  // Vendor leads: the digitized manual entry of shops. No cap on how many an
  // account captures; each lead is validated only against a real row.
  app.get(
    "/api/supply/vendor-leads",
    handle((me) => ({ leads: vendorLeads.listLeads(me) })),
  );
  app.post(
    "/api/supply/vendor-leads",
    handle((me, r) => vendorLeads.createLead(me, r.body ?? {}), {
      status: 201,
    }),
  );
  app.get(
    "/api/supply/vendor-leads/:id",
    handle((me, r) => ({ lead: vendorLeads.getLead(me, r.params.id) })),
  );
  app.post(
    "/api/supply/vendor-leads/:id/validate",
    handle((me, r) => ({
      lead: vendorLeads.validateLead(me, r.params.id, r.body ?? {}),
    })),
  );
  app.post(
    "/api/supply/vendor-leads/:id/exposure-terms",
    handle((me, r) => ({
      lead: vendorLeads.setExposureTerms(me, r.params.id, r.body ?? {}),
    })),
  );
  app.post(
    "/api/supply/vendor-leads/:id/drop",
    handle((me, r) => ({
      lead: vendorLeads.dropLead(me, r.params.id, r.body ?? {}),
    })),
  );
  app.post(
    "/api/supply/vendor-leads/:id/code",
    handle((me, r) => ({ lead: vendorLeads.mintLeadCode(me, r.params.id) })),
  );
  app.get("/api/supply/lead-codes/:code", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const me = requireAuth(req, res);
    if (!me || !req.auth?.userId) return;
    try {
      return res.status(200).json({ place: vendorLeads.resolveLeadCode(me, req.params.code) });
    } catch (e) {
      if (e instanceof supply.SupplyError)
        return res.status(e.status).json({ error: e.message, code: e.code });
      console.error("Supply operation failed", e);
      return res.status(503).json({ error: "Could not save or load this record. Please retry.", code: "storage_unavailable" });
    }
  });
  app.get(
    "/api/enterprises/:id",
    handle((me, r) => ({ enterprise: supply.getEnterprise(me, r.params.id) })),
  );
  app.patch(
    "/api/enterprises/:id",
    handle((me, r) => ({
      enterprise: supply.updateEnterprise(me, r.params.id, r.body),
    })),
  );
  app.get(
    "/api/public/enterprises/:id",
    handle(
      (_, r) => ({ enterprise: supply.getEnterprise(null, r.params.id) }),
      { publicRead: true },
    ),
  );
  app.get(
    "/api/public/capabilities/:id",
    handle(
      (_, r) => ({ capability: supply.getCapability(null, r.params.id) }),
      { publicRead: true },
    ),
  );
  app.get(
    "/api/enterprises/:id/capabilities",
    handle((me, r) => ({
      capabilities: supply.listCapabilities(me, r.params.id),
    })),
  );
  app.post(
    "/api/enterprises/:id/capabilities",
    handle(
      (me, r) => ({
        capability: supply.createCapability(me, r.params.id, r.body),
      }),
      { status: 201 },
    ),
  );
  app.get(
    "/api/supply/capabilities/:id",
    handle((me, r) => ({ capability: supply.getCapability(me, r.params.id) })),
  );
  app.patch(
    "/api/supply/capabilities/:id",
    handle((me, r) => ({
      capability: supply.updateCapability(me, r.params.id, r.body),
    })),
  );
  app.delete(
    "/api/supply/capabilities/:id",
    handle((me, r) => ({
      capability: supply.updateCapability(me, r.params.id, {
        ...r.body,
        operatingStatus: "archived",
      }),
    })),
  );
  app.get(
    "/api/enterprises/:id/sourcing",
    handle((me, r) => ({
      sourcingProfile: supply.getEnterprise(me, r.params.id).sourcingProfile,
    })),
  );
  app.put(
    "/api/enterprises/:id/sourcing",
    handle((me, r) => ({
      enterprise: supply.saveSourcing(me, r.params.id, r.body),
    })),
  );
  app.get(
    "/api/capabilities/search",
    handle((me, r) => supply.searchCapabilities(me, r.query)),
  );
  app.get(
    "/api/enterprises/:id/verification",
    handle((me, r) => ({ records: verification.myRecords(me, r.params.id) })),
  );
  app.post(
    "/api/enterprises/:id/verification",
    handle(
      (me, r) => ({ record: verification.submit(me, r.params.id, r.body) }),
      { status: 201 },
    ),
  );
  app.get(
    "/api/ops/supply-verification",
    handle((me) => ({ records: verification.queue(me) }), { reviewer: true }),
  );
  app.get(
    "/api/ops/supply-verification/:id",
    handle((me, r) => ({ record: verification.record(me, r.params.id) }), {
      reviewer: true,
    }),
  );
  app.patch(
    "/api/ops/supply-verification/:id",
    handle(
      (me, r) => ({ record: verification.review(me, r.params.id, r.body) }),
      { reviewer: true },
    ),
  );
  app.get(
    "/api/requests/:id/participants",
    handle((me, r) => ({ participants: links.list(me, r.params.id) })),
  );
  app.post(
    "/api/requests/:id/participants",
    handle((me, r) => ({ participant: links.add(me, r.params.id, r.body) }), {
      status: 201,
    }),
  );
  app.delete(
    "/api/requests/:id/participants/:linkId",
    handle((me, r) => links.remove(me, r.params.id, r.params.linkId, r.body)),
  );
}
