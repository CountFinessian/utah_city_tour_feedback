"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type {
  TopicDetailResponse,
  TopicListResponse,
  TopicRefreshAccepted,
  TopicRefreshRequest,
} from "@/domain/social-listening/topics";
import {
  CHIP_BASE,
  EMPTY_CARD,
  POLL_INTERVAL_MS,
  POLL_MAX_MS,
  errorMessage,
  fetchJson,
  pickTopicId,
  readStoredTopicId,
  writeStoredTopicId,
  type TopicDetail,
  type TopicSummary,
} from "./topic/shared";
import { ErrorNotice, LoadingCard } from "./topic/ui";
import { TrackTopicForm } from "./topic/TrackTopicForm";
import { TopicBody } from "./topic/TopicBody";

type TopicsRequest = { preferId?: string; preferName?: string };

const topicsUrl = "/api/social-pulse/topics";
const detailUrl = (id: string) => `/api/social-pulse/topics/${encodeURIComponent(id)}`;
const refreshUrl = (id: string) => `${detailUrl(id)}/refresh`;
const fetchDetail = (id: string) => fetchJson<TopicDetailResponse>(detailUrl(id));
const postRefresh = (id: string, body: TopicRefreshRequest) =>
  fetchJson<TopicRefreshAccepted>(refreshUrl(id), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Events and topics panel. Effects only start requests and set state inside promise callbacks;
 * user actions bump `topicsReq` / `detailNonce` to reload.
 */
export function TopicIntelligencePanel() {
  const [topics, setTopics] = useState<TopicSummary[] | null>(null);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [topicsReq, setTopicsReq] = useState<TopicsRequest>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const kickedOff = useRef<Set<string>>(new Set());

  // Only trust detail that belongs to the selected topic (avoids a stale frame after switching).
  const current = detail && selectedId && detail.topic.id === selectedId ? detail : null;
  const running = current?.status === "running";
  const busy = (selectedId !== null && refreshingId === selectedId) || running;

  // Topic list, loaded on mount and whenever topicsReq changes.
  useEffect(() => {
    let cancelled = false;
    fetchJson<TopicListResponse>(topicsUrl)
      .then((json) => {
        if (cancelled) return;
        const list = json.topics ?? [];
        const byName = topicsReq.preferName ? list.find((t) => t.name === topicsReq.preferName)?.id : undefined;
        const stored = readStoredTopicId();
        setTopics(list);
        setTopicsError(null);
        setSelectedId((cur) => pickTopicId(list, topicsReq.preferId, byName, cur, stored));
      })
      .catch((err: unknown) => {
        if (!cancelled) setTopicsError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setTopicsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [topicsReq]);

  // Remember the selected topic.
  useEffect(() => {
    if (selectedId) writeStoredTopicId(selectedId);
  }, [selectedId]);

  // Detail for the selected topic. Cleanup drops stale responses when the topic or nonce changes.
  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    let cancelled = false;
    fetchDetail(id)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setDetailError(null);
        // Auto-kickoff once per topic when it has never been searched. The ref survives strict-mode re-runs.
        if (next.report === null && next.lastRefresh === null && next.status === "idle" && !kickedOff.current.has(id)) {
          kickedOff.current.add(id);
          setRefreshingId(id);
          postRefresh(id, {})
            .then(() => setDetailNonce((n) => n + 1))
            .catch((err: unknown) => setActionError(errorMessage(err)))
            .finally(() => setRefreshingId((cur) => (cur === id ? null : cur)));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setDetailError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, detailNonce]);

  // Poll every 5s while a refresh runs; stops when status returns to idle, on topic change, or after 5 minutes.
  useEffect(() => {
    if (!running || !selectedId) return;
    const id = selectedId;
    let disposed = false;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt > POLL_MAX_MS) {
        window.clearInterval(timer);
        return;
      }
      fetchDetail(id).then(
        (next) => {
          if (!disposed) setDetail(next);
        },
        () => {
          /* transient poll failure: keep the last good detail and try again on the next tick */
        }
      );
    }, POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [running, selectedId]);

  const reloadTopics = (prefer: TopicsRequest = {}) => {
    setTopicsLoading(true);
    setTopicsReq(prefer);
  };

  const runRefresh = (id: string, body: TopicRefreshRequest) => {
    setRefreshingId(id);
    setActionError(null);
    postRefresh(id, body)
      .then(() => setDetailNonce((n) => n + 1))
      .catch((err: unknown) => setActionError(errorMessage(err)))
      .finally(() => setRefreshingId((cur) => (cur === id ? null : cur)));
  };

  const selectTopic = (id: string) => {
    setSelectedId(id);
    setDetailError(null);
    setActionError(null);
  };

  const handleCreated = (created: { id?: string; name: string }) => {
    setFormOpen(false);
    reloadTopics({ preferId: created.id, preferName: created.name });
  };

  return (
    <section className="space-y-6" aria-label="Events and topics">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tracked topics">
        {topicsLoading && !topics && <span className="h-8 w-28 rounded-full bg-white/5 animate-pulse" aria-hidden />}
        {topics?.map((topic) => {
          const active = topic.id === selectedId;
          return (
            <button
              key={topic.id}
              type="button"
              aria-pressed={active}
              onClick={() => selectTopic(topic.id)}
              className={`${CHIP_BASE} ${
                active
                  ? "border-[#20d0c3]/50 bg-[#20d0c3]/15 text-[#20d0c3]"
                  : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07] hover:text-white"
              } ${topic.enabled ? "" : "opacity-60"}`}
            >
              {topic.name}
              {!topic.enabled && <span className="ml-1.5 text-[10px] text-slate-500">paused</span>}
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={formOpen}
          onClick={() => setFormOpen((open) => !open)}
          className={`${CHIP_BASE} border-dashed border-[#20d0c3]/40 text-[#20d0c3] hover:bg-[#20d0c3]/10`}
        >
          <Plus className="inline w-3.5 h-3.5 -mt-0.5 mr-1" aria-hidden />
          Track a topic
        </button>
      </div>

      {formOpen && <TrackTopicForm onCreated={handleCreated} onCancel={() => setFormOpen(false)} />}

      {topicsError && <ErrorNotice message={topicsError} onRetry={() => reloadTopics()} />}

      {topics && topics.length === 0 && !topicsError && (
        <div className={EMPTY_CARD}>
          No topics are being tracked yet. Track an event, venue or launch to follow what people say about it.
        </div>
      )}

      {selectedId &&
        (current ? (
          <TopicBody
            key={current.topic.id}
            detail={current}
            busy={busy}
            actionError={actionError}
            detailError={detailError}
            onRefresh={(request) => runRefresh(current.topic.id, request)}
          />
        ) : detailError ? (
          <ErrorNotice message={detailError} onRetry={() => setDetailNonce((n) => n + 1)} />
        ) : (
          <LoadingCard text="Loading topic…" />
        ))}
    </section>
  );
}
