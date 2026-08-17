import type { AppMetric } from "../../types/app-detail-types";
import MetricChart from "./MetricChart";

const toneColor: Record<AppMetric["tone"], string> = {
  blue: "#3b82f6",
  green: "#22c55e",
  purple: "#8b5cf6",
  amber: "#f59e0b",
  cyan: "#06b6d4",
};

interface AppMetricCardProps {
  metric: AppMetric;
}

export default function AppMetricCard({ metric }: AppMetricCardProps) {
  const color = toneColor[metric.tone];

  return (
    <article
      className="card"
      style={{
        padding: 14,
        minHeight: 112,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "var(--bg-card)",
      }}
    >
      <div>
        <p style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 700 }}>
          {metric.label}
        </p>
        <strong
          style={{
            display: "block",
            color: "var(--text-primary)",
            fontSize: 20,
            lineHeight: 1.2,
            marginTop: 4,
          }}
        >
          {metric.value}
        </strong>
      </div>
      <div style={{ marginTop: 8 }}>
        <MetricChart
          series={metric.series}
          color={color}
          format={metric.format}
        />
        <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>
          {metric.subvalue}
        </p>
      </div>
    </article>
  );
}
