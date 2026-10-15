import { useEffect, useRef, useState } from "react";
import { Building2, CheckCircle2, Eye, ImagePlus, Lock, ShieldCheck, User, Users, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toast";
import { useChatStore, DEFAULT_CHAT_IDENTITY } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { apiError, fileAPI } from "@/lib/api";
import { cn } from "@/lib/utils";

export const CHAT_IDENTITY_MODES = [
  {
    value: "personal_photo",
    label: "Personal profile photograph",
    shortLabel: "Personal photo",
    description: "Display your personal photograph or personal avatar as the primary sender identity.",
    icon: User,
  },
  {
    value: "business_logo",
    label: "Business logo",
    shortLabel: "Business logo",
    description: "Represent the company directly using the official business logo emblem.",
    icon: Building2,
  },
  {
    value: "combined",
    label: "Personal photograph + business logo",
    shortLabel: "Photo + business logo",
    description: "Show your personal photograph as the primary sender avatar with the business logo as a secondary corner marker.",
    icon: Users,
  },
  {
    value: "business_with_role",
    label: "Business identity with sender name & role",
    shortLabel: "Business + name & role",
    description: "Lead with the business identity alongside your personal name and verified role title.",
    icon: ShieldCheck,
  },
];

const ROLE_OPTIONS = [
  { value: "Owner", label: "Owner" },
  { value: "Managing Director", label: "Managing Director" },
  { value: "Procurement Lead", label: "Procurement Lead" },
  { value: "Sales & Fulfilment", label: "Sales & Fulfilment" },
  { value: "Warehouse Manager", label: "Warehouse Manager" },
  { value: "Finance Officer", label: "Finance Officer" },
];

const LOCATION_OPTIONS = [
  {
    key: "conversation_list",
    label: "Conversation lists",
    hint: "Room list avatars and sender subtitles",
  },
  {
    key: "message_header",
    label: "Message headers",
    hint: "Active chat header identity bar",
  },
  {
    key: "messages",
    label: "Individual messages",
    hint: "Sender avatar and role badge on each message bubble",
  },
];

/**
 * Helper to resolve how a participant or message sender should be displayed
 * given the configured chat identity and display location.
 */
export function resolveIdentityDisplay({
  vendor,
  chatIdentity = DEFAULT_CHAT_IDENTITY,
  location = "messages",
  senderBusiness,
  senderHandle,
  senderName,
  senderRole,
  avatarUrl,
  logoUrl,
}) {
  const cfg = chatIdentity || DEFAULT_CHAT_IDENTITY;
  const activeMode =
    cfg.scope === "personal" && cfg.personal_override?.mode
      ? cfg.personal_override.mode
      : cfg.mode || "combined";

  const enabledInLocation = cfg.locations?.[location] !== false;
  const effectiveMode = enabledInLocation ? activeMode : "business_logo";

  const business = senderBusiness || vendor?.business_name || senderHandle || "Vendor";
  const handle = senderHandle || vendor?.vendor_handle || "vendor";
  const personal = senderName || cfg.sender_name || business;
  const role = senderRole || cfg.sender_role || "Owner";
  const resolvedAvatar = avatarUrl ?? cfg.avatar_url ?? "";
  const resolvedLogo = logoUrl ?? cfg.logo_url ?? "";

  let primaryTitle = business;
  let secondarySubtitle = `@${handle}`;

  if (effectiveMode === "personal_photo") {
    primaryTitle = personal || business;
    secondarySubtitle = `${business} · @${handle}`;
  } else if (effectiveMode === "business_logo") {
    primaryTitle = business;
    secondarySubtitle = `@${handle}`;
  } else if (effectiveMode === "combined") {
    primaryTitle = personal && personal !== business ? `${personal} · ${business}` : business;
    secondarySubtitle = role ? `${role} · @${handle}` : `@${handle}`;
  } else if (effectiveMode === "business_with_role") {
    primaryTitle = business;
    secondarySubtitle = `${personal || `@${handle}`} (${role || "Representative"})`;
  }

  return {
    mode: effectiveMode,
    primaryTitle,
    secondarySubtitle,
    personalName: personal,
    businessName: business,
    roleTitle: role,
    handle,
    avatarUrl: resolvedAvatar,
    logoUrl: resolvedLogo,
  };
}

export default function ChatIdentityModal({ open, onClose }) {
  const vendor = useAuthStore((s) => s.vendor);
  const chatIdentity = useChatStore((s) => s.chatIdentity);
  const saveIdentity = useChatStore((s) => s.saveIdentity);

  // Business owners / admins can edit organization-wide identity settings;
  // non-admin seat members can set personal preferences.
  const canManageOrg = !vendor?.seat_role || ["owner", "admin"].includes(String(vendor.seat_role).toLowerCase());

  const [form, setForm] = useState(DEFAULT_CHAT_IDENTITY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      ...DEFAULT_CHAT_IDENTITY,
      ...chatIdentity,
      sender_name: chatIdentity?.sender_name || vendor?.contact_name || vendor?.business_name || "",
      sender_role: chatIdentity?.sender_role || "Owner",
      scope: canManageOrg ? chatIdentity?.scope || "organization" : "personal",
      locations: {
        ...DEFAULT_CHAT_IDENTITY.locations,
        ...(chatIdentity?.locations || {}),
      },
    });
  }, [open, chatIdentity, vendor, canManageOrg]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const toggleLocation = (locKey) => {
    setForm((f) => ({
      ...f,
      locations: {
        ...f.locations,
        [locKey]: !f.locations?.[locKey],
      },
    }));
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        scope: canManageOrg ? form.scope : "personal",
        personal_override:
          form.scope === "personal"
            ? {
                mode: form.mode,
                sender_name: form.sender_name,
                sender_role: form.sender_role,
              }
            : form.personal_override,
      };
      await saveIdentity(payload);
      toast.success(
        payload.scope === "organization"
          ? "Organization chat identity saved"
          : "Personal chat identity preference saved"
      );
      onClose?.();
    } catch (err) {
      toast.error(apiError(err, "Couldn't save chat identity settings"));
    } finally {
      setBusy(false);
    }
  };

  const previewList = resolveIdentityDisplay({
    vendor,
    chatIdentity: form,
    location: "conversation_list",
  });
  const previewHeader = resolveIdentityDisplay({
    vendor,
    chatIdentity: form,
    location: "message_header",
  });
  const previewMessage = resolveIdentityDisplay({
    vendor,
    chatIdentity: form,
    location: "messages",
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Chat identity & branding"
      description="Configure how your personal photograph, business logo, name, and role appear across conversations."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={busy} disabled={busy}>
            Save identity settings
          </Button>
        </>
      }
    >
      <form onSubmit={handleSave} className="space-y-5">
        {/* Scope: Organization-wide vs Personal preference */}
        <div className="rounded-xl border border-edge-1 bg-surface-1 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-semibold text-ink-1">Setting scope</span>
            {canManageOrg ? (
              <Badge variant="brand" size="xs">
                <ShieldCheck size={11} /> Owner / Admin permissions
              </Badge>
            ) : (
              <Badge variant="amber" size="xs">
                <Lock size={11} /> Seat member · Personal preference only
              </Badge>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Identity setting scope">
            <button
              type="button"
              disabled={!canManageOrg}
              onClick={() => setField("scope", "organization")}
              aria-pressed={form.scope === "organization"}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                form.scope === "organization"
                  ? "border-brand-600 bg-surface-0 shadow-2xs"
                  : "border-edge-1 bg-surface-0/60 hover:border-edge-2",
                !canManageOrg && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink-1">Organization-wide default</span>
                {form.scope === "organization" && <CheckCircle2 size={14} className="text-brand-600" />}
              </div>
              <p className="text-2xs text-ink-3 mt-1">
                Sets the shared business logo and default sender presentation for {vendor?.business_name || "your business"}.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setField("scope", "personal")}
              aria-pressed={form.scope === "personal"}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                form.scope === "personal"
                  ? "border-brand-600 bg-surface-0 shadow-2xs"
                  : "border-edge-1 bg-surface-0/60 hover:border-edge-2"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink-1">Personal preference</span>
                {form.scope === "personal" && <CheckCircle2 size={14} className="text-brand-600" />}
              </div>
              <p className="text-2xs text-ink-3 mt-1">
                Applies to your individual sender seat without altering shared organization branding.
              </p>
            </button>
          </div>
        </div>

        {/* 4 Identity Modes */}
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-ink-1">Choose how your identity appears</legend>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {CHAT_IDENTITY_MODES.map((opt) => {
              const Icon = opt.icon;
              const active = form.mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setField("mode", opt.value)}
                  aria-pressed={active}
                  data-testid={`identity-mode-${opt.value}`}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors cursor-pointer",
                    active
                      ? "border-brand-600 bg-brand-50 dark:bg-surface-2 shadow-2xs"
                      : "border-edge-1 bg-surface-0 hover:border-edge-2"
                  )}
                >
                  <div className="pt-0.5">
                    <Avatar
                      name={vendor?.business_name || "Vendor"}
                      personalName={form.sender_name || vendor?.business_name || "Me"}
                      businessName={vendor?.business_name || "Business"}
                      src={form.avatar_url || undefined}
                      logoSrc={form.logo_url || undefined}
                      mode={opt.value}
                      size="md"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-semibold text-ink-1 flex items-center gap-1.5">
                        <Icon size={13} className="text-brand-600 shrink-0" />
                        {opt.shortLabel}
                      </span>
                      {active && <CheckCircle2 size={14} className="text-brand-600 shrink-0" />}
                    </div>
                    <p className="text-2xs text-ink-3 mt-1 leading-snug">{opt.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Sender Name, Role, Personal Photo & Business Logo (Gallery Photo Addition) */}
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            label="Sender display name"
            placeholder="e.g. Amina Wanjiku"
            value={form.sender_name}
            onChange={(e) => setField("sender_name", e.target.value)}
            hint="Shown on Personal photo, Combined, and Role modes"
          />
          <Select
            label="Sender role / title"
            value={form.sender_role}
            onChange={(e) => setField("sender_role", e.target.value)}
            options={ROLE_OPTIONS}
          />
          <IdentityGalleryPicker
            label="Personal profile photo"
            hint="Select your photo from your gallery"
            value={form.avatar_url}
            onChange={(url) => setField("avatar_url", url)}
          />
          <IdentityGalleryPicker
            label="Business logo"
            hint="Select your business logo from your gallery"
            value={form.logo_url}
            onChange={(url) => setField("logo_url", url)}
            disabled={!canManageOrg && form.scope === "organization"}
          />
        </div>

        {/* Display Locations */}
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-ink-1">Supported display locations</legend>
          <div className="grid sm:grid-cols-3 gap-2">
            {LOCATION_OPTIONS.map((loc) => {
              const checked = form.locations?.[loc.key] !== false;
              return (
                <label
                  key={loc.key}
                  className={cn(
                    "flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition-colors",
                    checked ? "border-brand-600 bg-surface-0" : "border-edge-1 bg-surface-1 text-ink-3"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLocation(loc.key)}
                    className="mt-0.5 accent-brand-600"
                  />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-ink-1">{loc.label}</span>
                    <span className="block text-micro text-ink-4 mt-0.5 leading-snug">{loc.hint}</span>
                  </div>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Live Preview */}
        <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4 space-y-3" data-testid="chat-identity-preview">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-1 inline-flex items-center gap-1.5">
              <Eye size={14} className="text-brand-600" /> Live identity preview
            </span>
            <Badge variant="outline" size="xs">
              {CHAT_IDENTITY_MODES.find((m) => m.value === form.mode)?.shortLabel || form.mode}
            </Badge>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            {/* 1. Conversation List Preview */}
            <div className="rounded-xl border border-edge-1 bg-surface-0 p-3 space-y-1.5">
              <span className="text-micro uppercase tracking-wider font-bold text-ink-4">1. Conversation list</span>
              <div className="flex items-center gap-2.5 pt-1">
                <Avatar
                  name={previewList.businessName}
                  personalName={previewList.personalName}
                  businessName={previewList.businessName}
                  src={previewList.avatarUrl || undefined}
                  logoSrc={previewList.logoUrl || undefined}
                  mode={previewList.mode}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink-1 truncate">{previewList.primaryTitle}</p>
                  <p className="text-micro text-ink-4 truncate">{previewList.secondarySubtitle}</p>
                </div>
              </div>
            </div>

            {/* 2. Message Header Preview */}
            <div className="rounded-xl border border-edge-1 bg-surface-0 p-3 space-y-1.5">
              <span className="text-micro uppercase tracking-wider font-bold text-ink-4">2. Message header</span>
              <div className="flex items-center gap-2.5 pt-1">
                <Avatar
                  name={previewHeader.businessName}
                  personalName={previewHeader.personalName}
                  businessName={previewHeader.businessName}
                  src={previewHeader.avatarUrl || undefined}
                  logoSrc={previewHeader.logoUrl || undefined}
                  mode={previewHeader.mode}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink-1 truncate">{previewHeader.primaryTitle}</p>
                  <p className="text-micro text-brand-700 dark:text-brand-300 truncate">{previewHeader.secondarySubtitle}</p>
                </div>
              </div>
            </div>

            {/* 3. Individual Message Bubble Preview */}
            <div className="rounded-xl border border-edge-1 bg-surface-0 p-3 space-y-1.5">
              <span className="text-micro uppercase tracking-wider font-bold text-ink-4">3. Individual message</span>
              <div className="flex items-end gap-2 pt-1">
                <Avatar
                  name={previewMessage.businessName}
                  personalName={previewMessage.personalName}
                  businessName={previewMessage.businessName}
                  src={previewMessage.avatarUrl || undefined}
                  logoSrc={previewMessage.logoUrl || undefined}
                  mode={previewMessage.mode}
                  size="xs"
                />
                <div className="min-w-0 flex-1 rounded-xl bg-surface-2 px-2.5 py-1.5">
                  <p className="text-micro font-semibold text-ink-2 truncate">
                    {previewMessage.primaryTitle}
                    {previewMessage.mode === "business_with_role" && previewMessage.roleTitle
                      ? ` · ${previewMessage.roleTitle}`
                      : ""}
                  </p>
                  <p className="text-2xs text-ink-1 mt-0.5">20 crates ready for morning dispatch.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function IdentityGalleryPicker({ label, hint, value, onChange, disabled }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await fileAPI?.upload?.(file);
      if (res?.data?.url) {
        onChange(res.data.url);
      } else {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        onChange(dataUrl);
      }
    } catch (err) {
      toast.error(apiError(err, "Could not load photo from gallery"));
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  return (
    <div className={cn("space-y-1.5", disabled && "opacity-50 pointer-events-none")}>
      <span className="block text-xs font-medium text-ink-2">{label}</span>
      <div className="flex items-center gap-2.5 rounded-xl border border-edge-1 bg-surface-0 p-2.5">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          disabled={disabled}
          className="hidden"
          aria-label={label}
          onChange={onFile}
        />
        {value ? (
          <img src={value} alt={label} className="w-10 h-10 rounded-lg object-cover border border-edge-1 shrink-0" />
        ) : (
          <span className="w-10 h-10 rounded-lg bg-brand-500/10 text-brand-700 dark:text-brand-300 grid place-items-center shrink-0">
            <ImagePlus size={16} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline text-left"
          >
            {uploading ? "Adding…" : value ? "Change from gallery" : "Choose from gallery"}
          </button>
          {hint && <p className="text-micro text-ink-4 truncate">{hint}</p>}
        </div>
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={`Remove ${label}`}
            className="p-1 rounded-md text-ink-4 hover:text-red-600"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

