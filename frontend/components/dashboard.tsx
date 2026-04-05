"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

import { DEMO_CATEGORY_OPTIONS, buildDemoEvents } from "@/lib/demo";
import type {
  ActivityItem,
  ConnectionState,
  EventBatchRequest,
  EventBatchResponse,
  EventRequestItem,
  Notice,
  StatsPayload,
} from "@/lib/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

const SINGLE_EVENT_DEFAULTS = {
  eventType: "order_created",
  category: "orders",
  source: "control-plane-ui",
  payload: '{\n  "amount": 125.5,\n  "customer_id": "cust-17",\n  "region": "us-east-1"\n}',
};

const DEMO_BATCH_DEFAULTS = {
  count: 50,
  category: "orders",
  source: "demo-generator",
};

const emptyStats: StatsPayload = {
  total_events: 0,
  events_per_second: 0,
  top_categories: [],
};

type PanelFeedback = {
  tone: "success" | "error";
  message: string;
  taskIds?: string[];
};

export function Dashboard() {
  const [stats, setStats] = useState<StatsPayload>(emptyStats);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const [eventType, setEventType] = useState(SINGLE_EVENT_DEFAULTS.eventType);
  const [eventCategory, setEventCategory] = useState(SINGLE_EVENT_DEFAULTS.category);
  const [eventSource, setEventSource] = useState(SINGLE_EVENT_DEFAULTS.source);
  const [eventPayload, setEventPayload] = useState(SINGLE_EVENT_DEFAULTS.payload);
  const [isSubmittingEvent, setIsSubmittingEvent] = useState(false);
  const [eventFeedback, setEventFeedback] = useState<PanelFeedback | null>(null);

  const [demoCount, setDemoCount] = useState<number>(DEMO_BATCH_DEFAULTS.count);
  const [demoCategory, setDemoCategory] = useState(DEMO_BATCH_DEFAULTS.category);
  const [demoSource, setDemoSource] = useState(DEMO_BATCH_DEFAULTS.source);
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);
  const [batchFeedback, setBatchFeedback] = useState<PanelFeedback | null>(null);

  const [activity, setActivity] = useState<ActivityItem[]>([]);

  async function refreshStats(signal?: AbortSignal) {
    const response = await fetch(`${API_BASE_URL}/stats`, {
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }

    const payload = (await response.json()) as StatsPayload;
    setStats(payload);
    setStatsError(null);
    setLastUpdatedAt(new Date().toISOString());
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const eventSource = new EventSource(`${API_BASE_URL}/stats/stream`);

    refreshStats(controller.signal).catch((error: unknown) => {
      if (!cancelled) {
        setConnectionState("disconnected");
        setStatsError(getDisplayError(error, "Stats API unavailable."));
      }
    });

    eventSource.onopen = () => {
      if (!cancelled) {
        setConnectionState("live");
      }
    };

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as StatsPayload;
        if (!cancelled) {
          setStats(payload);
          setStatsError(null);
          setLastUpdatedAt(new Date().toISOString());
          setConnectionState("live");
        }
      } catch {
        if (!cancelled) {
          setConnectionState("disconnected");
          setStatsError("Live stream sent an unreadable payload.");
        }
      }
    };

    eventSource.onerror = () => {
      if (!cancelled) {
        setConnectionState("disconnected");
        setStatsError("Live stream disconnected. The browser will keep retrying.");
      }
    };

    return () => {
      cancelled = true;
      controller.abort();
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function prependActivity(item: ActivityItem) {
    setActivity((current) => [item, ...current].slice(0, 8));
  }

  async function postEvents(events: EventRequestItem[]): Promise<EventBatchResponse> {
    const requestBody: EventBatchRequest = { events };
    const response = await fetch(`${API_BASE_URL}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }

    return (await response.json()) as EventBatchResponse;
  }

  async function handleSingleEventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEventFeedback(null);

    const trimmedEventType = eventType.trim();
    const trimmedCategory = eventCategory.trim().toLowerCase();
    const trimmedSource = eventSource.trim();

    if (!trimmedEventType || !trimmedCategory || !trimmedSource) {
      const message = "Event type, category, source, and payload are required.";
      setEventFeedback({ tone: "error", message });
      setNotice({ tone: "error", message });
      return;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(eventPayload);
    } catch {
      const message = "Payload must be valid JSON.";
      setEventFeedback({ tone: "error", message });
      setNotice({ tone: "error", message });
      return;
    }

    if (!isPlainObject(parsedPayload)) {
      const message = "Payload JSON must be an object.";
      setEventFeedback({ tone: "error", message });
      setNotice({ tone: "error", message });
      return;
    }

    setIsSubmittingEvent(true);

    try {
      const response = await postEvents([
        {
          event_id: crypto.randomUUID(),
          category: trimmedCategory,
          occurred_at: new Date().toISOString(),
          payload: {
            ...parsedPayload,
            event_type: trimmedEventType,
            source: trimmedSource,
            submitted_from: "streamforge-control-plane",
          },
        },
      ]);

      const message = `Accepted ${response.accepted} event and queued ${response.task_ids.length} task.`;
      setEventFeedback({ tone: "success", message, taskIds: response.task_ids });
      setNotice({ tone: "success", message });
      prependActivity({
        id: crypto.randomUUID(),
        mode: "single",
        timestamp: new Date().toISOString(),
        accepted: response.accepted,
        taskIds: response.task_ids,
        category: trimmedCategory,
        eventType: trimmedEventType,
        source: trimmedSource,
        status: "success",
        message,
      });
      setEventType("");
      setEventCategory("");
      setEventSource("");
      setEventPayload("{\n  \n}");
      await refreshStats();
    } catch (error: unknown) {
      const message = getDisplayError(error, "Unable to submit event.");
      setEventFeedback({ tone: "error", message });
      setNotice({ tone: "error", message });
      prependActivity({
        id: crypto.randomUUID(),
        mode: "single",
        timestamp: new Date().toISOString(),
        accepted: 0,
        taskIds: [],
        category: trimmedCategory || "unknown",
        eventType: trimmedEventType || "unknown",
        source: trimmedSource || "unknown",
        status: "error",
        message,
      });
    } finally {
      setIsSubmittingEvent(false);
    }
  }

  async function handleBatchSubmit() {
    setBatchFeedback(null);

    const normalizedCategory = demoCategory.trim().toLowerCase();
    const normalizedSource = demoSource.trim();

    if (!normalizedCategory || !normalizedSource) {
      const message = "Batch category and source are required.";
      setBatchFeedback({ tone: "error", message });
      setNotice({ tone: "error", message });
      return;
    }

    if (!Number.isFinite(demoCount) || demoCount < 1 || demoCount > 5000) {
      const message = "Demo batch count must be between 1 and 5000.";
      setBatchFeedback({ tone: "error", message });
      setNotice({ tone: "error", message });
      return;
    }

    setIsSubmittingBatch(true);

    try {
      const response = await postEvents(buildDemoEvents(demoCount, normalizedCategory, normalizedSource));
      const message = `Accepted ${response.accepted} demo events and returned ${response.task_ids.length} task IDs.`;
      setBatchFeedback({ tone: "success", message, taskIds: response.task_ids });
      setNotice({ tone: "success", message });
      prependActivity({
        id: crypto.randomUUID(),
        mode: "batch",
        timestamp: new Date().toISOString(),
        accepted: response.accepted,
        taskIds: response.task_ids,
        category: normalizedCategory,
        eventType: "demo_batch",
        source: normalizedSource,
        status: "success",
        message,
      });
      await refreshStats();
    } catch (error: unknown) {
      const message = getDisplayError(error, "Unable to generate demo batch.");
      setBatchFeedback({ tone: "error", message });
      setNotice({ tone: "error", message });
      prependActivity({
        id: crypto.randomUUID(),
        mode: "batch",
        timestamp: new Date().toISOString(),
        accepted: 0,
        taskIds: [],
        category: normalizedCategory || "unknown",
        eventType: "demo_batch",
        source: normalizedSource || "unknown",
        status: "error",
        message,
      });
    } finally {
      setIsSubmittingBatch(false);
    }
  }

  const lastUpdatedLabel = lastUpdatedAt ? formatTime(lastUpdatedAt) : "Waiting for first update";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <HeroSection
        connectionState={connectionState}
        lastUpdatedLabel={lastUpdatedLabel}
        onRefresh={async () => {
          try {
            await refreshStats();
            setNotice({ tone: "success", message: "Metrics refreshed from the backend." });
          } catch (error: unknown) {
            const message = getDisplayError(error, "Unable to refresh stats.");
            setNotice({ tone: "error", message });
            setStatsError(message);
          }
        }}
      />

      {notice ? (
        <div
          className={`fixed right-4 top-4 z-50 rounded-2xl border px-4 py-3 text-sm shadow-panel ${
            notice.tone === "success"
              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-100"
              : "border-rose-500/30 bg-rose-500/15 text-rose-100"
          }`}
        >
          {notice.message}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Total events"
          value={stats.total_events.toLocaleString()}
          hint="Persisted processed events"
          accent="primary"
        />
        <MetricCard
          label="Events / sec"
          value={stats.events_per_second.toFixed(2)}
          hint="Rolling throughput window"
          accent="secondary"
        />
        <MetricCard
          label="Tracked categories"
          value={String(stats.top_categories.length)}
          hint="Distinct categories in top set"
          accent="neutral"
        />
        <MetricCard
          label="Live stream"
          value={connectionState.toUpperCase()}
          hint="SSE connection status"
          accent={connectionState === "live" ? "success" : "danger"}
        />
        <MetricCard
          label="Last updated"
          value={lastUpdatedLabel}
          hint="Frontend session timestamp"
          accent="neutral"
        />
      </section>

      {statsError ? (
        <InlineFeedback
          tone="error"
          message={statsError}
          helper="The dashboard will keep retrying the live stream while you can still use the control plane."
        />
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="panel rounded-2xl p-5 shadow-panel sm:p-6">
          <SectionTitle
            eyebrow="Manual Ingestion"
            title="Submit a single event"
            description="Use the same ingestion API the worker pipeline already consumes. Event type and source are merged into the payload before submission."
          />

          <form className="mt-6 space-y-4" onSubmit={handleSingleEventSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Event type" required>
                <input
                  value={eventType}
                  onChange={(inputEvent) => setEventType(inputEvent.target.value)}
                  placeholder="order_created"
                  className={inputClassName}
                />
              </Field>

              <Field label="Category" required>
                <input
                  value={eventCategory}
                  onChange={(inputEvent) => setEventCategory(inputEvent.target.value)}
                  placeholder="orders"
                  className={inputClassName}
                  list="category-options"
                />
                <datalist id="category-options">
                  {DEMO_CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </Field>
            </div>

            <Field label="Source" required>
              <input
                value={eventSource}
                onChange={(inputEvent) => setEventSource(inputEvent.target.value)}
                placeholder="control-plane-ui"
                className={inputClassName}
              />
            </Field>

            <Field label="Payload JSON" required helper="Must be a valid JSON object.">
              <textarea
                value={eventPayload}
                onChange={(inputEvent) => setEventPayload(inputEvent.target.value)}
                rows={9}
                className={`${inputClassName} min-h-48 resize-y font-mono text-sm`}
              />
            </Field>

            {eventFeedback ? (
              <InlineFeedback
                tone={eventFeedback.tone}
                message={eventFeedback.message}
                taskIds={eventFeedback.taskIds}
              />
            ) : null}

            <div className="flex flex-col gap-3 border-t border-forge-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-forge-muted">
                POSTs a batch of one event to <code>/events</code>.
              </p>
              <button
                type="submit"
                disabled={isSubmittingEvent}
                className="inline-flex items-center justify-center rounded-xl bg-forge-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmittingEvent ? "Submitting..." : "Submit Event"}
              </button>
            </div>
          </form>
        </article>

        <article className="panel rounded-2xl p-5 shadow-panel sm:p-6">
          <SectionTitle
            eyebrow="Demo Generator"
            title="Generate synthetic traffic"
            description="Create realistic demo batches directly from the UI to show bursty workloads and live dashboard updates."
          />

          <div className="mt-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Batch size" required helper="Choose any value from 1 to 5000.">
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={demoCount}
                  onChange={(inputEvent) => setDemoCount(Number(inputEvent.target.value))}
                  className={inputClassName}
                />
              </Field>

              <Field label="Category" required>
                <select
                  value={demoCategory}
                  onChange={(inputEvent) => setDemoCategory(inputEvent.target.value)}
                  className={inputClassName}
                >
                  {DEMO_CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Source" required>
              <input
                value={demoSource}
                onChange={(inputEvent) => setDemoSource(inputEvent.target.value)}
                placeholder="demo-generator"
                className={inputClassName}
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              {[10, 50, 100].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setDemoCount(size)}
                  className="rounded-xl border border-forge-border bg-forge-elevated px-3 py-2 text-sm text-forge-text transition hover:border-forge-primary hover:text-white"
                >
                  {size}
                </button>
              ))}
            </div>

            {batchFeedback ? (
              <InlineFeedback
                tone={batchFeedback.tone}
                message={batchFeedback.message}
                taskIds={batchFeedback.taskIds}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-forge-border bg-forge-elevated/70 px-4 py-4 text-sm text-forge-muted">
                Generate a burst of events to drive the worker queue and watch the metrics update over SSE.
              </p>
            )}

            <div className="flex flex-col gap-3 border-t border-forge-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-forge-muted">
                Synthetic events include source, event type, trace ID, partition hint, and region metadata.
              </p>
              <button
                type="button"
                disabled={isSubmittingBatch}
                onClick={handleBatchSubmit}
                className="inline-flex items-center justify-center rounded-xl bg-forge-secondary px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmittingBatch ? "Generating..." : "Generate Demo Batch"}
              </button>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="panel rounded-2xl p-5 shadow-panel sm:p-6">
          <SectionTitle
            eyebrow="Category Analytics"
            title="Top categories"
            description="A lightweight throughput snapshot of the dominant event streams currently moving through the platform."
          />

          <div className="mt-6 space-y-4">
            {stats.top_categories.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-forge-border bg-forge-elevated/70 px-5 py-10 text-center text-sm text-forge-muted">
                No categories have been processed yet. Submit a manual event or generate a demo batch to populate this view.
              </div>
            ) : (
              stats.top_categories.map((category) => {
                const ratio = (category.count / Math.max(stats.total_events, 1)) * 100;
                return (
                  <div key={category.category} className="rounded-2xl border border-forge-border bg-forge-elevated/75 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-forge-muted">Category</p>
                        <p className="mt-1 text-lg font-semibold text-forge-text">{category.category}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-[0.3em] text-forge-muted">Count</p>
                        <p className="mt-1 text-lg font-semibold text-forge-text">
                          {category.count.toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-forge-primary via-sky-400 to-forge-secondary transition-all duration-300"
                        style={{ width: `${Math.max(10, ratio)}%` }}
                      />
                    </div>

                    <p className="mt-3 text-sm text-forge-muted">
                      {ratio.toFixed(1)}% of the currently tracked processed event volume.
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="panel rounded-2xl p-5 shadow-panel sm:p-6">
          <SectionTitle
            eyebrow="Pipeline View"
            title="How StreamForge moves events"
            description="A recruiter-friendly view of the distributed path from ingestion to live observability."
          />

          <div className="mt-6 grid gap-3">
            {PIPELINE_STEPS.map((step) => (
              <div
                key={step.title}
                className="rounded-2xl border border-forge-border bg-forge-elevated/80 p-4"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forge-primary/20 text-sm font-semibold text-blue-200">
                    {step.index}
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-forge-text">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-forge-muted">{step.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel rounded-2xl p-5 shadow-panel sm:p-6">
        <SectionTitle
          eyebrow="Session Activity"
          title="Recent control plane requests"
          description="This history is stored in the current browser session so you can demonstrate successful submissions and returned task IDs without using terminal commands."
        />

        <div className="mt-6 space-y-3">
          {activity.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-forge-border bg-forge-elevated/70 px-5 py-10 text-center text-sm text-forge-muted">
              No requests yet in this session. Submit an event or generate a demo batch to populate this activity feed.
            </div>
          ) : (
            activity.map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border border-forge-border bg-forge-elevated/75 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          item.status === "success"
                            ? "bg-emerald-500/15 text-emerald-200"
                            : "bg-rose-500/15 text-rose-200"
                        }`}
                      >
                        {item.status}
                      </span>
                      <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-forge-muted">
                        {item.mode === "single" ? "single event" : "demo batch"}
                      </span>
                      <span className="text-xs uppercase tracking-[0.28em] text-forge-muted">
                        {formatTime(item.timestamp)}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-forge-text">
                      {item.category} · {item.eventType} · {item.source}
                    </h3>
                    <p className="text-sm text-forge-muted">{item.message}</p>
                  </div>

                  <div className="grid gap-2 text-sm text-forge-muted sm:grid-cols-2 lg:min-w-80">
                    <div className="rounded-xl border border-forge-border bg-slate-900/60 px-3 py-2">
                      Accepted: <span className="font-semibold text-forge-text">{item.accepted}</span>
                    </div>
                    <div className="rounded-xl border border-forge-border bg-slate-900/60 px-3 py-2">
                      Task IDs: <span className="font-semibold text-forge-text">{item.taskIds.length}</span>
                    </div>
                  </div>
                </div>

                {item.taskIds.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.taskIds.slice(0, 6).map((taskId) => (
                      <code
                        key={taskId}
                        className="rounded-lg border border-forge-border bg-slate-950 px-2.5 py-1 text-xs text-blue-200"
                      >
                        {taskId}
                      </code>
                    ))}
                    {item.taskIds.length > 6 ? (
                      <span className="rounded-lg border border-forge-border bg-slate-900 px-2.5 py-1 text-xs text-forge-muted">
                        +{item.taskIds.length - 6} more
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function HeroSection({
  connectionState,
  lastUpdatedLabel,
  onRefresh,
}: {
  connectionState: ConnectionState;
  lastUpdatedLabel: string;
  onRefresh: () => void | Promise<void>;
}) {
  return (
    <section className="panel relative overflow-hidden rounded-3xl p-6 shadow-panel sm:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.08),transparent_22%)]" />

      <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl space-y-4">
          <p className="text-xs uppercase tracking-[0.45em] text-forge-muted">StreamForge</p>
          <h1 className="heading-font text-4xl font-semibold tracking-tight text-forge-text sm:text-5xl">
            Real-time event processing control plane
          </h1>
          <p className="max-w-2xl text-base leading-7 text-forge-muted">
            Ingest event batches, simulate traffic, and observe live processing analytics across the
            FastAPI, Redis, Celery, PostgreSQL, and SSE pipeline from one polished dashboard.
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <StatusBadge connectionState={connectionState} />
            <span className="rounded-full border border-forge-border bg-forge-elevated px-3 py-2 text-forge-muted">
              Last updated: <span className="text-forge-text">{lastUpdatedLabel}</span>
            </span>
          </div>
        </div>

        <div className="panel-elevated flex flex-col gap-3 rounded-2xl p-4 sm:min-w-80">
          <p className="text-xs uppercase tracking-[0.35em] text-forge-muted">Control Surface</p>
          <p className="text-sm leading-6 text-forge-muted">
            Submit one-off events, generate demo bursts, and keep the live stats stream visible during demos.
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center justify-center rounded-xl border border-forge-border bg-slate-900 px-4 py-2.5 text-sm font-medium text-forge-text transition hover:border-forge-primary hover:text-white"
          >
            Refresh Stats
          </button>
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent: "primary" | "secondary" | "neutral" | "success" | "danger";
}) {
  const accentClass =
    accent === "primary"
      ? "border-blue-500/20 bg-blue-500/10"
      : accent === "secondary"
        ? "border-amber-500/20 bg-amber-500/10"
        : accent === "success"
          ? "border-emerald-500/20 bg-emerald-500/10"
          : accent === "danger"
            ? "border-rose-500/20 bg-rose-500/10"
            : "border-forge-border bg-forge-panel";

  return (
    <article className={`rounded-2xl border p-4 shadow-panel ${accentClass}`}>
      <p className="text-xs uppercase tracking-[0.3em] text-forge-muted">{label}</p>
      <p className="mt-4 text-2xl font-semibold text-forge-text">{value}</p>
      <p className="mt-2 text-sm text-forge-muted">{hint}</p>
    </article>
  );
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.35em] text-forge-muted">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold text-forge-text">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-forge-muted">{description}</p>
    </div>
  );
}

function Field({
  label,
  children,
  helper,
  required,
}: {
  label: string;
  children: ReactNode;
  helper?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-forge-text">
        <span>{label}</span>
        {required ? <span className="text-forge-secondary">*</span> : null}
      </div>
      {children}
      {helper ? <p className="mt-2 text-xs leading-5 text-forge-muted">{helper}</p> : null}
    </label>
  );
}

function InlineFeedback({
  tone,
  message,
  helper,
  taskIds,
}: {
  tone: "success" | "error";
  message: string;
  helper?: string;
  taskIds?: string[];
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${
        tone === "success"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
          : "border-rose-500/30 bg-rose-500/10 text-rose-100"
      }`}
    >
      <p>{message}</p>
      {helper ? <p className="mt-1 text-xs text-current/80">{helper}</p> : null}
      {taskIds && taskIds.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {taskIds.slice(0, 5).map((taskId) => (
            <code key={taskId} className="rounded-lg bg-black/20 px-2 py-1 text-xs">
              {taskId}
            </code>
          ))}
          {taskIds.length > 5 ? <span className="text-xs">+{taskIds.length - 5} more</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ connectionState }: { connectionState: ConnectionState }) {
  const badgeClass =
    connectionState === "live"
      ? "border-emerald-500/25 bg-emerald-500/15 text-emerald-200"
      : connectionState === "connecting"
        ? "border-amber-500/25 bg-amber-500/15 text-amber-200"
        : "border-rose-500/25 bg-rose-500/15 text-rose-200";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${badgeClass}`}>
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          connectionState === "live"
            ? "bg-forge-success"
            : connectionState === "connecting"
              ? "bg-forge-secondary"
              : "bg-forge-danger"
        }`}
      />
      {connectionState === "live"
        ? "Live pipeline connected"
        : connectionState === "connecting"
          ? "Connecting to live stats"
          : "Live stream disconnected"}
    </span>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function getErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail ?? `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

function getDisplayError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

const PIPELINE_STEPS = [
  {
    index: "01",
    title: "API ingestion",
    description: "FastAPI validates event batches posted from the control plane and accepts them for asynchronous handling.",
  },
  {
    index: "02",
    title: "Redis queue",
    description: "Accepted payloads are published into Redis-backed Celery queues so burst traffic can be buffered safely.",
  },
  {
    index: "03",
    title: "Celery processing",
    description: "Workers consume queued events, apply processing logic, and retry failures with bounded backoff.",
  },
  {
    index: "04",
    title: "PostgreSQL persistence",
    description: "Processed outcomes and failures are stored durably for analytics, reporting, and dead-letter inspection.",
  },
  {
    index: "05",
    title: "SSE dashboard updates",
    description: "Redis pub/sub fans out live analytics so the dashboard updates in real time without manual refreshes.",
  },
] as const;

const inputClassName =
  "w-full rounded-xl border border-forge-border bg-forge-elevated px-3 py-2.5 text-forge-text outline-none transition placeholder:text-forge-muted/70 focus:border-forge-primary focus:ring-2 focus:ring-blue-500/20";
