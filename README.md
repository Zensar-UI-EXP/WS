# Folio: LLM + MongoDB Reporting POC

A working Next.js 16 / React 19 application that turns portfolio questions into agent-authored text, chart images, PNG images, HTML documents and PDF reports. OpenAI is the default LLM provider. The included investment portfolio is illustrative, not financial advice.

## Run Locally

Requires Node.js 20.9+ and npm. Node.js 22 or 24 LTS is recommended.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000. Without environment variables, the app shows an explicitly labeled sample portfolio overview. Generate requires an OpenAI API key and saved agent ID; it never substitutes formatting templates for agent output. Saved reports and recent explorations last for the current browser session in memory; refreshing clears them.

## Connect OpenAI and MongoDB

Create and save an agent in the same OpenAI Platform project as your API key. Copy the `agent_...` ID from its URL. The app supplies its `get_portfolio` function for each session, so the agent's model and base instructions stay configured in the platform.

Create an application API key in that project with `api.agents.read`, `api.agents.write` and `api.responses.write` permissions. Then create `.env.local` using the keys listed in `.env.example`:

```dotenv
OPENAI_API_KEY=your-project-api-key
OPENAI_AGENT_ID=agent_...
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=folio_poc
```

The agent ID is not an API key. Use the saved agent's model in the platform; the app validates its report output before rendering. Use a local MongoDB instance or an Atlas connection string. For Atlas, allow your server IP and configure a database user. Do not use a `NEXT_PUBLIC_` prefix for credentials.

```sh
npm run seed
npm run dev
```

Restart the development server after changing environment variables. The seed command inserts missing sample holdings without overwriting existing records, and creates a unique `holdings.id` index. Use a separate database for this POC. The seed user needs write/index permissions; the application itself should use a different MongoDB user with only `read` permission on the POC database.

API usage may incur charges. Never enter API keys in the chat UI.

| OpenAI key + agent ID | MongoDB URI | Behaviour                                   |
| --------------------- | ----------- | ------------------------------------------- |
| Missing               | Missing     | Sample overview; generation requires OpenAI       |
| Valid                 | Missing     | Saved agent tool calls over sample data     |
| Missing               | Set         | Database overview; generation requires OpenAI     |
| Valid                 | Set         | Full frontend → saved agent → MongoDB → report flow |

Configured service failures return an error; they never silently substitute demo data. The initial screen contains an explicitly labeled sample snapshot, replaced after the connection check if MongoDB is configured. The snapshot itself is template-generated; click Generate to call the LLM. An empty collection returns an empty report, not seeded data.

## Data Flow

```mermaid
sequenceDiagram
    participant UI as React / Next.js UI
    participant API as Next.js API
    participant Agent as OpenAI saved agent
    participant DB as MongoDB
    UI->>API: POST /api/assistant {question, format}
    API->>Agent: Start session with question and read-only tool
    Agent->>API: get_portfolio(assetClass, region)
    API->>API: Zod validation + allowlisted query
    API->>DB: Read holdings with bounded filters
    DB-->>API: Portfolio snapshot
    API-->>Agent: Holdings + calculated totals
    Agent-->>API: Finished text/HTML or hosted PNG/PDF artifact
    API-->>UI: Final output + metadata when JSON is requested
    UI->>UI: Display final output; download original file
```

- `app/api/assistant/route.ts`: validates requests and invokes the reporting service.
- `lib/assistant.ts`: saved Agents API session, server-side portfolio tool handler and finished output retrieval and file signature validation.
- `lib/portfolio.ts`: MongoDB connection reuse, allowlisted filters, document validation and totals.
- `lib/contracts.ts`: shared request, tool and report contracts.
- `components/workspace.tsx`: interactive charts, views, source status and session history.
- `lib/exports.ts`: shared overview chart palette.

The LLM cannot execute arbitrary database queries, JavaScript or HTML. It can only request `get_portfolio` with an optional asset class and region. Charts use server-calculated values from the returned holdings; they do not use model-invented numbers. Natural-language observations are still model output and should be reviewed.

## Try It

- “Show my portfolio allocation by asset class” → Chart.
- “Compare all my holdings in a bar chart” → Chart.
- “Show my portfolio allocation by region” → Image.
- “Summarise my UK bonds” → Text.
- “Create a report of my portfolio allocation” → HTML or PDF.

Use the output selector before generating. Download supports PNG, PDF, HTML and TXT regardless of preview format. Chart mode offers donut/bar toggles. Underlying data includes search. Image output means a rendered portfolio visualisation, not text-to-image artwork. No separate image-generation model is called. PDF previews depend on browser support; PDF download works independently.

Demo parsing is deliberately limited to asset-class/region keywords and grouping. It is not general natural-language reasoning. The dataset is a dated GBP snapshot with current value and recorded cost. It cannot answer historical performance, live prices, forecasts, transactions or questions about other datasets. The tool reads at most 200 holdings; larger selections must be narrowed. Gains are unrealised changes versus cost, not annualised investment returns.

## Verification

```sh
npm test
npm run typecheck
npm run build
npm audit --audit-level=moderate
```

Tests cover aggregate totals, filter validation, empty selections, request validation, same-origin protection, final text/HTML preservation, PNG/PDF signatures and a mocked saved-agent tool-calling flow. Real OpenAI and MongoDB integration requires your credentials and is not exercised by the offline tests.

## Before Deployment

This is a localhost POC, not a production banking application. Add authentication, per-user/tenant query scoping, authorization, rate limiting, request size enforcement at the proxy, usage budgets, timeouts/cancellation, audit logs and operational monitoring. Current reads target a single shared portfolio, and any reachable API caller can read it. Origin checks are not authentication.

Database results are sent to OpenAI when a key is configured. Obtain approval before using customer or other sensitive data and review your provider's retention, region and processing policies. Use least-privilege database users and a secret manager. Agent-authored HTML uses a restrictive CSP and sandboxed preview. Chart, image and PDF generation execute inside an OpenAI-hosted sandbox with network access disabled.

## Agent-generated output

Every Generate request passes both `question` and `format` to the saved agent. The agent must retrieve the portfolio using `get_portfolio`. Text and HTML are its complete final answer; chart/image/PDF requests enable an OpenAI-hosted environment and require a real file under `/workspace/outputs`. Hosted sandbox access is required for these file formats and can incur container charges. Generation has a 300-second server duration allowance; deployment timeouts must support it.

By default, `POST /api/assistant` returns the final content with `text/plain`, `text/html`, `image/png` (chart/image), or `application/pdf`. HTML is served as an attachment. Errors remain JSON with a non-success status. Set `Accept: application/json` to receive report metadata plus `output: { mimeType, encoding, content, filename }`; binary content uses base64. The frontend uses this envelope for history and holdings, and displays the original content without report-formatting functions. Downloading the current format reuses the original output; selecting a different export format asks the agent to generate it again.

The initial overview remains a local sample/data snapshot, not a generated report. The former `reportText`, `reportHtml`, `reportImage`, and `reportPdf` formatters have been removed.
