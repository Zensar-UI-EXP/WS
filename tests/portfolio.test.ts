import assert from "node:assert/strict";
import test from "node:test";
import { chartData, filterSchema, requestSchema } from "../lib/contracts";
import { demoFilter, demoReport } from "../lib/demo";
import { summarize } from "../lib/portfolio";
import { sampleHoldings } from "../lib/sample-data";
import { POST } from "../app/api/assistant/route";
import { createReport } from "../lib/assistant";
import { reportHtml, reportPdf, reportText } from "../lib/exports";

const noFilter = { assetClass: null, region: null };
test("portfolio and chart totals reconcile with recorded holdings", () => {
  const portfolio = summarize(sampleHoldings, noFilter, "demo");
  assert.equal(portfolio.total, 1284500);
  assert.equal(portfolio.gain, 93050);
  assert.equal(
    chartData(portfolio, "assetClass").reduce(
      (sum, item) => sum + item.value,
      0,
    ),
    portfolio.total,
  );
  assert.equal(
    chartData(portfolio, "region").reduce((sum, item) => sum + item.value, 0),
    portfolio.total,
  );
});
test("query tools reject arbitrary operators and unrecognised filters", () => {
  assert.equal(
    filterSchema.safeParse({ ...noFilter, $where: "anything" }).success,
    false,
  );
  assert.equal(
    filterSchema.safeParse({ assetClass: { $ne: null }, region: null }).success,
    false,
  );
  assert.equal(
    filterSchema.safeParse({ assetClass: "Unknown", region: null }).success,
    false,
  );
});
test("zero-value holdings never produce non-finite allocation percentages", () => {
  const portfolio = summarize([{ ...sampleHoldings[0], value: 0 }], noFilter, "demo");
  const report = demoReport("Portfolio", "chart", portfolio);
  assert.ok(report.insights[0].includes("0.0%"));
  assert.ok(!JSON.stringify(report).includes("NaN"));
});

test("filters intersect and empty results remain finite", () => {
  const portfolio = summarize(
    sampleHoldings,
    { assetClass: "Cash", region: "Europe" },
    "demo",
  );
  assert.equal(portfolio.total, 0);
  assert.equal(portfolio.gainPercent, 0);
  assert.equal(portfolio.asOf, null);
  assert.equal(
    demoReport("Cash in Europe", "chart", portfolio).insights.length,
    1,
  );
});
test("demo filtering recognises UK bonds and grouping preserves data", () => {
  const filter = demoFilter("Compare UK bonds");
  assert.deepEqual(filter, {
    assetClass: "Fixed income",
    region: "United Kingdom",
  });
  const portfolio = summarize(sampleHoldings, filter, "demo");
  assert.equal(portfolio.total, 154140);
  assert.equal(
    demoReport("Compare UK bonds", "pdf", portfolio).chartType,
    "bar",
  );
});
test("request contract validates formats and question bounds", () => {
  assert.equal(
    requestSchema.safeParse({ question: " ", format: "chart" }).success,
    false,
  );
  assert.equal(
    requestSchema.safeParse({ question: "Portfolio", format: "script" })
      .success,
    false,
  );
  assert.equal(
    requestSchema.safeParse({ question: "Portfolio", format: "pdf" }).success,
    true,
  );
});

test("origin validation respects the incoming host and rejects foreign origins", async () => {
  const request = (origin: string) =>
    new Request("http://localhost:3000/api/assistant", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ question: "x", format: "chart" }),
    });
  assert.equal((await POST(request("http://127.0.0.1:3000"))).status, 400);
  assert.equal((await POST(request("https://untrusted.example"))).status, 403);
  assert.equal((await POST(request("http://localhost:3000"))).status, 403);
});

test("HTML exports escape model text and PDF exports contain a real PDF document", async () => {
  const report = demoReport(
    "Portfolio",
    "html",
    summarize(sampleHoldings, noFilter, "demo"),
  );
  report.title = '<script>alert("test")</script>';
  const html = reportHtml(report);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Content-Security-Policy"));
  assert.ok(reportText(report).includes("£1,284,500"));
  const pdf = await reportPdf(report);
  assert.equal((await pdf.text()).slice(0, 5), "%PDF-");
});

test("OpenAI tool calling retrieves validated data before producing a structured report", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalUri = process.env.MONGODB_URI;
  const requests: Record<string, unknown>[] = [];
  process.env.OPENAI_API_KEY = "test-key-not-a-real-secret";
  delete process.env.MONGODB_URI;
  const narrative = {
    title: "UK bonds",
    summary: "One matching holding worth £154,140.",
    insights: ["Values are in GBP."],
    grouping: "holding",
    chartType: "bar",
  };
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const message =
      requests.length === 1
        ? {
            role: "assistant",
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: "call_portfolio",
                type: "function",
                function: {
                  name: "get_portfolio",
                  arguments: JSON.stringify({
                    assetClass: "Fixed income",
                    region: "United Kingdom",
                  }),
                },
              },
            ],
          }
        : {
            role: "assistant",
            content:
              requests.length === 2
                ? "Data retrieved."
                : JSON.stringify(narrative),
            refusal: null,
          };
    return new Response(
      JSON.stringify({
        id: "test-completion",
        object: "chat.completion",
        created: 1,
        model: "test",
        choices: [
          {
            index: 0,
            message,
            finish_reason: requests.length === 1 ? "tool_calls" : "stop",
            logprobs: null,
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
  };
  try {
    const report = await createReport("Compare UK bonds", "pdf");
    assert.equal(report.engine, "openai");
    assert.equal(report.format, "pdf");
    assert.equal(report.portfolio.total, 154140);
    assert.equal(report.portfolio.holdings.length, 1);
    assert.equal(report.title, "UK bonds");
    assert.equal(requests.length, 3);
    assert.ok(JSON.stringify(requests[1].messages).includes('"role":"tool"'));
    assert.ok(
      JSON.stringify(requests[2].response_format).includes("json_schema"),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalUri;
  }
});
