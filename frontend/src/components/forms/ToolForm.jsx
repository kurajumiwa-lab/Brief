import { useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { TOOL_CATEGORIES, PRICE_UNITS } from "@/config/constants";
import { useToolStore } from "@/stores/toolStore";
import { apiError } from "@/lib/api";
import { splitList, numOrNull } from "@/lib/utils";

export default function ToolForm({ onDone, onCancel, defaultCategory = "warehouse" }) {
  const create = useToolStore((s) => s.create);
  const [form, setForm] = useState({
    category: defaultCategory, title: "", description: "", location: "", price_per_unit: "", price_unit: "per_day", features: "", terms: "",
    capacity_value: "", capacity_unit: "", vehicle_type: "", routes: "", foot_traffic: "", hotel_name: "", cuisine: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error("Give the listing a title");
    const capacity = form.capacity_value !== "" ? { value: Number(form.capacity_value), unit: form.capacity_unit || "units" } : {};
    const payload = {
      category: form.category,
      title: form.title.trim(),
      description: form.description.trim() || null,
      location: form.location.trim() || null,
      price_per_unit: numOrNull(form.price_per_unit),
      price_unit: form.price_unit,
      capacity,
      features: splitList(form.features),
      terms: form.terms.trim() || null,
      transport: form.category === "transport" ? { vehicle_type: form.vehicle_type.trim() || null, routes: splitList(form.routes) } : {},
      popup_shop: form.category === "popup_shop" ? { foot_traffic: form.foot_traffic.trim() || null } : {},
      hotel_sourcing: form.category === "hotel_sourcing" ? { hotel_name: form.hotel_name.trim() || null, cuisine: form.cuisine.trim() || null } : {},
    };
    setBusy(true);
    try {
      const tool = await create(payload);
      toast.success(`${tool.title} is listed`);
      onDone?.(tool);
    } catch (err) {
      toast.error(apiError(err, "Couldn't list the tool"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Select label="Category" value={form.category} onChange={set("category")} options={TOOL_CATEGORIES} />
        <Input label="Title" required value={form.title} onChange={set("title")} placeholder="Gikomba dry store — 40 m²" />
      </div>
      <Textarea label="Description" value={form.description} onChange={set("description")} rows={2} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Input label="Location" value={form.location} onChange={set("location")} placeholder="Gikomba" wrapperClassName="col-span-2" />
        <Input label="Price" type="number" min="0" step="any" prefix="KES" value={form.price_per_unit} onChange={set("price_per_unit")} />
        <Select label="Per" value={form.price_unit} onChange={set("price_unit")} options={PRICE_UNITS} />
        <Input label="Capacity" type="number" min="0" step="any" value={form.capacity_value} onChange={set("capacity_value")} placeholder="40" />
        <Input label="Capacity unit" value={form.capacity_unit} onChange={set("capacity_unit")} placeholder="m², pallets, kg" />
        <Input label="Features" value={form.features} onChange={set("features")} placeholder="24h access, CCTV" hint="Comma separated" wrapperClassName="col-span-2" />
      </div>
      {form.category === "transport" && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="Vehicle" value={form.vehicle_type} onChange={set("vehicle_type")} placeholder="tuk-tuk, 3-tonne lorry" />
          <Input label="Routes" value={form.routes} onChange={set("routes")} placeholder="Gikomba → Eastlands" hint="Comma separated" />
        </div>
      )}
      {form.category === "popup_shop" && <Input label="Foot traffic" value={form.foot_traffic} onChange={set("foot_traffic")} placeholder="~2,000 / day, weekends busiest" />}
      {form.category === "hotel_sourcing" && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="Hotel" value={form.hotel_name} onChange={set("hotel_name")} />
          <Input label="Cuisine / needs" value={form.cuisine} onChange={set("cuisine")} placeholder="fresh vegetables daily" />
        </div>
      )}
      <Textarea label="Terms" value={form.terms} onChange={set("terms")} rows={2} placeholder="Deposit, minimum booking, cancellation…" />
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={busy}>
          List tool
        </Button>
      </div>
    </form>
  );
}

/** Register your delivery service; the API mirrors it as a courier tool listing. */
export function CourierForm({ onDone, onCancel }) {
  const registerCourier = useToolStore((s) => s.registerCourier);
  const [form, setForm] = useState({ courier_name: "", coverage_areas: "", service_types: "same_day", price_per_kg: "", base_rate: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.courier_name.trim()) return toast.error("Name your courier service");
    setBusy(true);
    try {
      const res = await registerCourier({
        courier_name: form.courier_name.trim(),
        coverage_areas: splitList(form.coverage_areas),
        service_types: splitList(form.service_types),
        price_per_kg: numOrNull(form.price_per_kg),
        base_rate: numOrNull(form.base_rate),
      });
      toast.success(res?.message || "Courier registered");
      onDone?.(res);
    } catch (err) {
      toast.error(apiError(err, "Couldn't register the courier"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="Courier name" required value={form.courier_name} onChange={set("courier_name")} placeholder="Boda Express" />
      <Input label="Coverage areas" value={form.coverage_areas} onChange={set("coverage_areas")} placeholder="CBD, Eastlands, Westlands" hint="Comma separated" />
      <Input label="Service types" value={form.service_types} onChange={set("service_types")} placeholder="same_day, next_day, bulk" hint="Comma separated" />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Price per kg" type="number" min="0" step="any" prefix="KES" value={form.price_per_kg} onChange={set("price_per_kg")} />
        <Input label="Base rate" type="number" min="0" step="any" prefix="KES" value={form.base_rate} onChange={set("base_rate")} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={busy}>
          Register courier
        </Button>
      </div>
    </form>
  );
}
