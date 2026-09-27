// WORKFORCE ROUTES — a distributed team run from phones.
//
//   worker        /api/me/work…            profile, terms, briefings, home,
//                                          claim, accept, submit, release
//   organisation  /api/workforces…         desk, territories, members, programs,
//                                          review queue
//   finance       /api/ops/workforce-…     weekly settlements (ledger-backed)
//
// Identity always comes from the session, never the body: a body naming an
// owner, a worker or a reviewer is ignored. Authority is resolved per
// workforce in the domain (owner / active supervisor / active worker), and a
// foreign id answers 404, not 403, so existence is not disclosed.
import * as wf from '../domain/workforce.js';
import * as work from '../domain/workExecution.js';
import { TEMPLATE_KEYS, getTemplate, templateView } from '../domain/workTemplates.js';
import { requireAuth, requireCap, recordAudit } from './helpers.js';
import { requireFeature } from '../features.js';

function send(res, fn, status = 200) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json(fn());
  } catch (e) {
    res.status(e.status ?? 400).json({
      error: String(e.message ?? e),
      code: e.code ?? null,
      ...(e.blockers ? { blockers: e.blockers } : {}),
      ...(e.missing ? { missing: e.missing } : {}),
      ...(e.remaining !== undefined ? { remaining: e.remaining } : {}),
      ...(e.field ? { field: e.field } : {})
    });
  }
}

