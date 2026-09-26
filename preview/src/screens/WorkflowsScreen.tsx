import React, { useMemo } from 'react';
import { Briefcase, CheckCircle2, Circle } from 'lucide-react';
import * as briefApi from '../api/briefApi';
import { WORKFLOW_BUNDLES, QUEUE_CHIP, INBOX_TABS, ROOM } from '../ui/names';
import type { YardSection } from '../components/YardEngineDesk';
import { getSourceHealth, getSourceHealthLabel } from '../model/core';
import { ActionsEngine } from '../components/ActionsEngine';
import { CheckIn } from '../components/CheckIn';
import { CreatorCockpit } from '../components/CreatorCockpit';
import { EnginePanel } from '../components/EnginePanel';
import { GroupBuyPortal } from '../components/GroupBuyPortal';
import { HostCommand } from '../components/HostCommand';
import { Inbox } from '../components/Inbox';
import { MoneyPanel } from '../components/MoneyPanel';
import { PromptBanner } from '../components/SignalBanner';
import { ResaleDesk } from '../components/ResaleDesk';
import ServiceFees from '../components/ServiceFees';
import { SourcesPanel } from '../components/SourcesPanel';
import { TeaDesk } from '../components/TeaDesk';
import { TriageQueue } from '../components/TriageQueue';
import { Vault } from '../components/vault/Vault';
import { WhatsAppShopBuilder } from '../components/WhatsAppShopBuilder';
import { YardEngineDesk } from '../components/YardEngineDesk';
import type { BriefObject, CandidateStatus, Destination, Source, WorkflowSection , IngestionCandidate, Journey } from '../model/core';

// ---------------------------------------------------------------------------
// WORKFLOWS SCREEN -- extracted from App.tsx (Phase 1: JSX move; shell keeps
// state + navigation; colocation pass tightens this after). Queue / bundle /
// section switching is verbatim.
// ---------------------------------------------------------------------------

export interface WorkflowsScreenProps {
  candidates: IngestionCandidate[];
  journeys: Journey[];
  setBriefItBusy: React.Dispatch<React.SetStateAction<boolean>>;
  activeTab: Destination;
  briefItBusy: any;
  briefItPreview: any;
  briefItSaved: string | null;
  briefItText: any;
  connectorStatus: {
    online: boolean;
    checked: boolean;
    capabilities: Record<string, any> | null;
    liveSources: any[];
    stats: Record<string, any> | null;
  };
  handleAcceptCandidate: any;
  handleReceiveInbound: any;
  handleRejectCandidate: any;
  inboundBusy: any;
  loadObjects: any;
  objects: BriefObject[];
  refreshConnectors: any;
  reviewed: Record<string, CandidateStatus>;
  runBriefItSave: any;
  setBriefItPreview: React.Dispatch<React.SetStateAction<any>>;
  setBriefItSaved: React.Dispatch<React.SetStateAction<string | null>>;
  setBriefItText: any;
  setWorkflowSection: React.Dispatch<React.SetStateAction<WorkflowSection>>;
  setWorkflowView: React.Dispatch<React.SetStateAction<'queue' | 'screen'>>;
  showToast: any;
  sources: Source[];
  workflowSection: WorkflowSection;
  workflowView: 'queue' | 'screen';
}

