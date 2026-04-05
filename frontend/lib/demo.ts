import type { EventRequestItem } from "@/lib/types";

const EVENT_TYPES_BY_CATEGORY: Record<string, string[]> = {
  orders: ["order_created", "order_paid", "order_fulfilled"],
  payments: ["payment_authorized", "payment_settled", "refund_initiated"],
  alerts: ["threshold_breach", "service_degraded", "incident_opened"],
  shipments: ["shipment_created", "shipment_picked", "shipment_delivered"],
  analytics: ["dashboard_viewed", "report_generated", "cohort_computed"],
};

const SOURCES = ["edge-gateway", "checkout-service", "billing-core", "ops-monitor"];

export const DEMO_CATEGORY_OPTIONS = Object.keys(EVENT_TYPES_BY_CATEGORY);

export function buildDemoEvents(count: number, category: string, source: string): EventRequestItem[] {
  const normalizedCategory = category.trim().toLowerCase();
  const eventTypes = EVENT_TYPES_BY_CATEGORY[normalizedCategory] ?? [
    `${normalizedCategory}_received`,
    `${normalizedCategory}_processed`,
    `${normalizedCategory}_completed`,
  ];

  return Array.from({ length: count }, (_, index) => {
    const eventType = eventTypes[index % eventTypes.length];
    const fallbackSource = SOURCES[index % SOURCES.length];
    const amount = Number((25 + index * 1.73).toFixed(2));

    return {
      event_id: crypto.randomUUID(),
      category: normalizedCategory,
      occurred_at: new Date().toISOString(),
      payload: {
        event_type: eventType,
        source: source.trim() || fallbackSource,
        priority: index % 5 === 0 ? "high" : "normal",
        partition_hint: index % 12,
        customer_id: `cust-${(1000 + index).toString(16)}`,
        amount,
        region: ["us-east-1", "eu-west-1", "ap-south-1"][index % 3],
        trace_id: crypto.randomUUID(),
        submitted_from: "streamforge-control-plane",
      },
    };
  });
}
