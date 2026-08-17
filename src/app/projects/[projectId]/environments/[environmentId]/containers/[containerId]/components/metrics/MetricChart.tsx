"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { formatBytes } from "@/lib/format-bytes";
import type { AppMetric, AppMetricPoint } from "../../types/app-detail-types";

/**
 * A metric over time, with the value and clock time of whatever the pointer is
 * nearest to.
 *
 * This replaces a sparkline whose shape was generated from the current value,
 * so the peaks it drew never happened. Everything here comes from recorded
 * samples, which is why an empty series says so instead of drawing a flat line
 * that would read as "idle".
 */

const WIDTH = 240;
const HEIGHT = 56;
const PADDING_TOP = 4;
const PADDING_BOTTOM = 3;

interface MetricChartProps {
  series: AppMetricPoint[];
  color: string;
  format: AppMetric["format"];
}

export function formatMetricValue(
  value: number,
  format: AppMetric["format"],
): string {
  if (format === "percent") return `${value.toFixed(2)}%`;
  if (format === "bytes") return formatBytes(value, "");
  if (format === "bytesPerSecond") return formatBytes(value, "/s");
  return String(Math.round(value));
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAxisLabel(at: number, spansMoreThanADay: boolean): string {
  const date = new Date(at);
  if (!spansMoreThanADay) return formatClock(at);

  return `${date.toLocaleDateString([], { day: "2-digit", month: "short" })} ${formatClock(at)}`;
}

export default function MetricChart({
  series,
  color,
  format,
}: MetricChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const geometry = useMemo(() => {
    if (series.length === 0) return null;

    const values = series.map((point) => point.value);
    const max = Math.max(...values);
    const min = Math.min(...values, 0);
    // A flat series would divide by zero and collapse onto one edge.
    const range = Math.max(max - min, 1e-9);

    const xFor = (index: number) =>
      series.length === 1
        ? WIDTH / 2
        : (index / (series.length - 1)) * WIDTH;
    const yFor = (value: number) =>
      HEIGHT -
      PADDING_BOTTOM -
      ((value - min) / range) * (HEIGHT - PADDING_TOP - PADDING_BOTTOM);

    const line = series
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(2)} ${yFor(point.value).toFixed(2)}`,
      )
      .join(" ");

    return { line, xFor, yFor, max };
  }, [series]);

  const spansMoreThanADay = useMemo(() => {
    if (series.length < 2) return false;
    return series[series.length - 1].at - series[0].at > 24 * 60 * 60 * 1000;
  }, [series]);

  const handleMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || series.length === 0) return;

      const bounds = svg.getBoundingClientRect();
      if (bounds.width === 0) return;

      const ratio = (event.clientX - bounds.left) / bounds.width;
      const index = Math.round(ratio * (series.length - 1));
      setHoverIndex(Math.min(series.length - 1, Math.max(0, index)));
    },
    [series.length],
  );

  if (series.length === 0 || !geometry) {
    return (
      <div
        style={{
          height: HEIGHT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px dashed var(--border)",
          borderRadius: 6,
          color: "var(--text-muted)",
          fontSize: 11,
        }}
      >
        No samples recorded yet
      </div>
    );
  }

  const hovered = hoverIndex === null ? null : series[hoverIndex];

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${series.length} recorded samples, latest ${formatMetricValue(series[series.length - 1].value, format)}`}
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIndex(null)}
        style={{ width: "100%", height: HEIGHT, display: "block", touchAction: "none" }}
      >
        <path
          d={`${geometry.line} L ${WIDTH} ${HEIGHT} L 0 ${HEIGHT} Z`}
          fill={color}
          opacity="0.11"
        />
        <path
          d={geometry.line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {hovered && hoverIndex !== null ? (
          <>
            <line
              x1={geometry.xFor(hoverIndex)}
              x2={geometry.xFor(hoverIndex)}
              y1={0}
              y2={HEIGHT}
              stroke="var(--text-muted)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              opacity="0.5"
            />
            <circle
              cx={geometry.xFor(hoverIndex)}
              cy={geometry.yFor(hovered.value)}
              r="2.5"
              fill={color}
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : null}
      </svg>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 2,
          color: "var(--text-muted)",
          fontSize: 10,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{formatAxisLabel(series[0].at, spansMoreThanADay)}</span>
        <span>
          {formatAxisLabel(series[series.length - 1].at, spansMoreThanADay)}
        </span>
      </div>

      {hovered ? (
        <div
          style={{
            position: "absolute",
            top: -6,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              padding: "2px 7px",
              color: "var(--text-primary)",
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {formatAxisLabel(hovered.at, spansMoreThanADay)} ·{" "}
            {formatMetricValue(hovered.value, format)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