export function register(app) {
  for (const prefix of ['/api/work-templates', '/api/me/work', '/api/workforces', '/api/work-programs', '/api/work-tasks', '/api/work-territories', '/api/ops/workforce-settlements']) {
    app.use(prefix, requireFeature('workforce'));
  }

  // ---- templates & terms (the evidence contract, readable by any member) --
  app.get('/api/work-templates', (req, res) => {
    if (!requireAuth(req, res)) return;
    send(res, () => ({ templates: TEMPLATE_KEYS.map((k) => templateView(getTemplate(k))), terms: wf.termsView() }));
  });

  // ---- the worker -------------------------------------------------------
  app.get('/api/me/work', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => work.workerHome(me));
  });

  app.put('/api/me/work/profile', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => ({ profile: wf.saveProfile(me, req.body ?? {}) }));
  });

  app.post('/api/me/work/terms', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => ({ profile: wf.acceptTerms(me, { version: req.body?.version }) }));
  });

  app.post('/api/me/work/briefings', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => ({ profile: wf.acknowledgeBriefing(me, req.body?.templateKey) }));
  });

  app.post('/api/me/work/join', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => ({ membership: wf.joinByCode(me, req.body?.code) }), 201);
  });

  app.post('/api/work-programs/:id/claim', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => {
      const tasks = work.claim(me, req.params.id, {
        count: req.body?.count ?? 1,
        territoryId: req.body?.territoryId ?? null,
        idempotencyKey: req.body?.idempotencyKey ?? null
      });
      return { tasks: tasks.map((t) => work.taskView(t, me)) };
    }, 201);
  });

  app.post('/api/work-tasks/:id/accept', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => ({ task: work.taskView(work.acceptOpenTask(me, req.params.id), me) }));
  });

  app.post('/api/work-tasks/:id/submit', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => {
      const proof = work.submitProof(me, req.params.id, {
        fields: req.body?.fields ?? {},
        photos: req.body?.photos ?? [],
        location: req.body?.location ?? null,
        consent: req.body?.consent ?? null,
        note: req.body?.note ?? null
      });
      return { proof, task: work.taskView(work.getTask(proof.taskId), me) };
    }, 201);
  });

  app.post('/api/work-tasks/:id/release', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => ({ task: work.releaseTask(me, req.params.id, { reason: req.body?.reason ?? '' }) }));
  });

  // ---- the organisation -------------------------------------------------
  app.get('/api/workforces', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => ({ workforces: wf.myWorkforces(me) }));
  });

  app.post('/api/workforces', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => {
      const workforce = wf.createWorkforce(me, { name: req.body?.name, description: req.body?.description ?? '' });
      recordAudit('workforce_created', { actorId: me, objectType: 'workforce', objectId: workforce.id, after: { name: workforce.name } });
      return { workforce };
    }, 201);
  });

  app.get('/api/workforces/:id', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => work.workforceDesk(req.params.id, me));
  });

  app.post('/api/workforces/:id/join-code', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => ({ joinCode: wf.rotateJoinCode(req.params.id, me).joinCode }));
  });

  app.post('/api/workforces/:id/territories', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => ({ territory: wf.createTerritory(req.params.id, me, req.body ?? {}) }), 201);
  });

  app.patch('/api/work-territories/:id', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => ({ territory: wf.updateTerritory(req.params.id, me, req.body ?? {}) }));
  });

  app.post('/api/workforces/:id/members/:memberId/actions', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => {
      const member = wf.memberAction(req.params.id, me, req.params.memberId, req.body ?? {}, {
        onRelease: (m, why) => work.releaseHeldFor(m, why)
      });
      recordAudit(`workforce_member_${req.body?.action}`, {
        actorId: me, objectType: 'workforceMember', objectId: member.id,
        after: { status: member.status, role: member.role, territoryIds: member.territoryIds },
        reason: req.body?.reason ?? null
      });
      return { member };
    });
  });

  app.post('/api/workforces/:id/programs', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => {
      const program = work.createProgram(req.params.id, me, req.body ?? {});
      recordAudit('work_program_created', { actorId: me, objectType: 'workProgram', objectId: program.id, after: { title: program.title, target: program.target, rateCard: program.rateCard } });
      return { program: work.programHeadline(program) };
    }, 201);
  });

  app.get('/api/work-programs/:id', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => work.programDashboard(req.params.id, me));
  });

  app.post('/api/work-programs/:id/status', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => {
      const program = work.changeProgramStatus(req.params.id, me, { action: req.body?.action, revision: req.body?.revision });
      recordAudit(`work_program_${req.body?.action}`, { actorId: me, objectType: 'workProgram', objectId: program.id, after: { status: program.status } });
      return { program: work.programHeadline(program) };
    });
  });

  app.get('/api/workforces/:id/review', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => ({ queue: work.reviewQueue(req.params.id, me) }));
  });

  app.post('/api/work-tasks/:id/review', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => {
      const result = work.reviewTask(me, req.params.id, { decision: req.body?.decision, reason: req.body?.reason ?? '' });
      recordAudit(`work_task_${req.body?.decision}`, { actorId: me, objectType: 'workTask', objectId: req.params.id, after: { task: result.task.status, unit: result.unit.status }, reason: req.body?.reason ?? null });
      return result;
    });
  });

  app.post('/api/workforces/:id/review/approve-clean', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    send(res, () => {
      const result = work.approveClean(me, req.params.id);
      recordAudit('work_tasks_approved_clean', { actorId: me, objectType: 'workforce', objectId: req.params.id, after: result });
      return result;
    });
  });

  // ---- finance: weekly settlements --------------------------------------
  app.get('/api/ops/workforce-settlements', (req, res) => {
    if (!requireCap(req, res, 'finance')) return;
    send(res, () => ({
      candidates: work.settlementCandidates(),
      settlements: work.listSettlements({ status: req.query?.status ? String(req.query.status) : null })
    }));
  });

  app.post('/api/ops/workforce-settlements', (req, res) => {
    const me = requireCap(req, res, 'finance');
    if (!me) return;
    send(res, () => {
      const settlement = work.requestSettlement(me, req.body?.workerId, req.body?.week);
      recordAudit('workforce_settlement_requested', { actorId: me, objectType: 'workforceSettlement', objectId: settlement.id, after: { amountKes: settlement.amountKes, tasks: settlement.tasks } });
      return { settlement };
    }, 201);
  });

  app.post('/api/ops/workforce-settlements/:id/:decision', (req, res) => {
    const me = requireCap(req, res, 'finance');
    if (!me) return;
    const decision = req.params.decision;
    if (!['confirm', 'refuse'].includes(decision)) return res.status(404).json({ error: 'not found', code: 'not_found' });
    send(res, () => {
      const settlement = work.decideSettlement(req.params.id, me, { accept: decision === 'confirm', note: req.body?.note ?? '' });
      recordAudit(`workforce_settlement_${decision}ed`, { actorId: me, objectType: 'workforceSettlement', objectId: settlement.id, after: { status: settlement.status }, reason: req.body?.note ?? null });
      return { settlement };
    });
  });
}
