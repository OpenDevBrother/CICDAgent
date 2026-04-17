// ============================================================================
// GET /api/watchdog/metrics
//
// Returns current infrastructure metrics snapshot.
// Query params: ?metrics=error_rate,cpu_usage (comma-separated, optional)
// Uses CloudWatch when AWS_REGION is set, otherwise falls back to mock data.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { getMetrics, getMetricsWithCloudWatch, MetricName } from "@/lib/mcp/watchdog";

const VALID_METRICS: MetricName[] = [
  "error_rate", "latency_p95", "cpu_usage", "memory_usage", "request_count",
];

export async function GET(request: NextRequest) {
  const metricsParam = request.nextUrl.searchParams.get("metrics");

  let metricNames: MetricName[] | undefined;
  if (metricsParam) {
    const requested = metricsParam.split(",").map((m) => m.trim()) as MetricName[];
    const invalid = requested.filter((m) => !VALID_METRICS.includes(m));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid metrics: ${invalid.join(", ")}. Valid: ${VALID_METRICS.join(", ")}` },
        { status: 400 }
      );
    }
    metricNames = requested;
  }

  const useCloudWatch = !!(process.env.AWS_REGION || process.env.AWS_BEDROCK_REGION);
  const snapshots = useCloudWatch
    ? await getMetricsWithCloudWatch(metricNames)
    : getMetrics(metricNames);

  return NextResponse.json({
    metrics: snapshots,
    count: snapshots.length,
    source: useCloudWatch ? "cloudwatch" : "mock",
  });
}
