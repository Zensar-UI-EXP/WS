# Folio: LLM + MongoDB Reporting POC

A working Next.js 16 / React 19 application that turns portfolio questions into text, interactive charts, PNG images, HTML documents and PDF reports. OpenAI is the default LLM provider. The included investment portfolio is illustrative, not financial advice.

## Run Locally

Requires Node.js 20.9+ and npm. Node.js 22 or 24 LTS is recommended.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000. Without environment variables, the app runs in an explicitly labeled demo mode using seven sample holdings and deterministic templates. Demo mode does not call an LLM or MongoDB. Saved reports and recent explorations last for the current browser session in memory; refreshing clears them.

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
| Missing               | Missing     | Sample data + deterministic templates       |
| Valid                 | Missing     | Saved agent tool calls over sample data     |
| Missing               | Set         | Database data + deterministic templates     |
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
    Agent-->>API: Structured narrative + chart grouping
    API-->>UI: Report + source data + provenance
    UI->>UI: Render / export chart, text, PNG, HTML or PDF
```

- `app/api/assistant/route.ts`: validates requests and invokes the reporting service.
- `lib/assistant.ts`: saved Agents API session, server-side portfolio tool handler and structured report validation.
- `lib/portfolio.ts`: MongoDB connection reuse, allowlisted filters, document validation and totals.
- `lib/contracts.ts`: shared request, tool and report contracts.
- `components/workspace.tsx`: interactive charts, views, source status and session history.
- `lib/exports.ts`: escaped HTML, canvas PNGs, plain text and jsPDF documents.

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

Tests cover aggregate totals, filter validation, empty selections, request validation, same-origin protection, HTML escaping, PDF signatures and a mocked saved-agent tool-calling flow. Real OpenAI and MongoDB integration requires your credentials and is not exercised by the offline tests.

## Before Deployment

This is a localhost POC, not a production banking application. Add authentication, per-user/tenant query scoping, authorization, rate limiting, request size enforcement at the proxy, usage budgets, timeouts/cancellation, audit logs and operational monitoring. Current reads target a single shared portfolio, and any reachable API caller can read it. Origin checks are not authentication.

Database results are sent to OpenAI when a key is configured. Obtain approval before using customer or other sensitive data and review your provider's retention, region and processing policies. Use least-privilege database users and a secret manager. HTML uses escaped templates, a restrictive CSP and a sandboxed preview. The LLM is not allowed to emit executable code.
