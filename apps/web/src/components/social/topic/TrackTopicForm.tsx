import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { CreateTopicRequest } from "@/domain/social-listening/topics";
import { CARD, FOCUS_RING, INPUT, LABEL, errorMessage, fetchJson, splitList, type TopicSummary } from "./shared";

export function TrackTopicForm({
  onCreated,
  onCancel,
}: {
  onCreated: (topic: { id?: string; name: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [phrases, setPhrases] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the topic a name.");
      return;
    }
    const body: CreateTopicRequest = { name: trimmed };
    const kw = splitList(keywords);
    const queries = splitList(phrases);
    if (kw.length) body.keywords = kw;
    if (queries.length) body.searchQueries = queries;
    if (startsOn) body.startsOn = startsOn;
    if (endsOn) body.endsOn = endsOn;
    if (officialUrl.trim()) body.officialUrl = officialUrl.trim();

    setSubmitting(true);
    setError(null);
    try {
      const created = await fetchJson<Partial<TopicSummary>>("/api/social-pulse/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onCreated({ id: typeof created?.id === "string" ? created.id : undefined, name: trimmed });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  const field = (label: string, input: ReactNode, wide = false) => (
    <label className={`space-y-1 block min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <span className={LABEL}>{label}</span>
      {input}
    </label>
  );

  return (
    <form onSubmit={submit} className={`${CARD} grid grid-cols-1 sm:grid-cols-2 gap-4`} aria-label="Track a new topic">
      {field(
        "Name (required)",
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Spooktah City" className={INPUT} />,
        true
      )}
      {field(
        "Keywords (comma-separated)",
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="ghost mini golf, pumpkin patch" className={INPUT} />
      )}
      {field(
        "Search phrases (comma-separated)",
        <input value={phrases} onChange={(e) => setPhrases(e.target.value)} placeholder="Utah City Halloween" className={INPUT} />
      )}
      {field("Start date", <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={INPUT} />)}
      {field("End date", <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={INPUT} />)}
      {field(
        "Official URL",
        <input type="url" value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} placeholder="https://" className={INPUT} />,
        true
      )}
      {error && (
        <p role="alert" className="sm:col-span-2 text-xs text-rose-300 break-words">
          {error}
        </p>
      )}
      <div className="sm:col-span-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={`px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 ${FOCUS_RING}`}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className={`px-4 py-2 rounded-xl bg-[#20d0c3] hover:bg-[#3ddcd0] disabled:opacity-60 text-xs font-bold text-slate-950 ${FOCUS_RING}`}
        >
          {submitting ? "Saving…" : "Track topic"}
        </button>
      </div>
    </form>
  );
}

