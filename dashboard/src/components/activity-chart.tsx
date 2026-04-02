"use client";

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from "recharts";

interface ActivityChartProps {
    data: { date: string; reviews: number }[];
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function CustomTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: string;
}) {
    if (!active || !payload?.length || !label) return null;

    return (
        <div
            style={{
                backgroundColor: "rgba(17, 24, 39, 0.95)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "10px 14px",
                backdropFilter: "blur(10px)",
            }}
        >
            <p
                style={{
                    color: "var(--foreground-dim)",
                    fontSize: "12px",
                    marginBottom: "4px",
                }}
            >
                {formatDate(label)}
            </p>
            <p
                style={{
                    color: "var(--foreground)",
                    fontSize: "16px",
                    fontWeight: 700,
                }}
            >
                {payload[0].value} review{payload[0].value !== 1 ? "s" : ""}
            </p>
        </div>
    );
}

export function ActivityChart({ data }: ActivityChartProps) {
    const maxVal = Math.max(...data.map((d) => d.reviews), 1);

    return (
        <ResponsiveContainer width="100%" height={240}>
            <BarChart
                data={data}
                margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                barCategoryGap="20%"
            >
                <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                    vertical={false}
                />
                <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    tick={{ fill: "var(--foreground-dim)", fontSize: 11 }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={false}
                    interval={1}
                />
                <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--foreground-dim)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                />
                <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: "rgba(129, 140, 248, 0.06)" }}
                />
                <Bar dataKey="reviews" radius={[6, 6, 0, 0]} maxBarSize={48}>
                    {data.map((entry, i) => (
                        <Cell
                            key={i}
                            fill={
                                entry.reviews === 0
                                    ? "var(--border)"
                                    : entry.reviews >= maxVal * 0.8
                                        ? "var(--accent)"
                                        : "rgba(129, 140, 248, 0.5)"
                            }
                        />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}
