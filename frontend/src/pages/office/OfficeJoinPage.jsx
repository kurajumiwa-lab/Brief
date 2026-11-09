import { useState } from "react";
import { useParams } from "react-router-dom";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { officeAPI, apiError } from "@/lib/api";

/** Someone with a single-use link joins a home office. No account is needed. The link works once. */
export default function OfficeJoinPage() {
  const { token } = useParams();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await officeAPI.acceptLink({ token, display_name: name });
      setDone(data);
    } catch (err) {
      setError(apiError(err, "This link is no longer valid. Ask for a new one."));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-ink-1">You have joined</h1>
        <p className="text-sm text-ink-3">You are listed as {done.role} in this home office.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-lg font-semibold text-ink-1">Join a home office</h1>
      <p className="text-sm text-ink-3">Enter the name you want shown to the team. This link works once and then stops working.</p>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}
        <Button type="submit" loading={busy}>Join</Button>
      </form>
    </div>
  );
}
