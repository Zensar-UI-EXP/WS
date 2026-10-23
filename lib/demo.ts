import {
  chartData,
  money,
  regions,
  type Format,
  type Portfolio,
  type PortfolioFilter,
  type Report,
} from "./contracts";

export function demoFilter(question: string): PortfolioFilter {
  const text = question.toLowerCase();
  const assetClass = /equit|stock/.test(text)
    ? "Equities"
    : /bond|fixed income|gilt/.test(text)
      ? "Fixed income"
      : /real asset|property/.test(text)
        ? "Real assets"
        : /cash/.test(text)
          ? "Cash"
          : null;
  const region =
    regions.find((region) => text.includes(region.toLowerCase())) ??
    (/\buk\b|british/.test(text)
      ? "United Kingdom"
      : /\bus\b|american/.test(text)
        ? "United States"
        : null);
  return { assetClass, region };
}

export function demoReport(
  question: string,
  format: Format,
  portfolio: Portfolio,
): Report {
  const grouping = /region|geograph|countr/i.test(question)
    ? "region"
    : /holding|fund/i.test(question)
      ? "holding"
      : "assetClass";
  const largest = chartData(portfolio, grouping)[0];
  return {
    id: crypto.randomUUID(),
    question,
    format,
    engine: "demo",
    portfolio,
    createdAt: new Date().toISOString(),
    title: portfolio.filter.assetClass
      ? `${portfolio.filter.assetClass} at a glance`
      : portfolio.filter.region
        ? `${portfolio.filter.region} allocation`
        : grouping === "region"
          ? "A global perspective"
          : grouping === "holding"
            ? "Your holdings, in focus"
            : "A clearer view of your portfolio",
    summary: portfolio.holdings.length
      ? `Your ${portfolio.holdings.length} matching holdings have a combined value of ${money(portfolio.total)}, with an unrealised gain of ${money(portfolio.gain)} (${portfolio.gainPercent.toFixed(2)}%) versus recorded cost.`
      : "No holdings match these filters. Try another asset class or region.",
    insights: largest
      ? [
          `${largest.name} is the largest allocation at ${money(largest.value)}, representing ${(portfolio.total ? (largest.value / portfolio.total) * 100 : 0).toFixed(1)}% of this selection.`,
          `Values are denominated in GBP and reflect the snapshot dated ${portfolio.asOf}. Gains are against recorded cost, not an annualised return.`,
        ]
      : ["There is no data to visualise for this selection."],
    grouping,
    chartType: /bar|compar/i.test(question) ? "bar" : "donut",
  };
}
