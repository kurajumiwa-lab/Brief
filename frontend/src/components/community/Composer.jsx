import { useState } from "react";
import { Send } from "lucide-react";
import Button from "@/components/ui/Button";
import Textarea from "@/components/ui/Textarea";
import { useCommunityStore } from "@/stores/communityStore";

/**
 * WRITE ONE POST.
 *
 * Deliberately one field and one optional circle. A community that requires a
 * title, a category and a photograph before a sentence can be heard is a
 * community for people with time to spare.
 *
 * The minimum length is the server's rule (8 characters), shown up front rather
 * than discovered by a 422 after the fact.
 */

const MIN = 8;

export default function Composer({ circles = [], onDone, onCancel }) {
  const [body, setBody] = useState("");
  const [circleId, setCircleId] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState("");

  const tooShort = body.trim().length > 0 && body.trim().length < MIN;

  const submit = async (event) => {
    event.preventDefault();
    if (body.trim().length < MIN || sending) return;
    setSending(true);
    setFailure("");
    try {
      await useCommunityStore.getState().publish({ body: body.trim(), circleId: circleId || null });
      setBody("");
      onDone?.();
    } catch (error) {
      setFailure(
        error?.response?.data?.detail || "The post didn't send. Your words are still here — try again."
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2.5 rounded-2xl border border-edge-1 bg-surface-0 p-3">
      <Textarea
        label="What do you want the market to know?"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        maxLength={4000}
        placeholder="Prices at the market today, a question about a supplier, a warning about a bad load…"
        hint={`${body.trim().length}/4000`}
        error={tooShort ? `At least ${MIN} characters — say a little more.` : undefined}
        autoFocus
      />

      {circles.length > 0 && (
        <label className="block text-2xs font-semibold text-ink-3">
          Post to
          <select
            value={circleId}
            onChange={(event) => setCircleId(event.target.value)}
            className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2.5 py-2 text-xs text-ink-1"
          >
            <option value="">Everyone</option>
            {circles.map((circle) => (
              <option key={circle.id} value={circle.id}>
                {circle.name}
                {circle.requires_approval ? " (approval needed)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {failure && (
        <p role="alert" className="text-2xs font-semibold text-red-600">
          {failure}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          icon={Send}
          disabled={body.trim().length < MIN || sending}
          loading={sending}
        >
          Post
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
