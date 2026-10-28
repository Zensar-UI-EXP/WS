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

test("origin validation accepts the public HTTPS origin behind a proxy", async () => {
  const request = new Request("http://localhost:3000/api/assistant", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "https://folio-3000.app.github.dev",
      "x-forwarded-host": "folio-3000.app.github.dev",
      "x-forwarded-proto": "https",
      "content-type": "application/json",
    },
    body: JSON.stringify({ question: "x", format: "chart" }),
  });
  assert.equal((await POST(request)).status, 400);
});

test("origin validation accepts the request host when the forwarded host is internal", async () => {
  const request = new Request("http://localhost:3000/api/assistant", {
    method: "POST",
    headers: {
      host: "folio-3000.app.github.dev",
      origin: "https://folio-3000.app.github.dev",
      "x-forwarded-host": "localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ question: "x", format: "chart" }),
  });
  assert.equal((await POST(request)).status, 400);
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

test("saved agent uses the portfolio tool before producing a structured report", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalAgentId = process.env.OPENAI_AGENT_ID;
  const originalUri = process.env.MONGODB_URI;
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  process.env.OPENAI_API_KEY = "test-key-not-a-real-secret";
  process.env.OPENAI_AGENT_ID = "agent_test";
  delete process.env.MONGODB_URI;
  const narrative = {
    title: "UK bonds",
    summary: "One matching holding worth £154,140.",
    insights: ["Values are in GBP."],
    grouping: "holding",
    chartType: "bar",
  };
  const turn = {
    id: "turn_test",
    agent_id: "agent_test",
    completed_at: null,
    created_at: 1,
    error: null,
    object: "agent.session.turn",
    session_id: "session_test",
    started_at: 1,
    status: "in_progress",
    subagent_id: null,
    usage: null,
  };
  const session = (status: string) => ({
    id: "session_test",
    object: "agent.session",
    status,
    required_actions: [],
  });
  const functionCall = {
    id: "call_item",
    arguments: {
      assetClass: "Fixed income",
      region: "United Kingdom",
    },
    call_id: "call_portfolio",
    name: "get_portfolio",
    status: "in_progress",
    turn_id: "turn_test",
    type: "function_call",
  };
  const assistantMessage = {
    id: "message_test",
    content: [{ type: "output_text", text: JSON.stringify(narrative) }],
    phase: "final_answer",
    role: "assistant",
    status: "completed",
    turn_id: "turn_test",
    type: "message",
  };
  const events = [
    {
      event_id: "event_created",
      type: "agent.session.created",
      session: session("in_progress"),
    },
    {
      event_id: "event_turn_created",
      session_id: "session_test",
      turn_id: "turn_test",
      turn,
      type: "agent.session.turn.created",
    },
    {
      event_id: "event_tool_call",
      item: functionCall,
      output_index: 0,
      session_id: "session_test",
      turn_id: "turn_test",
      type: "agent.session.turn.item.added",
    },
    {
      event_id: "event_message_done",
      item: assistantMessage,
      output_index: 1,
      session_id: "session_test",
      turn_id: "turn_test",
      type: "agent.session.turn.item.done",
    },
    {
      event_id: "event_turn_completed",
      session_id: "session_test",
      turn_id: "turn_test",
      turn: { ...turn, completed_at: 2, status: "completed" },
      type: "agent.session.turn.completed",
      usage: null,
    },
    {
      event_id: "event_idle",
      session: session("idle"),
      type: "agent.session.idle",
    },
  ];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url, body });
    if (
      url.endsWith("/agents/sessions") &&
      init?.method?.toUpperCase() === "POST"
    )
      return new Response(
        events
          .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    if (url.endsWith("/agents/sessions/session_test/events"))
      return new Response(null, { status: 202 });
    throw new Error(`Unexpected OpenAI request: ${url}`);
  };
  try {
    const report = await createReport("Compare UK bonds", "pdf");
    assert.equal(report.engine, "openai");
    assert.equal(report.format, "pdf");
    assert.equal(report.portfolio.total, 154140);
    assert.equal(report.portfolio.holdings.length, 1);
    assert.equal(report.title, "UK bonds");
    const sessionRequest = requests.find(({ url }) =>
      url.endsWith("/agents/sessions"),
    );
    assert.equal(sessionRequest?.body.agent_id, "agent_test");
    assert.equal(
      (sessionRequest?.body.agent as { tools: { name: string }[] }).tools[0]
        .name,
      "get_portfolio",
    );
    const toolRequest = requests.find(({ url }) => url.endsWith("/events"));
    const toolResult = (
      toolRequest?.body.events as { output: string; success: boolean }[]
    )[0];
    assert.equal(toolResult.success, true);
    assert.equal(JSON.parse(toolResult.output).total, 154140);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalAgentId === undefined) delete process.env.OPENAI_AGENT_ID;
    else process.env.OPENAI_AGENT_ID = originalAgentId;
    if (originalUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalUri;
  }
});
