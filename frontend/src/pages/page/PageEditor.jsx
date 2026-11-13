import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { professionalAPI, apiError } from "@/lib/api";
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

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your Page</h1>
          <p className="text-sm text-ink-3 mt-1">What strangers see on your public Page. Only you can change it.</p>
        </div>
        {handle && <Link to={`/page/${handle}`} className="text-sm text-brand-700 underline whitespace-nowrap">View Page</Link>}
      </header>

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
