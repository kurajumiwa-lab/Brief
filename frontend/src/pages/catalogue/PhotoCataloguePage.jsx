import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Media from "@/components/ui/Media";
import { offeringsAPI, photoCatalogueAPI, apiError } from "@/lib/api";
import { readGalleryPhoto } from "@/lib/images";

const blank = () => ({ name: "", quantity: "", price: "", unit: "", answers: [] });

export default function PhotoCataloguePage() {
  const [photos, setPhotos] = useState([]); // { file, url }: only successfully uploaded files
  const [form, setForm] = useState(blank);
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [language, setLanguage] = useState("en");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState([]);
  const set = (field) => (event) => setForm((old) => ({ ...old, [field]: event.target.value }));
  const busy = saving || uploading || analysing;

  const hasDraft = () => Boolean(form.name || form.quantity || form.price || form.unit || form.answers.some(Boolean));

  async function addPhotos(event) {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    if (!picked.length) return;
    if (selected !== null && hasDraft() && !window.confirm("Changing photos will clear the current product draft. Continue?")) return;
    setError(""); setNotice("");
    if (picked.length + photos.length > 4) return setError("Choose up to 4 photos at a time.");
    if (picked.some((f) => !f.size || f.size > 8 * 1024 * 1024)) return setError("Each photo must be under 8 MB and not empty.");
    if (selected !== null) setForm(blank());
    setUploading(true);
    const added = [];
    const failed = [];
    for (const file of picked) {
      try { added.push({ file, url: await readGalleryPhoto(file) }); }
      catch { failed.push(file.name); }
    }
    setPhotos((old) => [...old, ...added]);
    if (failed.length) setError(`Could not upload: ${failed.join(", ")}. Try again.`);
    setSuggestions([]); setSelected(null);
    setUploading(false);
  }

  async function analyse() {
    if (!photos.length || !consent || busy) return;
    if (selected !== null && hasDraft() && !window.confirm("New suggestions will clear the current product draft. Continue?")) return;
    setAnalysing(true); setError(""); setNotice("");
    try {
      const { data } = await photoCatalogueAPI.analyse(photos.map((p) => p.file), language);
      if (selected !== null) setForm(blank());
      setSuggestions(data.items || []); setSelected(null);
      setNotice(data.items?.length ? "Choose a suggestion to review it. Names and questions can be wrong." : "No products recognised. You can add them manually below.");
    } catch (err) { setError(apiError(err, "Photo analysis failed. Try again or add products manually.")); }
    finally { setAnalysing(false); }
  }

  function choose(index) {
    if (hasDraft() && !window.confirm("Replace the product you are editing with this suggestion?")) return;
    setSelected(index);
    setForm({ ...blank(), name: suggestions[index].name, answers: suggestions[index].questions.map(() => "") });
    setError("");
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const name = form.name.trim();
    const qty = Number(form.quantity);
    const price = Number(form.price);
    if (name.length < 2 || name.length > 300) return setError("Enter a product name between 2 and 300 characters.");
    if (form.quantity === "" || !Number.isSafeInteger(qty) || qty < 0 || qty > 1000000) return setError("Enter a whole stock quantity from 0 to 1,000,000.");
    if (form.price !== "" && (!Number.isFinite(price) || price < 0 || price > 10000000)) return setError("Enter a price from 0 to 10,000,000 KES, or leave it blank.");
    const questions = selected === null ? [] : suggestions[selected]?.questions || [];
    const description = questions.map((q, i) => form.answers[i]?.trim() ? `${q} ${form.answers[i].trim()}` : "").filter(Boolean).join("\n");
    if (description.length > 2000) return setError("Answers are too long. Keep them under 2,000 characters in total.");
    setError(""); setSaving(true);
    try {
      await offeringsAPI.create({ kind: "goods", title: name, quantity: qty,
        price_mode: form.price === "" ? "ask_me" : "fixed",
        ...(form.price === "" ? {} : { price }),
        ...(form.unit.trim() ? { price_unit: form.unit.trim() } : {}),
        ...(description ? { description } : {}), photos: photos.map((p) => p.url) });
      setSaved((old) => [...old, name]);
      if (selected !== null) setSuggestions((old) => old.filter((_, i) => i !== selected));
      setSelected(null); setForm(blank());
    } catch (err) { setError(apiError(err, "Could not save this product. Check your desk before retrying to avoid duplicates.")); }
    finally { setSaving(false); }
  }

  return <div className="mx-auto max-w-3xl space-y-5 p-4">
    <Link to="/desk" className="text-sm font-bold text-ink-3">← Back to my desk</Link>
    <header><h1 className="text-xl font-extrabold text-ink-1">Add products from photos</h1>
      <p className="mt-1 text-sm text-ink-3">Upload stock photos, get suggestions, and review each product before saving.</p></header>
    <Card className="space-y-3 p-4">
      <h2 className="font-bold text-ink-1">1. Add photos</h2>
      <p className="text-sm text-ink-3">Up to 4 photos, 8 MB each. Every saved product will use these photos. Uploaded photos can be accessed by anyone with their link.</p>
      <label className="block text-sm font-semibold">Choose photos <input aria-label="Choose photos" type="file" accept="image/*" multiple disabled={busy || photos.length >= 4} onChange={addPhotos} className="block mt-2 text-sm" /></label>
      {uploading && <p role="status">Uploading photos…</p>}
      <ul>{photos.map((photo, i) => <li key={photo.url} className="flex items-center gap-2 text-sm"><Media src={photo.url} alt={`Stock photo ${i + 1}`} className="h-12 w-12 rounded object-cover" /> {photo.file.name} <button type="button" disabled={busy} onClick={() => { if (selected !== null && hasDraft() && !window.confirm("Changing photos will clear the current product draft. Continue?")) return; if (selected !== null) setForm(blank()); setPhotos((old) => old.filter((_, j) => j !== i)); setSuggestions([]); setSelected(null); }} className="underline">Remove</button></li>)}</ul>
      <label className="block text-sm">Questions language <select aria-label="Questions language" value={language} disabled={busy} onChange={(e) => setLanguage(e.target.value)} className="ml-2 rounded border p-1"><option value="en">English</option><option value="sw">Kiswahili</option></select></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} /> I agree to send these photos to OpenAI for product suggestions. Do not include private information.</label>
      <Button type="button" onClick={analyse} loading={analysing} disabled={busy || !photos.length || !consent}>Recognise products</Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {suggestions.length > 0 && <div><p className="text-sm font-bold">Possible products — tap one to review</p><div className="flex flex-wrap gap-2 mt-2">{suggestions.map((item, i) => <Button key={`${item.name}-${i}`} type="button" variant="secondary" disabled={busy} onClick={() => choose(i)}>{item.name}</Button>)}</div></div>}
    </Card>
    <Card className="space-y-3 p-4">
      <h2 className="font-bold text-ink-1">2. Review and save one product</h2>
      <p className="text-sm text-ink-3">Correct the name, answer any useful questions, and add the stock and price yourself. You can also enter a product without recognition.</p>
      <form onSubmit={save} className="space-y-3" noValidate>
        <Input label="What is the product?" value={form.name} onChange={set("name")} maxLength={300} required />
        {(selected === null ? [] : suggestions[selected]?.questions || []).map((q, i) => <Input key={i} label={`${q} (optional)`} maxLength={400} value={form.answers[i] || ""} onChange={(e) => setForm((old) => ({ ...old, answers: old.answers.map((a, j) => j === i ? e.target.value : a) }))} />)}
        <Input label="How many do you have?" type="number" min="0" step="1" value={form.quantity} onChange={set("quantity")} required />
        <Input label="Price (KES, optional)" type="number" min="0" step="any" value={form.price} onChange={set("price")} />
        <Input label="Price per (optional)" placeholder="e.g. kg, bunch, piece" maxLength={50} value={form.unit} onChange={set("unit")} />
        <p className="text-xs text-ink-3">Answers become part of the public product description. Leave price blank for buyers to ask.</p>
        <Button type="submit" loading={saving} disabled={busy}>Save product</Button>
      </form>
    </Card>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {saved.length > 0 && <Card className="space-y-2 p-4" role="status"><h2 className="font-bold">Saved to your desk</h2>
      <ul className="text-sm">{saved.map((name, i) => <li key={i}>{name}</li>)}</ul>
      <p className="text-sm text-ink-3">Review another product above, or <Link className="underline" to="/desk">view and edit your offerings</Link>.</p></Card>}
  </div>;
}
