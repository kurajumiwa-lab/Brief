import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Globe, Share2 } from "lucide-react";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { professionalAPI, apiError } from "@/lib/api";
import { pageAddress, shareLinks } from "@/lib/pageShare";
import { useAuthStore } from "@/stores/authStore";
import {
  ABOUT_MAX, SECTION_OPTIONS, TAGLINE_MAX, aboutSource, toPayload, validatePage,
} from "./pageEditorRules";

/**
 * PUBLIC PAGE EDITOR — /my-page. The owner edits their own Page: a tagline, About text
 * (blank = the business description), and which sections show. Only the owner can save.
 */
export default function PageEditor() {
  const vendor = useAuthStore((s) => s.vendor);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    professionalAPI.myPage()
      .then((r) => setForm({ tagline: r.data.tagline || "", about: r.data.about || "",
        show_offers: r.data.show_offers, show_hours: r.data.show_hours, show_credentials: r.data.show_credentials }))
      .catch((e) => toast.error(apiError(e, "Could not load your Page.")));
  }, []);

  if (!form) return <PageSpinner />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));

  async function save(e) {
    e.preventDefault();
    const problem = validatePage(form);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      await professionalAPI.savePage(toPayload(form));
      toast.success("Your Page is saved");
    } catch (err) {
      toast.error(apiError(err, "Could not save your Page."));
    } finally {
      setSaving(false);
    }
  }

  const handle = vendor?.vendor_handle;
  const links = shareLinks({ handle, title: vendor?.business_name || "My page", phone: vendor?.phone || "" });

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(links.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // The address stays visible and selectable.
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your Page</h1>
          <p className="text-sm text-ink-3 mt-1">What strangers see on your public Page. Only you can change it.</p>
        </div>
        {handle && <Link to={`/p/${handle}`} className="text-sm text-brand-700 underline whitespace-nowrap">View Page</Link>}
      </header>

      {handle && (
        <Card>
          <CardHeader><CardTitle>Page address</CardTitle></CardHeader>
          <p className="text-xs text-ink-3">
            Your page has its own address. Share it with a customer, a group or a
            colleague — the links below already carry the page.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-edge-1 bg-surface-0 px-3 py-2">
            <Globe size={14} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
            <code className="min-w-0 flex-1 truncate text-micro font-semibold text-ink-2">
              {pageAddress(handle)}
            </code>
            <button
              type="button"
              onClick={copyAddress}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-micro font-bold text-ink-3 hover:bg-surface-2 hover:text-ink-1"
            >
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              to={`/p/${handle}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge-1 bg-surface-0 px-2.5 py-1.5 text-micro font-bold text-ink-2 hover:border-edge-2"
            >
              Open page
            </Link>
            <a
              href={links.whatsapp}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 px-2.5 py-1.5 text-micro font-bold text-[#128C4A] hover:bg-[#25D366]/15 dark:text-[#5BE39A]"
            >
              <Share2 size={12} aria-hidden="true" /> Share on WhatsApp
            </a>
          </div>
        </Card>
      )}

      <form onSubmit={save} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Headline</CardTitle></CardHeader>
          <Input label="Tagline (optional)" value={form.tagline} onChange={set("tagline")} maxLength={TAGLINE_MAX}
            hint={`${form.tagline.length} / ${TAGLINE_MAX}`} />
        </Card>

        <Card>
          <CardHeader><CardTitle>About</CardTitle></CardHeader>
          <Textarea label="About (optional)" rows={5} value={form.about} onChange={set("about")} maxLength={ABOUT_MAX}
            hint={`${form.about.length} / ${ABOUT_MAX}. Leave blank to show ${aboutSource(form, vendor?.business_description)}.`} />
        </Card>

        <Card>
          <CardHeader><CardTitle>Sections</CardTitle></CardHeader>
          <div className="space-y-3">
            {SECTION_OPTIONS.map((o) => (
              <label key={o.key} className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" className="mt-1" checked={form[o.key]} onChange={toggle(o.key)} />
                <span>
                  <span className="font-medium">{o.label}</span>
                  <span className="block text-xs text-ink-3">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save Page"}</Button>
        </div>
      </form>
    </main>
  );
}
