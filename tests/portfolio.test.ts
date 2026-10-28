import assert from "node:assert/strict";
import test from "node:test";
import { chartData, filterSchema, requestSchema } from "../lib/contracts";
import { demoFilter, demoReport } from "../lib/demo";
import { summarize } from "../lib/portfolio";
import { sampleHoldings } from "../lib/sample-data";
import { POST } from "../app/api/assistant/route";
import { createReport } from "../lib/assistant";

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

test("saved agent produces final outputs, retrieves artifacts and preserves response bodies", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalAgentId = process.env.OPENAI_AGENT_ID;
  const originalUri = process.env.MONGODB_URI;
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  process.env.OPENAI_API_KEY = "test-key-not-a-real-secret";
  process.env.OPENAI_AGENT_ID = "agent_test";
  delete process.env.MONGODB_URI;
  let requestedFormat = "text";
  let missingArtifact = false;
  let invalidArtifact = false;
  const finalText = "UK bonds\nOne matching holding worth £154,140.";
  const finalHtml = "<!doctype html><html><body><h1>UK bonds</h1></body></html>";
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
    content: [{ type: "output_text", text: finalText }],
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
    if (url.includes("/artifacts")) {
      if (url.endsWith("/content")) return new Response(invalidArtifact ? "invalid file" : requestedFormat === "pdf" ? "%PDF-1.7\nagent file" : new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]));
      return Response.json({ object: "list", data: missingArtifact ? [] : [{ id: "artifact_test", path: `/workspace/outputs/report.${requestedFormat === "pdf" ? "pdf" : "png"}`, turn_id: "turn_test", size_bytes: 30 }], has_more: false });
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url, body });
    if (
      url.endsWith("/agents/sessions") &&
      init?.method?.toUpperCase() === "POST"
    )
      return new Response(
        events
          .map((event) => event.type === "agent.session.turn.item.done" ? { ...event, item: { ...assistantMessage, content: [{ type: "output_text", text: requestedFormat === "html" ? finalHtml : finalText }] } } : event)
          .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    if (url.endsWith("/agents/sessions/session_test/events"))
      return new Response(null, { status: 202 });
    throw new Error(`Unexpected OpenAI request: ${url}`);
  };
  try {
    const report = await createReport("Compare UK bonds", "text");
    assert.equal(report.engine, "openai");
    assert.equal(report.format, "text");
    assert.equal(report.portfolio.total, 154140);
    assert.equal(report.portfolio.holdings.length, 1);
    assert.equal(report.output?.content, finalText);
    assert.equal(report.output?.mimeType, "text/plain");
    for (const format of ["text", "html", "chart", "image", "pdf"] as const) {
      requestedFormat = format;
      const response = await POST(new Request("http://localhost:3000/api/assistant", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "Compare UK bonds", format }),
      }));
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (format === "text") assert.equal(bytes.toString(), finalText);
      else if (format === "html") assert.equal(bytes.toString(), finalHtml);
      else if (format === "pdf") assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      else assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      const mime = format === "text" ? "text/plain" : format === "html" ? "text/html" : format === "pdf" ? "application/pdf" : "image/png";
      assert.ok(response.headers.get("content-type")?.startsWith(mime));
      const latest = requests.filter(({ url }) => url.endsWith("/agents/sessions")).at(-1)!;
      assert.equal((latest.body.environment as { type: string }).type, ["chart", "image", "pdf"].includes(format) ? "openai_hosted" : "none");
      assert.equal(JSON.parse(latest.body.input as string).format, format);
    }
    requestedFormat = "text";
    const jsonResponse = await POST(new Request("http://localhost:3000/api/assistant", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ question: "Compare UK bonds", format: "text" }),
    }));
    assert.equal((await jsonResponse.json()).output.content, finalText);
    requestedFormat = "pdf";
    missingArtifact = true;
    await assert.rejects(createReport("Compare UK bonds", "pdf"), /did not create/);
    missingArtifact = false;
    invalidArtifact = true;
    await assert.rejects(createReport("Compare UK bonds", "pdf"), /invalid output file/);
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
