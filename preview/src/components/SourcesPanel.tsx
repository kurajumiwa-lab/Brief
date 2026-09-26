import React from 'react';
import type { BriefObject, Source, SourceHealth } from '../App';

/**
 * SOURCES + BRIEF-IT.
 *
 * Where Brief receives information from, and the manual capture box.
 * Extracted from App.tsx with behaviour and styling unchanged.
 *
 * Both halves now talk to the server through briefApi (getSources,
 * previewBriefIt, saveBriefIt) rather than inline fetch calls. Brief-it stays
 * deliberately two-step: preview reads and shows what would be extracted,
 * save is the only call that writes anything.
 */

export interface ConnectorStatus {
  online: boolean;
  checked: boolean;
  capabilities: Record<string, any> | null;
  liveSources: any[];
  stats: Record<string, any> | null;
}

export interface SourcesPanelProps {
  connectorStatus: ConnectorStatus;
  sources: Source[];
  objects: BriefObject[];
  briefItText: string;
  setBriefItText: (v: string) => void;
  briefItPreview: any;
  briefItBusy: boolean;
  briefItSaved: string | null;
  setBriefItPreview: (v: any) => void;
  setBriefItSaved: (v: string | null) => void;
  runBriefItPreview: () => void;
  runBriefItSave: () => void;
  refreshConnectors: () => void;
  getSourceHealth: (s: Source, now?: Date) => SourceHealth;
  getSourceHealthLabel: (h: SourceHealth) => string;
}

