"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

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
  queue_depth: 0,
  latency: {
    p50: 0,
    p95: 0,
    p99: 0,
  },
};

type PanelFeedback = {
  tone: "success" | "error";
  message: string;
  taskIds?: string[];
};

type RetryLogItem = {
  id: string;
  timestamp: string;
  message: string;
  tone: "neutral" | "warning" | "danger";
};

type Theme = "light" | "dark";

export function Dashboard() {
  const [theme, setTheme] = useState<Theme>("light");
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

  const [isTriggeringFailure, setIsTriggeringFailure] = useState(false);
  const [retryLog, setRetryLog] = useState<RetryLogItem[]>([]);
  const retryTimers = useRef<number[]>([]);

  const [activity, setActivity] = useState<ActivityItem[]>([]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    return () => {
      retryTimers.current.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  async function refreshStats(signal?: AbortSignal) {
    const response = await fetch(`${API_BASE_URL}/stats`, {
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }

    const payload = (await response.json()) as StatsPayload;
    setStats(normalizeStats(payload));
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
          setStats(normalizeStats(payload));
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

  function appendRetryLog(message: string, tone: RetryLogItem["tone"]) {
    setRetryLog((current) =>
      [
        ...current,
        {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          message,
          tone,
        },
      ].slice(-8),
    );
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

  async function handleFailureDemo() {
    setIsTriggeringFailure(true);
    retryTimers.current.forEach((timerId) => window.clearTimeout(timerId));
    retryTimers.current = [];
    setRetryLog([]);

    const eventId = `evt-${crypto.randomUUID().slice(0, 8)}`;

    try {
      const response = await postEvents([
        {
          event_id: eventId,
          category: "failure-demo",
          occurred_at: new Date().toISOString(),
          payload: {
            event_type: "forced_failure",
            source: "failure-retry-demo",
            force_fail: true,
            submitted_from: "streamforge-control-plane",
          },
        },
      ]);

      appendRetryLog(`Event ${eventId} queued`, "neutral");
      setNotice({ tone: "success", message: "Failing event queued for retry demo." });
      prependActivity({
        id: crypto.randomUUID(),
        mode: "single",
        timestamp: new Date().toISOString(),
        accepted: response.accepted,
        taskIds: response.task_ids,
        category: "failure-demo",
        eventType: "forced_failure",
        source: "failure-retry-demo",
        status: "success",
        message: "Queued a forced failure to demonstrate bounded retries.",
      });

      const sequence: Array<Omit<RetryLogItem, "id" | "timestamp"> & { delay: number }> = [
        { delay: 1000, message: "Attempt 1/3 failed — retrying in 2s", tone: "warning" },
        { delay: 3000, message: "Attempt 2/3 failed — retrying in 4s", tone: "warning" },
        {
          delay: 7000,
          message: "Attempt 3/3 failed — moved to dead_letter_events",
          tone: "danger",
        },
      ];

      retryTimers.current = sequence.map((entry) =>
        window.setTimeout(() => {
          appendRetryLog(entry.message, entry.tone);
        }, entry.delay),
      );

      await refreshStats();
    } catch (error: unknown) {
      const message = getDisplayError(error, "Unable to trigger failing event.");
      appendRetryLog(message, "danger");
      setNotice({ tone: "error", message });
    } finally {
      setIsTriggeringFailure(false);
    }
  }

  const lastUpdatedLabel = lastUpdatedAt ? formatTime(lastUpdatedAt) : "Waiting for first update";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <HeroSection
        theme={theme}
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
        onToggleTheme={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
      />

      {notice ? <Toast notice={notice} /> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total events"
          value={stats.total_events.toLocaleString()}
          hint="Persisted processed events."
        />
        <MetricCard
          label="Events / sec"
          value={stats.events_per_second.toFixed(2)}
          hint="Rolling throughput window."
        />
        <MetricCard
          label="Tracked categories"
          value={String(stats.top_categories.length)}
          hint="Categories in the top set."
        />
        <MetricCard
          label="Queue depth"
          value={stats.queue_depth.toLocaleString()}
          hint="Events waiting to be processed."
        />
      </section>

      {statsError ? (
        <InlineFeedback
          tone="error"
          message={statsError}
          helper="The dashboard will keep retrying the live stream while the control plane remains available."
        />
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="flat-panel p-5 sm:p-6">
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
                className={`${inputClassName} min-h-48 resize-y text-sm`}
              />
            </Field>

            {eventFeedback ? (
              <InlineFeedback
                tone={eventFeedback.tone}
                message={eventFeedback.message}
                taskIds={eventFeedback.taskIds}
              />
            ) : null}

            <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[var(--ink-muted)]">
                POSTs a batch of one event to <code>/events</code>.
              </p>
              <button type="submit" disabled={isSubmittingEvent} className="primary-button">
                {isSubmittingEvent ? "Submitting..." : "Submit Event"}
              </button>
            </div>
          </form>
        </article>

        <article className="flat-panel p-5 sm:p-6">
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
                  className="secondary-button"
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
              <p className="empty-state text-left">
                Generate a burst of events to drive the worker queue and watch the metrics update over SSE.
              </p>
            )}

            <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[var(--ink-muted)]">
                Synthetic events include source, event type, trace ID, partition hint, and region metadata.
              </p>
              <button
                type="button"
                disabled={isSubmittingBatch}
                onClick={handleBatchSubmit}
                className="primary-button"
              >
                {isSubmittingBatch ? "Generating..." : "Generate Demo Batch"}
              </button>
            </div>
          </div>
        </article>
      </section>

      <section className="flat-panel p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <SectionTitle
            eyebrow="Failure & Retry Demo"
            title="Trigger a bounded retry sequence"
            description="POST a forced-failure event and show how StreamForge retries with backoff before preserving the failure in the dead-letter table."
          />
          <button
            type="button"
            disabled={isTriggeringFailure}
            onClick={handleFailureDemo}
            className="danger-button"
          >
            {isTriggeringFailure ? "Triggering..." : "Trigger a failing event"}
          </button>
        </div>

        <LogFeed items={retryLog} emptyMessage="No failing event has been triggered in this session." />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="flat-panel p-5 sm:p-6">
          <SectionTitle
            eyebrow="Category Analytics"
            title="Top categories"
            description="A lightweight throughput snapshot of the dominant event streams currently moving through the platform."
          />

          <div className="mt-6 space-y-4">
            {stats.top_categories.length === 0 ? (
              <div className="empty-state">
                No categories have been processed yet. Submit a manual event or generate a demo batch to populate this view.
              </div>
            ) : (
              stats.top_categories.map((category) => {
                const ratio = (category.count / Math.max(stats.total_events, 1)) * 100;
                return (
                  <div key={category.category} className="category-row">
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div>
                        <p className="label-text">Category</p>
                        <p className="mt-1 text-base font-semibold text-[var(--ink)]">{category.category}</p>
                      </div>
                      <div className="sm:text-right">
                        <p className="label-text">Count</p>
                        <p className="mt-1 text-base font-semibold text-[var(--ink)]">
                          {category.count.toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 h-3 overflow-hidden border border-[var(--border)] bg-[var(--surface-muted)]">
                      <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.max(4, ratio)}%` }} />
                    </div>

                    <p className="mt-3 text-sm text-[var(--ink-muted)]">
                      {ratio.toFixed(1)}% of the currently tracked processed event volume.
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="flat-panel p-5 sm:p-6">
          <SectionTitle
            eyebrow="Processing Time"
            title="Latency percentiles"
            description="Durations are calculated from the last 100 processed events using processed_at minus occurred_at."
          />

          <div className="mt-6 overflow-x-auto">
            <table className="metric-table">
              <thead>
                <tr>
                  <th>Percentile</th>
                  <th>Seconds</th>
                  <th>What it shows</th>
                </tr>
              </thead>
              <tbody>
                <LatencyRow label="p50" value={stats.latency.p50} description="Typical processing time" />
                <LatencyRow label="p95" value={stats.latency.p95} description="Slow end of normal traffic" />
                <LatencyRow label="p99" value={stats.latency.p99} description="Tail latency outliers" />
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="flat-panel p-5 sm:p-6">
        <SectionTitle
          eyebrow="Pipeline View"
          title="How StreamForge moves events"
          description="A recruiter-friendly view of the distributed path from ingestion to live observability."
        />

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {PIPELINE_STEPS.map((step) => (
            <div key={step.title} className="pipeline-step">
              <div className="step-index">{step.index}</div>
              <h3 className="mt-4 text-base font-semibold text-[var(--ink)]">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flat-panel p-5 sm:p-6">
        <SectionTitle
          eyebrow="Session Activity"
          title="Recent control plane requests"
          description="This history is stored in the current browser session so you can demonstrate successful submissions and returned task IDs without terminal commands."
        />

        <div className="mt-6 space-y-3">
          {activity.length === 0 ? (
            <div className="empty-state">
              No requests yet in this session. Submit an event or generate a demo batch to populate this activity feed.
            </div>
          ) : (
            activity.map((item) => (
              <article key={item.id} className="activity-item">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={item.status === "success" ? "success" : "danger"}>
                        {item.status}
                      </StatusPill>
                      <span className="small-pill">
                        {item.mode === "single" ? "single event" : "demo batch"}
                      </span>
                      <span className="label-text">{formatTime(item.timestamp)}</span>
                    </div>
                    <h3 className="text-base font-semibold text-[var(--ink)]">
                      {item.category} / {item.eventType} / {item.source}
                    </h3>
                    <p className="text-sm text-[var(--ink-muted)]">{item.message}</p>
                  </div>

                  <div className="grid gap-2 text-sm text-[var(--ink-muted)] sm:grid-cols-2 lg:min-w-80">
                    <div className="mini-stat">
                      Accepted: <span className="font-semibold text-[var(--ink)]">{item.accepted}</span>
                    </div>
                    <div className="mini-stat">
                      Task IDs: <span className="font-semibold text-[var(--ink)]">{item.taskIds.length}</span>
                    </div>
                  </div>
                </div>

                {item.taskIds.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.taskIds.slice(0, 6).map((taskId) => (
                      <code key={taskId} className="code-chip">
                        {taskId}
                      </code>
                    ))}
                    {item.taskIds.length > 6 ? (
                      <span className="small-pill">+{item.taskIds.length - 6} more</span>
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
  theme,
  connectionState,
  lastUpdatedLabel,
  onRefresh,
  onToggleTheme,
}: {
  theme: Theme;
  connectionState: ConnectionState;
  lastUpdatedLabel: string;
  onRefresh: () => void | Promise<void>;
  onToggleTheme: () => void;
}) {
  return (
    <header className="flat-panel p-5 sm:p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl space-y-4">
          <p className="label-text">StreamForge</p>
          <h1 className="text-3xl font-semibold tracking-normal text-[var(--ink)] sm:text-5xl">
            Real-time event processing control plane
          </h1>
          <p className="max-w-2xl text-base leading-7 text-[var(--ink-muted)]">
            Ingest event batches, simulate traffic, and observe live processing analytics across the
            FastAPI, Redis, Celery, PostgreSQL, and SSE pipeline from one dashboard.
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            <StatusBadge connectionState={connectionState} />
            <span className="small-pill">Last updated: {lastUpdatedLabel}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button type="button" onClick={onRefresh} className="secondary-button">
            Refresh Stats
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-pressed={theme === "dark"}
            className="theme-toggle"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="flat-panel p-4">
      <p className="label-text">{label}</p>
      <p className="mt-4 break-words text-2xl font-semibold text-[var(--ink)]">{value}</p>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">{hint}</p>
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
      <p className="label-text">{eyebrow}</p>
      <h2 className="mt-2 text-xl font-semibold text-[var(--ink)] sm:text-2xl">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">{description}</p>
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
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
        <span>{label}</span>
        {required ? <span className="text-[var(--warning)]">*</span> : null}
      </div>
      {children}
      {helper ? <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">{helper}</p> : null}
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
    <div className={`feedback ${tone === "success" ? "feedback-success" : "feedback-error"}`}>
      <p>{message}</p>
      {helper ? <p className="mt-1 text-xs">{helper}</p> : null}
      {taskIds && taskIds.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {taskIds.slice(0, 5).map((taskId) => (
            <code key={taskId} className="code-chip">
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
  const tone =
    connectionState === "live" ? "success" : connectionState === "connecting" ? "warning" : "danger";

  return (
    <span className={`status-badge status-${tone}`}>
      <span className="status-dot" />
      {connectionState === "live"
        ? "Live pipeline connected"
        : connectionState === "connecting"
          ? "Connecting to live stats"
          : "Live stream disconnected"}
    </span>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  children: ReactNode;
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

function LogFeed({ items, emptyMessage }: { items: RetryLogItem[]; emptyMessage: string }) {
  return (
    <div className="mt-6 space-y-2">
      {items.length === 0 ? (
        <div className="empty-state text-left">{emptyMessage}</div>
      ) : (
        items.map((item) => (
          <div key={item.id} className={`log-line log-${item.tone}`}>
            <span>{formatClock(item.timestamp)}</span>
            <span>{item.message}</span>
          </div>
        ))
      )}
    </div>
  );
}

function LatencyRow({
  label,
  value,
  description,
}: {
  label: "p50" | "p95" | "p99";
  value: number;
  description: string;
}) {
  return (
    <tr>
      <td>{label}</td>
      <td>{value.toFixed(4)}</td>
      <td>{description}</td>
    </tr>
  );
}

function Toast({ notice }: { notice: Exclude<Notice, null> }) {
  return (
    <div
      className={`fixed right-4 top-4 z-50 max-w-[calc(100vw-2rem)] rounded-[6px] border bg-[var(--surface)] px-4 py-3 text-sm ${
        notice.tone === "success"
          ? "border-[var(--success)] text-[var(--success)]"
          : "border-[var(--danger)] text-[var(--danger)]"
      }`}
      role="status"
    >
      {notice.message}
    </div>
  );
}

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12.5 2.5a8.5 8.5 0 1 0 9 9.93 6.5 6.5 0 0 1-9-9.93Z" />
    </svg>
  );
}

function normalizeStats(payload: StatsPayload): StatsPayload {
  return {
    ...emptyStats,
    ...payload,
    latency: {
      ...emptyStats.latency,
      ...(payload.latency ?? {}),
    },
  };
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

function formatClock(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
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
  "w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-muted)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60";
