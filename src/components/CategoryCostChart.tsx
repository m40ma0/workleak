import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "../lib/utils";

interface CategoryCostChartProps {
  data: { category: string; cost: number; fill: string }[];
}

export default function CategoryCostChart({ data }: CategoryCostChartProps) {
  return (
    <div className="mx-auto h-72 w-full max-w-[680px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 64, left: 8, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => `$${Number(value) / 1000}k`}
          />
          <YAxis
            type="category"
            dataKey="category"
            width={116}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))" }}
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
            }}
            formatter={(value) => formatCurrency(Number(value))}
          />
          <Bar dataKey="cost" radius={[0, 6, 6, 0]}>
            {data.map((entry) => (
              <Cell key={entry.category} fill={entry.fill} />
            ))}
            <LabelList
              dataKey="cost"
              position="right"
              formatter={(value: number) => formatCurrency(value)}
              className="fill-foreground text-xs font-semibold"
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
