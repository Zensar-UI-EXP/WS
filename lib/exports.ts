import { chartData, money, type Report } from "./contracts";

export const palette = [
  "#267766",
  "#80b4a5",
  "#edaa91",
  "#e2c56e",
  "#779cb6",
  "#b5b9bd",
  "#b0cc76",
];

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

export function reportText(report: Report) {
  return [
    report.title,
    "",
    report.summary,
    "",
    ...report.insights.map((insight) => `- ${insight}`),
    "",
    "ALLOCATION (GBP)",
    ...chartData(report.portfolio, report.grouping).map(
      (item) => `${item.name}: ${money(item.value)}`,
    ),
    "",
    `Data: ${report.portfolio.source}; engine: ${report.engine}; snapshot: ${report.portfolio.asOf ?? "no matching data"}`,
    "Illustrative POC. Not investment advice.",
  ].join("\n");
}

export function reportHtml(report: Report) {
  const data = chartData(report.portfolio, report.grouping);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(report.title)}</title><style>body{font:15px/1.7 Georgia,serif;color:#24352f;background:#fff;margin:0;padding:32px;overflow-wrap:anywhere}main{max-width:780px;margin:auto}h1{font-size:30px;line-height:1.25}small{color:#63746d}header{border-bottom:1px solid #dce5df;padding-bottom:16px;color:#267766}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{text-align:left;padding:12px 6px;border-bottom:1px solid #e5eae6}td:last-child,th:last-child{text-align:right}footer{border-top:1px solid #dce5df;padding-top:16px;font-size:12px;color:#63746d}.bar{height:8px;background:#edf2ef;margin:8px 0}.fill{height:8px;background:#267766}</style></head><body><main><header>FOLIO / PORTFOLIO INTELLIGENCE</header><h1>${escapeHtml(report.title)}</h1><small>Snapshot: ${escapeHtml(report.portfolio.asOf ?? "No matching data")} · GBP</small><p>${escapeHtml(report.summary)}</p><h2>Allocation</h2>${data.map((item) => `<div>${escapeHtml(item.name)} <strong>${escapeHtml(money(item.value))}</strong><div class="bar"><div class="fill" style="width:${report.portfolio.total ? (item.value / report.portfolio.total) * 100 : 0}%"></div></div></div>`).join("")}<h2>Observations</h2><ul>${report.insights.map((insight) => `<li>${escapeHtml(insight)}</li>`).join("")}</ul><h2>Underlying holdings</h2><table><thead><tr><th>Holding</th><th>Asset class</th><th>Value</th></tr></thead><tbody>${report.portfolio.holdings.map((holding) => `<tr><td>${escapeHtml(holding.name)}</td><td>${escapeHtml(holding.assetClass)}</td><td>${escapeHtml(money(holding.value))}</td></tr>`).join("")}</tbody></table><footer>Data: ${escapeHtml(report.portfolio.source)} · Engine: ${escapeHtml(report.engine)} · Illustrative POC. Not investment advice.</footer></main></body></html>`;
}

export function reportImage(report: Report): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 1100;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser does not support image export.");
  context.fillStyle = "#f7f9f7";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#267766";
  context.font = '600 24px "DM Sans", sans-serif';
  context.fillText("FOLIO  /  PORTFOLIO INTELLIGENCE", 80, 86);
  context.fillStyle = "#20372e";
  const drawWrapped = (
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number,
  ) => {
    const words = text.split(/\s+/);
    let line = "";
    let lineIndex = 0;
    for (const word of words) {
      if (context.measureText(`${line} ${word}`).width > maxWidth && line) {
        context.fillText(line, x, y + lineIndex * lineHeight, maxWidth);
        lineIndex++;
        line = word;
        if (lineIndex === maxLines - 1) break;
      } else line = line ? `${line} ${word}` : word;
    }
    context.fillText(
      lineIndex === maxLines - 1 ? `${line}...` : line,
      x,
      y + lineIndex * lineHeight,
      maxWidth,
    );
  };
  context.font = '600 45px "DM Sans", sans-serif';
  drawWrapped(report.title, 80, 164, 1440, 54, 2);
  context.font = '26px "DM Sans", sans-serif';
  context.fillStyle = "#65736b";
  context.fillText(
    `Total value ${money(report.portfolio.total)}  |  As of ${report.portfolio.asOf ?? "N/A"}`,
    80,
    280,
  );
  const data = chartData(report.portfolio, report.grouping);
  const visible =
    data.length > 7
      ? [
          ...data.slice(0, 6),
          {
            name: "Other holdings",
            value: data.slice(6).reduce((sum, item) => sum + item.value, 0),
          },
        ]
      : data;
  const maximum = Math.max(...visible.map((item) => item.value), 1);
  visible.forEach((item, index) => {
    const y = 350 + index * 77;
    context.fillStyle = "#33483d";
    context.font = '22px "DM Sans", sans-serif';
    context.fillText(item.name, 80, y, 375);
    context.fillStyle = palette[index % palette.length];
    context.fillRect(470, y - 23, (item.value / maximum) * 760, 32);
    context.fillStyle = "#33483d";
    context.fillText(money(item.value), 1280, y, 240);
  });
  context.font = '22px "DM Sans", sans-serif';
  context.fillStyle = "#65736b";
  drawWrapped(report.summary, 80, 950, 1440, 32, 2);
  context.font = '18px "DM Sans", sans-serif';
  context.fillText(
    `Data: ${report.portfolio.source} | Engine: ${report.engine} | Illustrative POC. Not investment advice.`,
    80,
    1050,
  );
  return canvas.toDataURL("image/png");
}

export async function reportPdf(report: Report): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF();
  let y = 22;
  const line = (text: string, size = 11, color = "#33483d") => {
    pdf.setFontSize(size);
    pdf.setTextColor(color);
    const lines = pdf.splitTextToSize(text, 170) as string[];
    for (const segment of lines) {
      if (y > 275) {
        pdf.addPage();
        y = 22;
      }
      pdf.text(segment, 20, y);
      y += size * 0.45 + 2;
    }
    y += 3;
  };
  line("FOLIO / PORTFOLIO INTELLIGENCE", 10, "#267766");
  line(report.title, 23);
  line(
    `Snapshot: ${report.portfolio.asOf ?? "No matching data"} | Values in GBP`,
    10,
  );
  line(report.summary);
  line("Observations", 15);
  report.insights.forEach((insight) => line(`- ${insight}`));
  line("Allocation", 15);
  chartData(report.portfolio, report.grouping).forEach((item) =>
    line(`${item.name}: ${money(item.value)}`),
  );
  line("Underlying holdings", 15);
  report.portfolio.holdings.forEach((holding) =>
    line(
      `${holding.name} | ${holding.assetClass} | ${money(holding.value)}`,
      10,
    ),
  );
  line(
    `Data: ${report.portfolio.source} | Engine: ${report.engine}. Illustrative POC. Not investment advice.`,
    9,
    "#65736b",
  );
  return pdf.output("blob");
}

export async function downloadReport(
  report: Report,
  format: "png" | "pdf" | "html" | "txt",
) {
  const blob =
    format === "pdf"
      ? await reportPdf(report)
      : format === "png"
        ? await (await fetch(reportImage(report))).blob()
        : new Blob(
            [format === "html" ? reportHtml(report) : reportText(report)],
            {
              type:
                format === "html"
                  ? "text/html;charset=utf-8"
                  : "text/plain;charset=utf-8",
            },
          );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `folio-${report.id.slice(0, 8)}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
