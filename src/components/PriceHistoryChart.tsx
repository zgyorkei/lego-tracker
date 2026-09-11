import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export interface PricePoint {
  date: string;
  label: string;
  value: number;
}

interface PriceHistoryChartProps {
  data: PricePoint[];
  displayCurrency: string;
}

/**
 * Recharts pulls in ~350 kB (it and its d3 dependencies). This lives in its
 * own module so SetCard can lazy-load it: only a user who actually expands
 * the price-history panel downloads the charting library.
 */
export default function PriceHistoryChart({ data, displayCurrency }: PriceHistoryChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fontWeight: 700 }}
          stroke="#9ca3af"
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis
          tick={{ fontSize: 9, fontWeight: 700 }}
          stroke="#9ca3af"
          tickLine={false}
          axisLine={false}
          width={44}
          domain={['auto', 'auto']}
          tickFormatter={(v: number) => Math.round(v).toLocaleString()}
        />
        <Tooltip
          formatter={(v) => [
            `${Math.round(Number(v)).toLocaleString()} ${displayCurrency}`,
            'Lowest',
          ]}
          contentStyle={{
            border: '2px solid black',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
          }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#2563eb"
          strokeWidth={2.5}
          dot={{ r: 2.5 }}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