export function SourcesPanel({
  connectorStatus,
  sources,
  objects,
  briefItText,
  setBriefItText,
  briefItPreview,
  briefItBusy,
  briefItSaved,
  setBriefItPreview,
  setBriefItSaved,
  runBriefItPreview,
  runBriefItSave,
  refreshConnectors,
  getSourceHealth,
  getSourceHealthLabel
}: SourcesPanelProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-[var(--brief-ink)]">Sources</h2>
        <p className="text-[12px] text-[var(--ink-60)] leading-snug mt-1">
          Where Brief receives information from. A channel is not the
          information -- Brief only keeps what it can structure.
        </p>
      </div>

      {/* BRIEF IT (spec 16/17). Paste anything; Brief shows what it
          found and writes nothing until you choose to save. */}
      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4">
        <p className="text-[11px] text-[var(--brief-ink)]">Brief it</p>
        <p className="text-[12px] text-[var(--ink-60)] mt-1 leading-snug">
          Paste a message, listing or announcement. Brief structures it
          and shows you the result before anything is saved.
        </p>
        <textarea
          value={briefItText}
          onChange={(e) => setBriefItText(e.target.value)}
          rows={4}
          placeholder="Saturday popup at Kilimani Studio. 12 vendors. KES 300 entry. 4PM-10PM."
          className="w-full mt-2 bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl p-3 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)]"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={runBriefItPreview}
            disabled={briefItBusy || !briefItText.trim()}
            className="px-3 py-1.5 rounded-full text-[12px] font-extrabold bg-[#40916C] text-[var(--accent-ink)] cursor-pointer disabled:opacity-40"
          >
            {briefItBusy ? 'Reading...' : 'Brief it'}
          </button>
          {briefItPreview && !briefItPreview.error && briefItPreview.worthy && (
            <button
              onClick={runBriefItSave}
              disabled={briefItBusy}
              className="px-3 py-1.5 rounded-full text-[12px] font-extrabold bg-[color:var(--color-paper)] text-[var(--brief-ink)] border border-[var(--brief-line)] cursor-pointer"
            >
              Save to Brief
            </button>
          )}
          {briefItPreview && (
            <button
              onClick={() => { setBriefItPreview(null); setBriefItSaved(null); }}
              className="text-[12px] font-extrabold text-[var(--ink-60)] cursor-pointer"
            >
              Discard
            </button>
          )}
        </div>

        {briefItSaved && (
          <p className="text-[12px] text-[var(--brief-ink)] mt-2">{briefItSaved}</p>
        )}

        {briefItPreview?.error && (
          <p className="text-[12px] text-[var(--brief-ink)] mt-2">{briefItPreview.error}</p>
        )}

        {briefItPreview && !briefItPreview.error && (
          <div className="mt-3 bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl p-3">
            {!briefItPreview.worthy ? (
              <p className="text-[12px] text-[var(--brief-ink)]">
                Nothing object-worthy found. Brief will not invent a
                record from this.
              </p>
            ) : (
              <>
                <p className="text-[11px] font-extrabold text-[var(--brief-ink)]">
                  Found
                </p>
                <div className="mt-1.5 space-y-1">
                  {Object.entries(briefItPreview.fields ?? {}).map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3">
                      <span className="text-[11px] text-[var(--ink-60)]">{k}</span>
                      <span className="text-[12px] text-[var(--brief-ink)] text-right truncate">
                        {Array.isArray(v) ? v.join(', ') : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
                {(briefItPreview.vendors?.length > 0 || briefItPreview.products?.length > 0) && (
                  <div className="mt-2 pt-2 border-t border-[var(--brief-line)] space-y-0.5">
                    {briefItPreview.vendors?.map((v: string) => (
                      <p key={v} className="text-[11px] text-[var(--brief-ink)]">Vendor: {v}</p>
                    ))}
                    {briefItPreview.products?.map((pr: any) => (
                      <p key={pr.name} className="text-[11px] text-[var(--brief-ink)]">
                        Product: {pr.name} - {pr.currency} {pr.price.toLocaleString()}
                      </p>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-[var(--ink-60)] mt-2">
                  Extraction confidence {Math.round((briefItPreview.confidence ?? 0) * 100)}%.
                  Nothing has been saved yet.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* CONNECTOR DASHBOARD (spec 25/26/27). Reports what the backend
          genuinely supports, including what it cannot do. */}
      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-[var(--brief-ink)]">Connectors</p>
          <button
            onClick={() => void refreshConnectors()}
            className="text-[11px] font-extrabold text-[var(--brief-ink)] cursor-pointer"
          >
            Refresh
          </button>
        </div>

        {!connectorStatus.checked && (
          <p className="text-[12px] text-[var(--ink-60)] mt-2">Checking...</p>
        )}

        {connectorStatus.checked && !connectorStatus.online && (
          <p className="text-[12px] text-[var(--brief-ink)] mt-2 leading-snug">
            Ingestion server not reachable. Brief still works -- only live
            connectors are unavailable. Start it with{' '}
            <span className="text-[var(--brief-ink)]">npm start</span> in
            the server directory.
          </p>
        )}

        {connectorStatus.online && connectorStatus.capabilities && (
          <>
            <div className="mt-2 space-y-2">
              {Object.entries(connectorStatus.capabilities).map(([name, cap]: [string, any]) => {
                const unsupported = Object.entries(cap).filter(
                  ([, v]) => typeof v === 'string' && v.startsWith('NO')
                );
                const configured = cap.configured;
                return (
                  <div key={name} className="bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-[var(--brief-ink)] capitalize">{name}</span>
                      <span
                        className={`text-[11px] font-extrabold ${
                          configured === false ? 'text-[var(--brief-ink)]' : 'text-[var(--brief-ink)]'
                        }`}
                      >
                        {configured === false ? 'Needs authorization' : 'Available'}
                      </span>
                    </div>
                    {cap.receive && (
                      <p className="text-[11px] text-[var(--ink-60)] mt-1">Receive: {cap.receive}</p>
                    )}
                    {/* Failed capabilities are shown, not hidden (spec 27). */}
                    {unsupported.map(([k, v]) => (
                      <p key={k} className="text-[11px] text-[var(--brief-ink)] mt-0.5">
                        {k}: {String(v)}
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>

            {connectorStatus.stats && (
              <p className="text-[11px] text-[var(--ink-60)] mt-2">
                {connectorStatus.stats.rawItems} raw items -{' '}
                {connectorStatus.stats.objects} objects -{' '}
                {connectorStatus.stats.relationships} links -{' '}
                {connectorStatus.stats.errors} errors
              </p>
            )}

            {connectorStatus.liveSources.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--brief-line)]">
                <p className="text-[11px] font-extrabold text-[var(--brief-ink)]">
                  Connected sources
                </p>
                <div className="mt-1.5 space-y-1">
                  {connectorStatus.liveSources.map((src: any) => (
                    <div key={src.id} className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] text-[var(--brief-ink)] truncate">{src.name}</span>
                      <span className="text-[11px] text-[var(--ink-60)] shrink-0">
                        {src.platform} - {src.itemsProcessed} processed
                        {src.objectsCreated > 0 ? ` - ${src.objectsCreated} objects` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {sources.map((source) => {
        const health = getSourceHealth(source);
        const tone =
          health === 'healthy'
            ? 'text-[var(--brief-ink)]'
            : health === 'error'
            ? 'text-[var(--brief-ink)]'
            : 'text-[var(--brief-ink)]';

        return (
          <div
            key={source.id}
            className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-[var(--brief-ink)]">
                  {source.name}
                </p>
                <p className="text-[11px] text-[var(--ink-60)] mt-0.5">
                  {source.type}
                </p>
              </div>
              <span className={`text-[11px] font-bold shrink-0 ${tone}`}>
                {getSourceHealthLabel(health)}
              </span>
            </div>

            {source.description && (
              <p className="text-[11px] text-[var(--ink-60)] leading-snug">
                {source.description}
              </p>
            )}

            <div className="flex items-center gap-4 pt-1">
              <span className="text-[11px] text-[var(--ink-60)]">
                {source.ingestionCount} received
              </span>
              {source.lastSuccessfulIngestionAt && (
                <span className="text-[11px] text-[var(--ink-60)]">
                  last {source.lastSuccessfulIngestionAt.slice(0, 10)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
