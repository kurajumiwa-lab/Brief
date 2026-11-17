import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Globe, Share2 } from "lucide-react";
import { RegionCard } from "@/components/regions/RegionsGrid";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import SocialTrustEditor from "@/components/social/SocialTrustEditor";
import { professionalAPI, profileHandleAPI, apiError } from "@/lib/api";
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
  const setVendor = useAuthStore((s) => s.setVendor);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [newHandle, setNewHandle] = useState("");
  const [handleSaving, setHandleSaving] = useState(false);

  useEffect(() => {
    professionalAPI.myPage()
      .then((r) => setForm({ tagline: r.data.tagline || "", about: r.data.about || "",
        show_offers: r.data.show_offers, show_hours: r.data.show_hours, show_credentials: r.data.show_credentials,
        display_name: r.data.display_name || "", phone: r.data.phone || "", town: r.data.town || "", preset: r.data.preset || "service", discoverable: r.data.discoverable !== false, show_whatsapp: !!r.data.show_whatsapp, payment_type: r.data.payment_type || "", payment_number: r.data.payment_number || "", payment_account: r.data.payment_account || "" }))
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
      const { data } = await professionalAPI.savePage({ ...toPayload(form), display_name: form.display_name, phone: form.phone, town: form.town, preset: form.preset, discoverable: form.discoverable, show_whatsapp: form.show_whatsapp, payment_type: form.payment_type || null, payment_number: form.payment_number || null, payment_account: form.payment_account || null });
      setForm(f => ({ ...f, ...data, phone: data.phone || "", town: data.town || "", payment_type: data.payment_type || "", payment_number: data.payment_number || "", payment_account: data.payment_account || "" }));
      setVendor({ business_name: data.display_name, phone: data.phone, physical_location: data.town });
      toast.success("Your Page is saved");
    } catch (err) {
      toast.error(apiError(err, "Could not save your Page."));
    } finally {
      setSaving(false);
    }
  }

  const handle = vendor?.vendor_handle;
  const links = shareLinks({ handle, title: form.display_name || "My page" });

  async function changeVisibility(e) {
    const next = e.target.checked;
    setVisibilitySaving(true);
    try { await professionalAPI.savePage({ discoverable: next }); setForm(f => ({...f, discoverable: next})); }
    catch (err) { toast.error(apiError(err, "Could not update discovery visibility.")); }
    finally { setVisibilitySaving(false); }
  }

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
          <div className="mt-4 space-y-2"><Input label="Change page handle" placeholder="e.g. kisumu-shop" maxLength={30} value={newHandle} onChange={e=>setNewHandle(e.target.value)} hint="Letters, digits and single hyphens. Changes are limited to once every 30 days; old links redirect." /><button type="button" disabled={handleSaving || !newHandle.trim()} className="rounded-lg border border-edge-1 px-3 py-2 text-xs font-bold disabled:opacity-50" onClick={async()=>{setHandleSaving(true); try {const {data} = await profileHandleAPI.change(newHandle); setVendor({vendor_handle:data.handle}); setNewHandle(""); toast.success("Page address updated");} catch(e) {toast.error(apiError(e,"Could not change your handle."));} finally {setHandleSaving(false);} }}>Update address</button></div>
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
        <Card><CardHeader><CardTitle>Contact &amp; reachability</CardTitle></CardHeader>
          <div className="space-y-3"><Input required label="Display name" maxLength={200} value={form.display_name} onChange={set("display_name")} />
          <Input label="WhatsApp / phone number" type="tel" value={form.phone} onChange={set("phone")} hint="Kenyan mobile: 07…, 01… or +254…. Changing it resets phone verification." />
          <Input label="Primary town / corridor" maxLength={240} value={form.town} onChange={set("town")} hint="Shown publicly. Use a town or corridor, not a private address." />
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.show_whatsapp} onChange={toggle("show_whatsapp")} /> Show my number on my public Page for WhatsApp contact</label></div>
        </Card>
        <Card><CardHeader><CardTitle>Page preset</CardTitle></CardHeader><p className="text-xs text-ink-3 mb-3">Choose how your existing information is presented. Presets do not create services, stock or events.</p><div role="group" aria-label="Page preset" className="flex flex-wrap gap-2">{[["service","Service Provider"],["shop","Shop / Vendor"],["host","Event / Round Host"]].map(([value,label]) => <button type="button" key={value} aria-pressed={form.preset === value} onClick={() => setForm(f => ({...f,preset:value}))} className={`rounded-full border px-3 py-2 text-xs font-bold ${form.preset === value ? "bg-brand-700 text-white" : "border-edge-1"}`}>{label}</button>)}</div></Card>
        {form.preset === "shop" && <Card><CardHeader><CardTitle>Public payment tag</CardTitle></CardHeader><p className="text-xs text-ink-3">Optional. This number and account reference will be public. Buyers should verify the recipient before paying.</p><label className="block text-sm mt-3">M-Pesa method<select className="w-full rounded border border-edge-1 p-2" value={form.payment_type} onChange={set("payment_type")}><option value="">Do not publish</option><option value="till">Till</option><option value="paybill">Paybill</option></select></label>{form.payment_type && <div className="mt-3 space-y-3"><Input label="Till / Paybill number" inputMode="numeric" value={form.payment_number} onChange={set("payment_number")} />{form.payment_type === "paybill" && <Input label="Account reference (optional)" value={form.payment_account} onChange={set("payment_account")} />}</div>}</Card>}
        <Card><CardHeader><CardTitle>Discovery preview</CardTitle></CardHeader><div className="w-40"><RegionCard item={{ kind: "person", id: vendor?.id || "preview", to: handle ? `/p/${handle}` : "#", title: form.display_name || "Your name", category: (vendor?.business_categories || [])[0], location: form.town, owner: { ...vendor, name: form.display_name, handle } }} /></div><label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={form.discoverable} disabled={visibilitySaving} onChange={changeVisibility} /> Visible in Regions Discovery: {form.discoverable ? "ON" : "OFF"}</label><Link className="mt-2 inline-block text-sm underline" to="/regions">View live in Regions →</Link><p className="text-xs text-ink-3">Visibility updates immediately in the Regions feed. This is a profile-card preview; live results depend on filters and exclude your own listings.</p></Card>
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

      <div className="mt-6">
        <SocialTrustEditor />
      </div>
    </main>
  );
}
