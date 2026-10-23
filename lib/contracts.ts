import { z } from "zod";

export const assetClasses = [
  "Equities",
  "Fixed income",
  "Real assets",
  "Cash",
] as const;
export const regions = [
  "Global",
  "United Kingdom",
  "United States",
  "Asia Pacific",
  "Europe",
] as const;
export const formats = ["chart", "text", "image", "html", "pdf"] as const;
export type Format = (typeof formats)[number];
export const filterSchema = z
  .object({
    assetClass: z.enum(assetClasses).nullable(),
    region: z.enum(regions).nullable(),
  })
  .strict();
export type PortfolioFilter = z.infer<typeof filterSchema>;
export const holdingSchema = z.object({
  id: z.string(),
  name: z.string(),
  ticker: z.string(),
  assetClass: z.enum(assetClasses),
  region: z.enum(regions),
  value: z.number().finite().nonnegative(),
  cost: z.number().finite().positive(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type Holding = z.infer<typeof holdingSchema>;
export const narrativeSchema = z.object({
  title: z.string(),
  summary: z.string(),
  insights: z.array(z.string()),
  grouping: z.enum(["assetClass", "region", "holding"]),
  chartType: z.enum(["bar", "donut"]),
});
export type Narrative = z.infer<typeof narrativeSchema>;
export const requestSchema = z
  .object({
    question: z.string().trim().min(3).max(2000),
    format: z.enum(formats),
  })
  .strict();
export type Portfolio = {
  holdings: Holding[];
  total: number;
  cost: number;
  gain: number;
  gainPercent: number;
  asOf: string | null;
  source: "demo" | "mongodb";
  filter: PortfolioFilter;
};
export type Report = Narrative & {
  id: string;
  question: string;
  format: Format;
  engine: "demo" | "openai";
  portfolio: Portfolio;
  createdAt: string;
};

export function chartData(
  portfolio: Portfolio,
  grouping: Narrative["grouping"],
) {
  const grouped = new Map<string, number>();
  for (const holding of portfolio.holdings) {
    const name = grouping === "holding" ? holding.name : holding[grouping];
    grouped.set(name, (grouped.get(name) ?? 0) + holding.value);
  }
  return Array.from(grouped, ([name, value]) => ({ name, value })).sort(
    (first, second) => second.value - first.value,
  );
}

export const money = (value: number, compact = false) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
    ...(compact
      ? { notation: "compact" as const, maximumFractionDigits: 2 }
      : {}),
  }).format(value);
