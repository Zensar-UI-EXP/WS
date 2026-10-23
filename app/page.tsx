import Workspace from "@/components/workspace";
import { demoReport } from "@/lib/demo";
import { summarize } from "@/lib/portfolio";
import { sampleHoldings } from "@/lib/sample-data";

export default function Page() {
  const initial = demoReport(
    "Show my portfolio allocation",
    "chart",
    summarize(sampleHoldings, { assetClass: null, region: null }, "demo"),
  );
  initial.id = "overview";
  return <Workspace initial={initial} />;
}
