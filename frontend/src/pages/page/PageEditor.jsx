import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Eye, Globe, Share2, X } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import {
  ABOUT_MAX, SECTION_OPTIONS, TAGLINE_MAX, aboutSource, toPayload, validatePage,
} from "./pageEditorRules";

/**
 * The comparable part of the form. Used only to answer "is there anything to
 * save?" — never sent anywhere. Key order is fixed by construction, so two
 * identical forms always produce the same string.
 */
function formSnapshot(form) {
  if (!form) return "";
  return JSON.stringify({
    display_name: form.display_name, phone: form.phone, town: form.town,
    tagline: form.tagline, about: form.about, preset: form.preset,
    discoverable: form.discoverable, show_whatsapp: form.show_whatsapp,
    show_offers: form.show_offers, show_hours: form.show_hours,
    show_credentials: form.show_credentials,
    payment_type: form.payment_type, payment_number: form.payment_number,
    payment_account: form.payment_account,
  });
}

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
  // What was last saved, so the bar can say honestly whether there is anything
  // to save. A form that never admits to being dirty makes people hunt for a
  // button; one that does makes the next step obvious.
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    professionalAPI.myPage()
      .then((r) => {
        const loaded = { tagline: r.data.tagline || "", about: r.data.about || "",
          show_offers: r.data.show_offers, show_hours: r.data.show_hours, show_credentials: r.data.show_credentials,
          display_name: r.data.display_name || "", phone: r.data.phone || "", town: r.data.town || "", preset: r.data.preset || "service", discoverable: r.data.discoverable !== false, show_whatsapp: !!r.data.show_whatsapp, payment_type: r.data.payment_type || "", payment_number: r.data.payment_number || "", payment_account: r.data.payment_account || "" };
        setForm(loaded);
        setSaved(formSnapshot(loaded));
      })
      .catch((e) => toast.error(apiError(e, "Could not load your Page.")));
  }, []);

  if (!form) return <PageSpinner />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));

  // Called from the form's submit and from the fixed save bar, so the event is
  // optional: one function, one save, whichever button was pressed.
  async function save(e) {
    e?.preventDefault();
    const problem = validatePage(form);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      const { data } = await professionalAPI.savePage({ ...toPayload(form), display_name: form.display_name, phone: form.phone, town: form.town, preset: form.preset, discoverable: form.discoverable, show_whatsapp: form.show_whatsapp, payment_type: form.payment_type || null, payment_number: form.payment_number || null, payment_account: form.payment_account || null });
      const next = {
        ...form, ...data,
        phone: data.phone || "", town: data.town || "",
        payment_type: data.payment_type || "", payment_number: data.payment_number || "",
        payment_account: data.payment_account || "",
      };
      setForm(next);
      // The bar goes back to "All changes saved" from the form the server echoed,
      // not from what was sent — otherwise a normalised field reads as dirty.
      setSaved(formSnapshot(next));
      setVendor({ business_name: data.display_name, phone: data.phone, physical_location: data.town });
      toast.success("Page saved. It is live now.");
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
    try {
      await professionalAPI.savePage({ discoverable: next });
      setForm((f) => ({ ...f, discoverable: next }));
      // This toggle saves on its own, so the baseline moves with it — otherwise
      // the save bar would keep saying "unsaved changes" for a change already saved.
      setSaved((prev) => {
        if (prev === null) return prev;
        return formSnapshot({ ...form, discoverable: next });
      });
    }
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

  const dirty = saved !== null && formSnapshot(form) !== saved;

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 pb-28 pt-6">
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
        <Card>
          <CardHeader><CardTitle>How customers pay you</CardTitle></CardHeader>
          <p className="text-xs text-ink-3">
            Optional. Publish your own Till or Paybill on the Page for shops and
            services. An event asks for its own payment method when you publish it,
            because each event has its own price. The money goes straight to you;
            Home Office never collects or holds it, so a client should still check
            the recipient before paying.
          </p>
          <label className="block text-sm mt-3">
            M-Pesa method
            <select className="w-full rounded border border-edge-1 p-2" value={form.payment_type} onChange={set("payment_type")}>
              <option value="">Do not publish</option>
              <option value="till">Till</option>
              <option value="paybill">Paybill</option>
            </select>
          </label>
          {form.payment_type && (
            <div className="mt-3 space-y-3">
              <Input label="Till / Paybill number" inputMode="numeric" value={form.payment_number} onChange={set("payment_number")} />
              {form.payment_type === "paybill" && <Input label="Account reference (optional)" value={form.payment_account} onChange={set("payment_account")} />}
            </div>
          )}
        </Card>
        {/* WHO CAN SEE THIS — answered in words before it is answered in a
            toggle. "Discovery preview" showed the mechanism and left the person
            to infer the consequence; this says the consequence first, then
            offers the switch, then shows the card it produces. */}
        <Card data-testid="page-visibility">
          <CardHeader><CardTitle>Who can see your page</CardTitle></CardHeader>
          <ul className="space-y-2 text-sm text-ink-2">
            <li className="flex gap-2">
              <Check size={15} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
              <span>
                <strong className="font-semibold text-ink-1">Anyone with the link</strong> — the page goes
                live as soon as you save it, at{" "}
                <span className="font-mono text-xs text-ink-1">{handle ? `/p/${handle}` : "your address"}</span>.
                This never turns off.
              </span>
            </li>
            <li className="flex gap-2">
              {form.discoverable
                ? <Check size={15} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
                : <X size={15} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />}
              <span>
                {form.discoverable ? (
                  <>
                    <strong className="font-semibold text-ink-1">People browsing Regions</strong> can find
                    you by town and category. This is switched <strong>on</strong>.
                  </>
                ) : (
                  <>
                    <strong className="font-semibold text-ink-1">Not in Regions.</strong> People cannot find
                    you by browsing — only the direct link works. This is switched <strong>off</strong>.
                  </>
                )}
              </span>
            </li>
            <li className="flex gap-2">
              <Check size={15} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
              <span>
                You can switch discovery off at any time. The page stays up; it just stops being
                findable by browsing.
              </span>
            </li>
          </ul>

          <label className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.discoverable}
              disabled={visibilitySaving}
              onChange={changeVisibility}
              data-testid="page-discoverable"
            />
            <span>
              Let people find me by browsing Regions
              <span className="mt-0.5 block text-2xs text-ink-3">
                Saves the moment you tick it. This one does not wait for the save bar.
              </span>
            </span>
          </label>

          <div className="mt-4 flex items-end gap-3">
            <div className="w-40 shrink-0" aria-hidden="true">
              <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-ink-4">Your card in Regions</p>
              <RegionCard item={{ kind: "person", id: vendor?.id || "preview", to: handle ? `/p/${handle}` : "#", title: form.display_name || "Your name", category: (vendor?.business_categories || [])[0], location: form.town, owner: { ...vendor, name: form.display_name, handle } }} />
            </div>
            <Link className="text-xs font-semibold text-brand-700 hover:underline" to="/regions">
              See the live Regions feed →
            </Link>
          </div>
          <p className="mt-3 text-micro text-ink-4">
            The card is a preview of your shape, not a search result. Live results depend on the filters a
            person chose and never include your own listings.
          </p>
        </Card>
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

        <p className="text-micro text-ink-4">
          Everything on this screen is one page, so there is one save. The bar at the
          bottom is always within reach.
        </p>
      </form>

      {/* The save bar. Fixed rather than inline: the form is long, the tab bar
          covers the bottom of a phone, and a primary action you have to scroll
          to find reads as "there is no save". It sits above the tab bar (z-40). */}
      <div
        data-testid="page-save-bar"
        className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-40 px-3 lg:bottom-4"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-edge-1 bg-surface-1/95 p-2 shadow-lg backdrop-blur">
          <span
            className={cn(
              "min-w-0 flex-1 pl-1 text-micro font-semibold",
              dirty ? "text-accent-700 dark:text-accent-300" : "text-ink-4",
            )}
          >
            {dirty ? "Unsaved changes" : saved === null ? "Loading…" : "All changes saved"}
          </span>
          {handle && (
            <Link
              to={`/p/${handle}`}
              className="hidden shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-micro font-bold text-ink-3 hover:bg-surface-2 hover:text-ink-1 sm:inline-flex"
            >
              <Eye size={12} aria-hidden="true" /> Preview
            </Link>
          )}
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={saving || !dirty}
            data-testid="page-save"
          >
            {saving ? "Saving…" : dirty ? "Save page" : "Saved"}
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <SocialTrustEditor />
      </div>
    </main>
  );
}
