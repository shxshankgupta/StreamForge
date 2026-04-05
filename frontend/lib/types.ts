export type CategoryStat = {
  category: string;
  count: number;
};

export type StatsPayload = {
  total_events: number;
  events_per_second: number;
  top_categories: CategoryStat[];
};

export type EventBatchResponse = {
  accepted: number;
  task_ids: string[];
  request_id: string;
};

export type EventRequestItem = {
  event_id: string;
  category: string;
  payload: Record<string, unknown>;
  occurred_at: string;
};

export type EventBatchRequest = {
  events: EventRequestItem[];
};

export type ConnectionState = "connecting" | "live" | "disconnected";

export type Notice = {
  tone: "success" | "error";
  message: string;
} | null;

export type ActivityItem = {
  id: string;
  mode: "single" | "batch";
  timestamp: string;
  accepted: number;
  taskIds: string[];
  category: string;
  eventType: string;
  source: string;
  status: "success" | "error";
  message: string;
};