export function WorkflowsScreen(props: WorkflowsScreenProps) {
  const {
    activeTab,
    briefItBusy,
    briefItPreview,
    briefItSaved,
    briefItText,
    connectorStatus,
    handleAcceptCandidate,
    handleReceiveInbound,
    handleRejectCandidate,
    inboundBusy,
    loadObjects,
    objects,
    refreshConnectors,
    reviewed,
    runBriefItSave,
    setBriefItPreview,
    setBriefItSaved,
    setBriefItText,
    setWorkflowSection,
    setWorkflowView,
    showToast,
    sources,
    workflowSection,
    workflowView,
    candidates,
    journeys,
    setBriefItBusy,
  } = props;

  // -- colocated from App (ownership pass) -----------------
  const activeWorkflowBundle = WORKFLOW_BUNDLES.find((b) =>
    (b.sections as readonly string[]).includes(workflowSection)
  ) ?? WORKFLOW_BUNDLES[0];

  const runBriefItPreview = async () => {
    if (!briefItText.trim()) return;
    setBriefItBusy(true);
    setBriefItSaved(null);
    try {
      const res = await briefApi.previewBriefIt(briefItText);
      setBriefItPreview(res.ok ? res.data : { error: res.error });
    } finally {
      setBriefItBusy(false);
    }
  };

  const activeJourneys = useMemo(() => journeys.filter((j) => !j.isCompleted), [journeys]);

  const completedJourneys = useMemo(() => journeys.filter((j) => j.isCompleted), [journeys]);

  const pendingCandidates = useMemo(
    () => candidates.filter((c) => !reviewed[c.id]),
    [candidates, reviewed]
  );

  return (
    <>
        {activeTab === 'workflows' && (
          <div className="max-w-3xl mx-auto px-4 pt-3 pb-1">
            <div className="flex items-end justify-between gap-2 pb-2">
              <div className="min-w-0">
                <h1 className="text-lg font-extrabold text-[var(--brief-ink)] tracking-tight">
                  {workflowView === 'queue' ? ROOM.workflows.label : `Workflows — ${activeWorkflowBundle.label}`}
                </h1>
              </div>
            </div>

            {/* The landing row. The queue is first because it is the reason you
                opened the Inbox; the bundles are the tools, filed by job. */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-2">
              <button
                onClick={() => {
                  // Back to the desk's default section as well, so the URL
                  // says /actions while the queue is what you are looking at.
                  // A path that names a tool you are not reading is a small
                  // lie, and it is what a shared link would carry.
                  setWorkflowSection('active');
                  setWorkflowView('queue');
                }}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-extrabold border cursor-pointer transition ${
                  workflowView === 'queue'
                    ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
                    : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border-[var(--brief-line)]'
                }`}
              >
                {QUEUE_CHIP}
              </button>
              {WORKFLOW_BUNDLES.map((bundle) => (
                <button
                  key={bundle.id}
                  onClick={() => {
                    setWorkflowSection(bundle.sections[0] as WorkflowSection);
                    setWorkflowView('screen');
                  }}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-extrabold border cursor-pointer transition ${
                    workflowView === 'screen' && activeWorkflowBundle.id === bundle.id
                      ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
                      : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border-[var(--brief-line)]'
                  }`}
                >
                  {bundle.label}
                </button>
              ))}
            </div>

            {workflowView === 'screen' && (
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 border-t border-[var(--brief-line)] pt-2">
                {activeWorkflowBundle.sections.map((id: any) => (
                  <button
                    key={id}
                    onClick={() => setWorkflowSection(id as WorkflowSection)}
                    className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition cursor-pointer ${
                      workflowSection === id
                        ? 'bg-[#40916C] text-[var(--accent-ink)]'
                        : 'text-[var(--ink-70)] hover:text-[var(--brief-ink)] bg-[color:var(--color-well)]'
                    }`}
                  >
                    {INBOX_TABS[id]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {workflowView === 'queue' && (
          <TriageQueue
            onOpenSection={(section) => {
              setWorkflowSection(section as WorkflowSection);
              setWorkflowView('screen');
            }}
            onNotice={(message) => showToast(message)}
          />
        )}
        {activeTab === 'workflows' &&
          workflowView === 'screen' &&
          (workflowSection === 'active' || workflowSection === 'completed') && (
          <section className="space-y-5">
            <ActionsEngine
              online={connectorStatus.online}
              checked={connectorStatus.checked}
              capabilities={connectorStatus.capabilities as any}
              liveSourceCount={connectorStatus.liveSources.length}
              stats={connectorStatus.stats as any}
            />
            <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Briefcase className="w-4 h-4 text-[var(--brief-ink)]" />
                <span className="text-[11px] text-[var(--brief-ink)]">
                  Workflows
                </span>
              </div>

              <h2 className="text-xl font-extrabold">
                Things you can actually do.
              </h2>

              <p className="text-xs text-[var(--brief-ink)] mt-1">
                {workflowSection === 'completed'
                  ? 'Processes you have already finished.'
                  : 'Follow a process instead of figuring it out from scratch.'}
              </p>
            </div>

            {(workflowSection === 'completed' ? completedJourneys : activeJourneys)
              .length === 0 && (
              workflowSection === 'completed' ? (
                <p className="text-xs text-[var(--ink-60)]">
                  Nothing finished yet. Your wins will collect here.
                </p>
              ) : (
                <PromptBanner
                  line1="Zero active. Your move."
                  line2="Connect a channel or capture the first thing — that's what fills this board."
                  action="Connect a source"
                  onAction={() => setWorkflowSection('sources')}
                />
              )
            )}

            {(workflowSection === 'completed' ? completedJourneys : activeJourneys).map((journey: any) => (
              <div
                key={journey.id}
                className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="text-[11px] text-[var(--brief-ink)]">
                        {journey.category}
                      </span>

                      <h3 className="text-lg font-extrabold mt-1">
                        {journey.title}
                      </h3>

                      <p className="text-xs text-[var(--brief-ink)] mt-1">
                        {journey.description}
                      </p>
                    </div>

                    <span className="text-xs font-bold text-[var(--brief-ink)]">
                      {journey.progressPercent}%
                    </span>
                  </div>

                  <div className="h-1.5 bg-[color:var(--color-well)] rounded-full mt-5 overflow-hidden">
                    <div
                      className="h-full bg-[#40916C] rounded-full"
                      style={{ width: `${journey.progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="border-t border-[var(--brief-line)]">
                  {journey.steps.map((step: any) => (
                    <div
                      key={step.id}
                      className="flex items-center gap-3 p-4 border-b border-[var(--brief-line)] last:border-b-0"
                    >
                      {step.isCompleted ? (
                        <CheckCircle2 className="w-5 h-5 text-[var(--brief-ink)] shrink-0" />
                      ) : (
                        <Circle className="w-5 h-5 text-[var(--ink-60)] shrink-0" />
                      )}

                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-extrabold">
                          {step.title}
                        </p>
                        <p className="text-[11px] text-[var(--ink-60)]">
                          {step.description}
                        </p>
                      </div>

                      <span className="text-[11px] text-[var(--brief-ink)]">
                        {step.statusLabel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
        {workflowView === 'screen' && workflowSection === 'money' && (
          <div className="max-w-3xl mx-auto px-4 py-6">
            <MoneyPanel />
          </div>
        )}
        {workflowView === 'screen' && workflowSection === 'resale' && (
          <ResaleDesk />
        )}
        {workflowView === 'screen' && workflowSection === 'cockpit' && (
          <div className="max-w-3xl mx-auto px-4 pt-4">
            <CreatorCockpit />
          </div>
        )}
        {workflowView === 'screen' && workflowSection === 'command' && (
          <div className="max-w-3xl mx-auto px-4 py-6">
            <HostCommand />
          </div>
        )}
        {workflowView === 'screen' && workflowSection === 'vault' && (
          <Vault />
        )}
        {workflowView === 'screen' && workflowSection === 'fees' && (
          <div className="max-w-3xl mx-auto px-4 py-6">
            <ServiceFees />
          </div>
        )}
        {workflowView === 'screen' && workflowSection === 'shop' && (
          <WhatsAppShopBuilder onOpenFees={() => setWorkflowSection('fees')} />
        )}
        {workflowView === 'screen' && workflowSection === 'tea' && (
          <div className="max-w-3xl mx-auto px-4 pt-4">
            <TeaDesk />
          </div>
        )}
        {workflowView === 'screen' && workflowSection === 'engine' && (
          <EnginePanel
            // Deltas that touch the object stream silently refresh the home
            // feed — the "never loading" feel, wired to real data.
            onObjectsChanged={() => { void loadObjects(); }}
          />
        )}
        {workflowView === 'screen' && workflowSection === 'groupbuy' && (
          <GroupBuyPortal />
        )}
        {workflowView === 'screen' && workflowSection === 'gate' && (
          <CheckIn />
        )}
        {activeTab === 'workflows' &&
          workflowView === 'screen' &&
          ['campaigns', 'matches', 'distribution', 'calendar', 'vendors', 'ai'].includes(workflowSection) && (
            <div className="max-w-3xl mx-auto px-4 py-6">
              <YardEngineDesk section={workflowSection as YardSection} />
            </div>
          )}
        {workflowView === 'screen' && workflowSection === 'sources' && (
          <SourcesPanel
            connectorStatus={connectorStatus}
            sources={sources}
            objects={objects}
            briefItText={briefItText}
            setBriefItText={setBriefItText}
            briefItPreview={briefItPreview}
            briefItBusy={briefItBusy}
            briefItSaved={briefItSaved}
            setBriefItPreview={setBriefItPreview}
            setBriefItSaved={setBriefItSaved}
            runBriefItPreview={runBriefItPreview}
            runBriefItSave={runBriefItSave}
            refreshConnectors={refreshConnectors}
            getSourceHealth={getSourceHealth}
            getSourceHealthLabel={getSourceHealthLabel}
          />
        )}
        {workflowView === 'screen' && workflowSection === 'inbox' && (
          <Inbox
            pendingCandidates={pendingCandidates}
            reviewed={reviewed}
            objects={objects}
            sources={sources}
            handleAcceptCandidate={handleAcceptCandidate}
            handleRejectCandidate={handleRejectCandidate}
            handleReceiveInbound={handleReceiveInbound}
            inboundBusy={inboundBusy}
          />
        )}
    </>
  );
}
