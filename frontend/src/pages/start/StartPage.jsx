import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StartView from "@/components/start/StartView";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";

/**
 * The post-join screen. It is deliberately outside the shell: no tabs, no
 * drawer, no shelves. One question, one answer, and then the app.
 *
 * Reached at /start after sign-up, and from You whenever the answer changes.
 */
export default function StartPage() {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const identity = useIdentityStore();
  const loadIdentity = useIdentityStore((s) => s.load);
  const setAll = useIdentityStore((s) => s.setAll);
  const claimAffiliation = useIdentityStore((s) => s.claimAffiliation);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadIdentity();
  }, [loadIdentity]);

  async function handleSave({ intent, capabilities, affiliation }) {
    setSaving(true);
    try {
      await setAll({ intent, capabilities });
      if (affiliation?.name) await claimAffiliation(affiliation);
      navigate(intent === "explore" ? "/" : "/you/page", { replace: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-0 px-4 py-10 sm:py-14">
      <StartView
        name={(vendor?.business_name || "").split(" ")[0]}
        initialIntent={identity.intent}
        initialCapabilities={identity.capabilities}
        initialAffiliation={identity.affiliation}
        saving={saving}
        error={identity.error}
        onSave={handleSave}
        onSkip={() => navigate("/", { replace: true })}
      />
    </div>
  );
}
