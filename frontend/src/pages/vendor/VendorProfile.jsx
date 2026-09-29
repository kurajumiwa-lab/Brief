import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MapPin, MessageSquare, Pencil, ShieldCheck, Crown, Plug, Package } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Stat from "@/components/ui/Stat";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import ParasitismBadge from "@/components/vendor/ParasitismBadge";
import ConnectionButton from "@/components/vendor/ConnectionButton";
import StockCard from "@/components/stock/StockCard";
import SourceDialog from "@/components/stock/SourceDialog";
import { Check } from "@/components/forms/GroupForm";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { vendorAPI, stockAPI, apiError } from "@/lib/api";
import { ROLE_BADGE, VENDOR_ROLES } from "@/config/constants";
import { num } from "@/lib/formatters";
import { splitList } from "@/lib/utils";

export default function VendorProfile() {
  const { handle } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.vendor);
  const setMe = useAuthStore((s) => s.setVendor);
  const openDirect = useChatStore((s) => s.openDirect);
  const [vendor, setVendor] = useState(null);
  const [stock, setStock] = useState([]);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [sourcing, setSourcing] = useState(null);
  const own = me?.vendor_handle === handle;

  useEffect(() => {
    let alive = true;
    setVendor(null);
    setError(null);
    (async () => {
      try {
        const [{ data: v }, { data: items }] = await Promise.all([vendorAPI.byHandle(handle), stockAPI.network({ vendor_handle: handle, limit: 60 }).catch(() => ({ data: [] }))]);
        if (!alive) return;
        setVendor(v);
        setStock(items);
        if (me?.vendor_handle === handle) {
          const { data: p } = await vendorAPI.profile();
          if (alive) setProfile(p);
        }
      } catch (e) {
        if (alive) setError(apiError(e, "Vendor not found"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [handle, me?.vendor_handle]);

  useEffect(() => {
    if (params.get("edit") && own) {
      setEditing(true);
      setParams({}, { replace: true });
    }
  }, [params, own, setParams]);

  const message = async () => {
    try {
      navigate(`/chat?room=${await openDirect(vendor.id)}`);
    } catch (e) {
      toast.error(apiError(e, "Couldn't open a direct room"));
    }
  };

  if (error) return <EmptyState title={error} description={`No vendor answers to @${handle}.`} action={<Button size="sm" onClick={() => navigate("/network")}>Back to the network</Button>} />;
  if (!vendor) return <PageSpinner />;
  const role = VENDOR_ROLES.find((r) => r.value === vendor.current_role);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-edge-1 bg-surface-1 p-5 sm:p-6 flex flex-col sm:flex-row gap-5">
        <Avatar name={vendor.business_name} size="xl" ring={own} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold text-ink-1 tracking-tight">{vendor.business_name}</h2>
            {vendor.is_verified && <ShieldCheck size={16} className="text-brand-400" title="Verified" />}
            {vendor.is_patron && (
              <Badge variant="amber" size="xs">
                <Crown size={10} /> Patron
              </Badge>
            )}
            {vendor.has_pos_connected && (
              <Badge variant="blue" size="xs">
                <Plug size={10} /> POS live
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-ink-4">
            <span className="font-mono">@{vendor.vendor_handle}</span>
            {role && (
              <Badge variant={ROLE_BADGE[role.value]} size="xs">
                {role.emoji} {role.label}
              </Badge>
            )}
            {vendor.physical_location && (
              <span className="inline-flex items-center gap-1 text-xs">
                <MapPin size={12} /> {vendor.physical_location}
              </span>
            )}
          </div>
          {vendor.business_description && <p className="text-sm text-ink-3 mt-3 leading-relaxed max-w-2xl">{vendor.business_description}</p>}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {vendor.business_categories?.map((c) => (
              <Badge key={c} variant="outline">
                {c}
              </Badge>
            ))}
          </div>
          {own && profile && (profile.primary_goods?.length > 0 || profile.sourcing_interests?.length > 0) && (
            <div className="mt-3 grid sm:grid-cols-2 gap-2 text-xs">
              <p className="text-ink-4">
                Stocks: <span className="text-ink-2">{profile.primary_goods?.join(", ") || "—"}</span>
              </p>
              <p className="text-ink-4">
                Sources: <span className="text-ink-2">{profile.sourcing_interests?.join(", ") || "—"}</span>
              </p>
            </div>
          )}
        </div>
        <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
          <ParasitismBadge index={vendor.parasitism_index} size="md" />
          <div className="flex gap-2">
            {own ? (
              <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Edit profile
              </Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" icon={MessageSquare} onClick={message}>
                  Message
                </Button>
                <ConnectionButton vendor={vendor} onChange={(c) => setVendor((v) => ({ ...v, connected: c }))} />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Network score" value={Number(vendor.network_score || 0).toFixed(1)} tone="brand" />
        <Stat label="Supplied" value={num(vendor.total_supplied || 0)} hint="movements as supplier" />
        <Stat label="Sourced" value={num(vendor.total_sourced || 0)} hint="movements as buyer" />
        <Stat label="Units moved" value={num(vendor.total_stock_moved || 0)} />
      </div>

      <section>
        <h3 className="text-sm font-semibold text-ink-1 mb-3 inline-flex items-center gap-2">
          <Package size={14} className="text-brand-400" /> {own ? "Visible on your shelf" : "On the shelf"} <span className="font-mono text-ink-4 text-xs">{stock.length}</span>
        </h3>
        {stock.length === 0 ? (
          <EmptyState compact icon={Package} title={own ? "Nothing visible to the network" : "Nothing visible right now"} description={own ? "Mark items visible in the Stock Room so vendors can source from you." : "Message them — stock might be off-network or reserved."} />
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {stock.map((item) => (
              <StockCard key={item.id} item={item} mode="network" onSource={own ? undefined : setSourcing} />
            ))}
          </div>
        )}
      </section>

      {own && (
        <EditProfileDrawer
          open={editing}
          onClose={() => setEditing(false)}
          vendor={vendor}
          profile={profile}
          onSaved={(v, p) => {
            setVendor((cur) => ({ ...cur, ...v }));
            setMe(v);
            setProfile(p);
            setEditing(false);
          }}
        />
      )}
      {!own && <SourceDialog item={sourcing} open={!!sourcing} onClose={() => setSourcing(null)} />}
    </div>
  );
}

function EditProfileDrawer({ open, onClose, vendor, profile, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open)
      setForm({
        business_name: vendor.business_name || "",
        business_description: vendor.business_description || "",
        physical_location: vendor.physical_location || "",
        business_categories: (vendor.business_categories || []).join(", "),
        primary_goods: (profile?.primary_goods || []).join(", "),
        sourcing_interests: (profile?.sourcing_interests || []).join(", "),
        preferred_regions: (profile?.preferred_regions || []).join(", "),
        accepts_bulk: profile?.accepts_bulk ?? true,
        offers_credit: profile?.offers_credit ?? false,
      });
  }, [open, vendor, profile]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async () => {
    if (!form.business_name?.trim()) return toast.error("Business name is required");
    setBusy(true);
    try {
      const [{ data: v }, { data: p }] = await Promise.all([
        vendorAPI.update({
          business_name: form.business_name.trim(),
          business_description: form.business_description.trim() || null,
          physical_location: form.physical_location.trim() || null,
          business_categories: splitList(form.business_categories),
        }),
        vendorAPI.updateProfile({
          primary_goods: splitList(form.primary_goods),
          sourcing_interests: splitList(form.sourcing_interests),
          preferred_regions: splitList(form.preferred_regions),
          accepts_bulk: !!form.accepts_bulk,
          offers_credit: !!form.offers_credit,
        }),
      ]);
      toast.success("Profile updated");
      onSaved(v, p);
    } catch (e) {
      toast.error(apiError(e, "Couldn't save the profile"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Edit profile"
      description="What you stock and what you source drives the network's suggestions."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Business name" required value={form.business_name || ""} onChange={set("business_name")} />
        <Textarea label="About" rows={3} value={form.business_description || ""} onChange={set("business_description")} />
        <Input label="Location" value={form.physical_location || ""} onChange={set("physical_location")} />
        <Input label="Categories" value={form.business_categories || ""} onChange={set("business_categories")} hint="Comma separated" />
        <div className="pt-2 border-t border-edge-1 space-y-4">
          <Input label="What you stock (primary goods)" value={form.primary_goods || ""} onChange={set("primary_goods")} placeholder="sukuma, spinach, tomatoes" hint="Comma separated" />
          <Input label="What you source (interests)" value={form.sourcing_interests || ""} onChange={set("sourcing_interests")} placeholder="vegetables, cooking oil" hint="Comma separated" />
          <Input label="Preferred regions" value={form.preferred_regions || ""} onChange={set("preferred_regions")} placeholder="Nairobi, Kiambu" hint="Comma separated" />
          <Check checked={form.accepts_bulk} onChange={set("accepts_bulk")} label="Accepts bulk orders" />
          <Check checked={form.offers_credit} onChange={set("offers_credit")} label="Offers trade credit" />
        </div>
      </div>
    </Drawer>
  );
}
