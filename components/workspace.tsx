"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Database,
  FileText,
  ImageIcon,
  Layers3,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Network,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Wallet,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  chartData,
  money,
  type Format,
  type Portfolio,
  type Report,
} from "@/lib/contracts";
import { demoReport } from "@/lib/demo";
import { palette } from "@/lib/exports";

const outputFormats = [
  { id: "chart", label: "Chart", Icon: BarChart3 },
  { id: "text", label: "Text", Icon: FileText },
  { id: "image", label: "Image", Icon: ImageIcon },
  { id: "html", label: "HTML", Icon: Code2 },
  { id: "pdf", label: "PDF", Icon: ArrowDownToLine },
] as const;
const suggestions = [
  {
    label: "Break down my portfolio",
    question: "Show my portfolio allocation by asset class",
    Icon: Layers3,
  },
  {
    label: "Compare my holdings",
    question: "Compare all my holdings in a bar chart",
    Icon: BarChart3,
  },
  {
    label: "Explore by region",
    question: "Show my portfolio allocation by region",
    Icon: Network,
  },
];
type Status = { llm: "openai" | "demo"; database: "mongodb" | "demo" };
type Modal = "connections" | "architecture" | null;

function outputBlob(output: NonNullable<Report["output"]>) {
  const content = output.encoding === "base64"
    ? Uint8Array.from(atob(output.content), (character) => character.charCodeAt(0))
    : output.content;
  return new Blob([content], { type: output.mimeType });
}

function ReportPreview({ report }: { report: Report }) {
  const output = report.output;
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!output || output.encoding !== "base64") return;
    const nextUrl = URL.createObjectURL(outputBlob(output));
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [output]);
  if (!output) return <p className="preview-note">Generate a report to see the agent’s output.</p>;
  if (output.mimeType === "text/plain") {
    return <article className="text-report" style={{ whiteSpace: "pre-wrap" }}>{output.content}</article>;
  }
  if (output.mimeType === "text/html") {
    return <iframe title="HTML report preview" className="document-preview" sandbox="" srcDoc={
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">${output.content}`
    } />;
  }
  if (!url) return <div className="preview-loading"><LoaderCircle className="spin" /> Loading report</div>;
  if (output.mimeType === "image/png") {
    return <img className="image-preview" src={url} alt={report.title} />;
  }
  return <iframe title="PDF report preview" className="document-preview" src={url} />;
}

export default function Workspace({ initial }: { initial: Report }) {
  const [report, setReport] = useState(initial);
  const [question, setQuestion] = useState("");
  const [format, setFormat] = useState<Format>("chart");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [tab, setTab] = useState<"preview" | "holdings" | "insights">(
    "preview",
  );
  const [history, setHistory] = useState<Report[]>([]);
  const [saved, setSaved] = useState<Report[]>([]);
  const [page, setPage] = useState<"assistant" | "saved">("assistant");
  const [modal, setModal] = useState<Modal>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [connecting, setConnecting] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const requestInFlight = useRef(false);
  const sourceReady = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function refreshStatus() {
    setConnecting(true);
    setConnectionError("");
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Connection check failed.");
      setStatus({ llm: result.llm, database: result.database });
      const snapshot = demoReport(
        "Show my portfolio allocation",
        "chart",
        result.portfolio as Portfolio,
      );
      snapshot.id = "overview";
      if (!sourceReady.current) setReport(snapshot);
      sourceReady.current = true;
    } catch (failure) {
      setStatus(null);
      setConnectionError(
        failure instanceof Error ? failure.message : "Connection check failed.",
      );
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);
  useEffect(() => {
    if (modal && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!modal && dialogRef.current?.open) dialogRef.current.close();
  }, [modal]);

  async function generate(event?: FormEvent, suggested?: string) {
    event?.preventDefault();
    const prompt = (suggested ?? question).trim();
    if (prompt.length < 3 || requestInFlight.current) return;
    requestInFlight.current = true;
    setQuestion(prompt);
    setBusy(true);
    setError("");
    setPage("assistant");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ question: prompt, format }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Something went wrong. Please try again.",
        );
      setReport(result);
      setHistory((previous) => [result, ...previous].slice(0, 12));
      setTab("preview");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to reach the server.",
      );
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  async function exportAs(target: "png" | "pdf" | "html" | "txt") {
    setExportMenu(false);
    setExporting(true);
    setError("");
    try {
      const requestedFormat: Format = target === "png" ? "image" : target === "txt" ? "text" : target;
      const matches = report.output && (
        report.format === requestedFormat || (report.format === "chart" && target === "png")
      );
      let output = matches ? report.output : undefined;
      if (!output) {
        const response = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ question: report.question, format: requestedFormat }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Export generation failed.");
        output = (result as Report).output;
      }
      if (!output) throw new Error("The agent did not return an output.");
      const url = URL.createObjectURL(outputBlob(output));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = output.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(
        "The export could not be created. Please try a different format.",
      );
    } finally {
      setExporting(false);
    }
  }

  const data = chartData(report.portfolio, report.grouping);
  const total = report.portfolio.total;
  const isSaved = saved.some((item) => item.id === report.id);
  const defaultExport =
    report.format === "chart" || report.format === "image"
      ? "png"
      : report.format === "text"
        ? "txt"
        : report.format;
  const selectReport = (selected: Report) => {
    setReport(selected);
    setQuestion(selected.question);
    setFormat(selected.format);
    setPage("assistant");
    setTab("preview");
    setMobileNav(false);
  };
  const newReport = () => {
    setPage("assistant");
    setQuestion("");
    setError("");
    setMobileNav(false);
    setTimeout(() => textarea.current?.focus(), 0);
  };

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileNav ? "is-open" : ""}`}
        aria-label="Main navigation"
      >
        <a className="brand" href="/" aria-label="Folio home">
          <span className="brand-mark">
            <Layers3 size={23} strokeWidth={1.7} />
          </span>
          folio<span className="brand-period">.</span>
          <span className="poc-tag">POC</span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-monogram">P</span>
          <div>
            Personal workspace<small>Portfolio intelligence</small>
          </div>
          <ShieldCheck size={15} />
        </div>
        <button className="new-report" onClick={newReport}>
          <Plus size={17} />
          New exploration<span>+</span>
        </button>
        <div className="nav-section-label">WORKSPACE</div>
        <nav>
          <button
            className={`nav-item ${page === "assistant" ? "active" : ""}`}
            onClick={() => {
              setPage("assistant");
              setMobileNav(false);
            }}
          >
            <Sparkles size={18} />
            Portfolio assistant
            <ChevronRight className="nav-chevron" size={15} />
          </button>
          <button
            className={`nav-item ${page === "saved" ? "active" : ""}`}
            onClick={() => {
              setPage("saved");
              setMobileNav(false);
            }}
          >
            <Bookmark size={18} />
            Saved reports<span className="nav-count">{saved.length}</span>
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setModal("connections");
              setMobileNav(false);
            }}
          >
            <Database size={18} />
            Data connections
            <span className={`status-dot ${connectionError ? "failed" : ""}`} />
          </button>
        </nav>
        <div className="recent-section">
          <div className="nav-section-label">RECENT EXPLORATIONS</div>
          {history.length ? (
            history.slice(0, 5).map((item) => (
              <button
                className="recent-item"
                onClick={() => selectReport(item)}
                key={item.id}
              >
                <MessageSquareText size={14} />
                <span>{item.question}</span>
              </button>
            ))
          ) : (
            <div className="history-empty">
              Your next perspective
              <br />
              starts with a question.
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setModal("architecture")}>
            <CircleHelp size={18} />
            Behind the intelligence
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-user">
            <span className="avatar">PW</span>
            <div>
              Personal workspace<small>Proof of concept</small>
            </div>
            <span className="user-indicator" />
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {page === "assistant" ? "Portfolio assistant" : "Saved reports"}
            </strong>
          </div>
          <div className="topbar-right">
            <button
              className="environment-status"
              onClick={() => setModal("connections")}
            >
              <span
                className={`status-dot ${connectionError ? "failed" : ""}`}
              />
              {connecting
                ? "Checking connections"
                : connectionError
                  ? "Connection issue"
                  : status?.llm === "openai" && status.database === "mongodb"
                    ? "Connected workspace"
                    : "Demo workspace"}
              <ChevronDown size={13} />
            </button>
            <span className="topbar-divider" />
            <span className="avatar topbar-avatar">PW</span>
          </div>
        </header>

        <main>
          {page === "saved" ? (
            <section className="saved-view">
              <div className="eyebrow">YOUR LIBRARY</div>
              <h1>Saved perspectives</h1>
              <p className="page-description">
                The reports worth coming back to. Stored for this session.
              </p>
              {saved.length ? (
                <div className="saved-grid">
                  {saved.map((item) => (
                    <button
                      className="saved-card"
                      key={item.id}
                      onClick={() => selectReport(item)}
                    >
                      <span className="saved-card-icon">
                        <FileText size={22} />
                      </span>
                      <span className="eyebrow">
                        {item.format.toUpperCase()} REPORT
                      </span>
                      <h2>{item.title}</h2>
                      <p>{item.question}</p>
                      <div>
                        {new Date(item.createdAt).toLocaleDateString("en-GB")}
                        <ArrowUpRight size={17} />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-library">
                  <Bookmark size={34} strokeWidth={1.4} />
                  <h2>A little space for your best insights.</h2>
                  <p>No saved reports yet.</p>
                  <button className="primary-button" onClick={newReport}>
                    Start an exploration
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span />A LITTLE CLARITY GOES A LONG WAY
                  </div>
                  <h1>Your portfolio, in perspective.</h1>
                  <p className="page-description">
                    Ask a question. Find the story in your data.
                  </p>
                </div>
                <div className="snapshot-date">
                  <span className="date-icon">
                    <Database size={16} />
                  </span>
                  <div>
                    Portfolio snapshot
                    <strong>
                      {report.portfolio.asOf
                        ? new Date(
                            `${report.portfolio.asOf}T12:00:00Z`,
                          ).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            timeZone: "UTC",
                          })
                        : "No matching data"}
                    </strong>
                  </div>
                </div>
              </section>

              <form
                className="prompt-panel"
                onSubmit={generate}
                aria-label="Ask your portfolio"
              >
                <div className="prompt-top">
                  <label htmlFor="question">
                    <Sparkles size={17} />
                    What would you like to explore?
                  </label>
                  <span className="assistant-label">
                    <span className="status-dot" />
                    {status?.llm === "openai"
                      ? "OpenAI enabled"
                      : "Demo assistant"}
                  </span>
                </div>
                <textarea
                  ref={textarea}
                  id="question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="How is my portfolio allocated across asset classes?"
                  maxLength={2000}
                  rows={2}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void generate();
                    }
                  }}
                  disabled={busy}
                />
                <div className="prompt-bottom">
                  <div
                    className="format-picker"
                    role="group"
                    aria-label="Output format"
                  >
                    <span className="format-label">Create as</span>
                    {outputFormats.map(({ id, label, Icon }) => (
                      <button
                        type="button"
                        aria-pressed={format === id}
                        key={id}
                        className={`format-option ${format === id ? "selected" : ""}`}
                        onClick={() => setFormat(id)}
                        title={`${label} output`}
                      >
                        <Icon size={15} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="submit"
                    className="primary-button generate-button"
                    disabled={
                      busy ||
                      question.trim().length < 3 ||
                      connecting ||
                      !!connectionError
                    }
                  >
                    {busy ? (
                      <>
                        <LoaderCircle size={17} className="spin" />
                        Exploring...
                      </>
                    ) : (
                      <>
                        Generate
                        <ArrowUpRight size={17} />
                      </>
                    )}
                  </button>
                </div>
              </form>
              <div className="suggestion-row">
                <span>A place to start</span>
                {suggestions.map(({ label, question: prompt, Icon }) => (
                  <button
                    key={label}
                    onClick={() => void generate(undefined, prompt)}
                    disabled={busy || connecting || !!connectionError}
                  >
                    <Icon size={14} />
                    {label}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
              {(error || connectionError) && (
                <div role="alert" className="error-message">
                  {error || connectionError}
                  <button
                    className="icon-button"
                    onClick={() => {
                      setError("");
                      if (connectionError) void refreshStatus();
                    }}
                    aria-label={
                      connectionError ? "Retry connection" : "Dismiss error"
                    }
                  >
                    {connectionError ? <Database size={16} /> : <X size={16} />}
                  </button>
                </div>
              )}

              <section
                className={`results-section ${busy ? "is-generating" : ""}`}
                aria-busy={busy}
                aria-label="Portfolio report"
              >
                <div className="results-heading">
                  <div className="result-heading-left">
                    <span className="result-symbol">
                      <BarChart3 size={18} />
                    </span>
                    <h2>
                      {report.id === "overview"
                        ? "Portfolio overview"
                        : report.title}
                    </h2>
                    <span className="result-badge">
                      {report.id === "overview"
                        ? "SNAPSHOT"
                        : report.format.toUpperCase()}
                    </span>
                  </div>
                  <div className="result-actions">
                    <button
                      className={`icon-button save-button ${isSaved ? "is-saved" : ""}`}
                      title={isSaved ? "Unsave report" : "Save report"}
                      aria-label={isSaved ? "Unsave report" : "Save report"}
                      aria-pressed={isSaved}
                      onClick={() =>
                        setSaved((previous) =>
                          isSaved
                            ? previous.filter((item) => item.id !== report.id)
                            : [report, ...previous],
                        )
                      }
                    >
                      <Bookmark
                        size={17}
                        fill={isSaved ? "currentColor" : "none"}
                      />
                    </button>
                    <div className="export-control">
                      <button
                        className="export-button"
                        onClick={() => void exportAs(defaultExport)}
                        disabled={exporting}
                      >
                        {exporting ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <ArrowDownToLine size={15} />
                        )}
                        <span>Download</span>
                      </button>
                      <button
                        className="export-arrow"
                        aria-label="Choose export format"
                        aria-expanded={exportMenu}
                        onClick={() => setExportMenu(!exportMenu)}
                      >
                        <ChevronDown size={14} />
                      </button>
                      {exportMenu && (
                        <>
                          <button
                            className="menu-dismiss"
                            aria-label="Close export menu"
                            onClick={() => setExportMenu(false)}
                          />
                          <div className="export-menu">
                            {(["png", "pdf", "html", "txt"] as const).map(
                              (item) => (
                                <button
                                  key={item}
                                  onClick={() => void exportAs(item)}
                                >
                                  <ArrowDownToLine size={14} />
                                  {item === "txt"
                                    ? "Plain text"
                                    : item.toUpperCase()}
                                </button>
                              ),
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="metrics-grid">
                  <div className="metric">
                    <span>
                      Total portfolio value
                      <Wallet size={15} />
                    </span>
                    <strong>{money(total)}</strong>
                    <small>
                      <span className="tiny-dot teal" />
                      GBP base currency
                    </small>
                  </div>
                  <div className="metric">
                    <span>
                      Unrealised gain
                      <ArrowUpRight size={16} />
                    </span>
                    <strong>
                      {money(report.portfolio.gain)}
                      <em
                        className={report.portfolio.gain < 0 ? "negative" : ""}
                      >
                        {report.portfolio.gainPercent >= 0 ? "+" : ""}
                        {report.portfolio.gainPercent.toFixed(2)}%
                      </em>
                    </strong>
                    <small>Since recorded purchase cost</small>
                  </div>
                  <div className="metric">
                    <span>
                      Holdings in view
                      <Layers3 size={15} />
                    </span>
                    <strong>
                      {String(report.portfolio.holdings.length).padStart(
                        2,
                        "0",
                      )}
                      <span className="metric-secondary">
                        across{" "}
                        {
                          new Set(
                            report.portfolio.holdings.map(
                              (holding) => holding.assetClass,
                            ),
                          ).size
                        }{" "}
                        asset classes
                      </span>
                    </strong>
                    <small>
                      {report.portfolio.filter.assetClass ||
                      report.portfolio.filter.region
                        ? "Filtered portfolio selection"
                        : "Your complete portfolio"}
                    </small>
                  </div>
                </div>

                <div className="report-surface">
                  <div className="report-toolbar">
                    <div
                      className="report-tabs"
                      role="tablist"
                      aria-label="Report view"
                    >
                      {(
                        [
                          {
                            id: "preview",
                            label:
                              report.format === "chart"
                                ? "Visualisation"
                                : "Preview",
                            Icon: BarChart3,
                          },
                          {
                            id: "holdings",
                            label: "Underlying data",
                            Icon: Table2,
                          },
                          { id: "insights", label: "Insights", Icon: Sparkles },
                        ] as const
                      ).map(({ id, label, Icon }) => (
                        <button
                          key={id}
                          id={`tab-${id}`}
                          role="tab"
                          aria-selected={tab === id}
                          aria-controls="report-content"
                          tabIndex={tab === id ? 0 : -1}
                          onKeyDown={(event) => {
                            if (
                              event.key === "ArrowRight" ||
                              event.key === "ArrowLeft"
                            ) {
                              event.preventDefault();
                              const tabs = [
                                "preview",
                                "holdings",
                                "insights",
                              ] as const;
                              const next =
                                tabs[
                                  (tabs.indexOf(id) +
                                    (event.key === "ArrowRight" ? 1 : 2)) %
                                    3
                                ];
                              setTab(next);
                              document.getElementById(`tab-${next}`)?.focus();
                            }
                          }}
                          className={tab === id ? "active" : ""}
                          onClick={() => setTab(id)}
                        >
                          <Icon size={15} />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                    <span className="source-label">
                      <Database size={13} />
                      {report.portfolio.source === "demo"
                        ? "Sample dataset"
                        : "MongoDB"}
                      <span className="status-dot" />
                    </span>
                  </div>
                  <div
                    id="report-content"
                    role="tabpanel"
                    aria-labelledby={`tab-${tab}`}
                  >
                    {tab === "holdings" ? (
                      <div className="holdings-view">
                        <div className="holdings-heading">
                          <div>
                            <h3>Every number, accounted for.</h3>
                            <p>
                              {report.portfolio.holdings.length} holdings ·
                              Snapshot {report.portfolio.asOf ?? "unavailable"}
                            </p>
                          </div>
                          <label className="search-input">
                            <Search size={15} />
                            <input
                              value={search}
                              onChange={(event) =>
                                setSearch(event.target.value)
                              }
                              placeholder="Find a holding"
                              aria-label="Search holdings"
                            />
                          </label>
                        </div>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Holding</th>
                                <th>Asset class</th>
                                <th>Region</th>
                                <th>Value (GBP)</th>
                                <th>Weight</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.portfolio.holdings
                                .filter((holding) =>
                                  `${holding.name} ${holding.ticker} ${holding.assetClass} ${holding.region}`
                                    .toLowerCase()
                                    .includes(search.toLowerCase()),
                                )
                                .map((holding) => (
                                  <tr key={holding.id}>
                                    <td>
                                      <strong>{holding.name}</strong>
                                      <small>{holding.ticker}</small>
                                    </td>
                                    <td>{holding.assetClass}</td>
                                    <td>{holding.region}</td>
                                    <td>{money(holding.value)}</td>
                                    <td>
                                      {total
                                        ? (
                                            (holding.value / total) *
                                            100
                                          ).toFixed(1)
                                        : "0"}
                                      %
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        {!report.portfolio.holdings.length && (
                          <p className="no-data">
                            No holdings match this selection.
                          </p>
                        )}
                      </div>
                    ) : tab === "insights" && report.output ? (
                      <ReportPreview report={report} />
                    ) : tab === "insights" ? (
                      <article className="insights-view">
                        <div className="eyebrow">THE BIGGER PICTURE</div>
                        <h3>{report.title}</h3>
                        <p>{report.summary}</p>
                        {report.insights.map((insight, index) => (
                          <div className="insight-row" key={index}>
                            <span>0{index + 1}</span>
                            <p>{insight}</p>
                          </div>
                        ))}
                      </article>
                    ) : report.output || report.format !== "chart" ? (
                      <ReportPreview report={report} />
                    ) : (
                      <div className="visual-report">
                        <div className="chart-side">
                          <div className="chart-heading">
                            <div>
                              <h3>
                                {report.grouping === "region"
                                  ? "Geographic allocation"
                                  : report.grouping === "holding"
                                    ? "Holdings breakdown"
                                    : "Asset allocation"}
                              </h3>
                              <p>A balance of different perspectives.</p>
                            </div>
                            <div
                              className="chart-type-picker"
                              role="group"
                              aria-label="Chart type"
                            >
                              <button
                                aria-label="Donut chart"
                                title="Donut chart"
                                aria-pressed={report.chartType === "donut"}
                                className={
                                  report.chartType === "donut" ? "selected" : ""
                                }
                                onClick={() =>
                                  setReport({ ...report, chartType: "donut" })
                                }
                              >
                                <span className="donut-icon" />
                              </button>
                              <button
                                aria-label="Bar chart"
                                title="Bar chart"
                                aria-pressed={report.chartType === "bar"}
                                className={
                                  report.chartType === "bar" ? "selected" : ""
                                }
                                onClick={() =>
                                  setReport({ ...report, chartType: "bar" })
                                }
                              >
                                <BarChart3 size={16} />
                              </button>
                            </div>
                          </div>
                          {data.length ? (
                            <div
                              className={`chart-layout ${report.chartType === "bar" ? "bar-layout" : ""}`}
                            >
                              <div
                                className="chart-canvas"
                                role="img"
                                aria-label={`${report.chartType} chart showing ${data.map((item) => `${item.name}: ${money(item.value)}`).join(", ")}`}
                              >
                                <ResponsiveContainer
                                  width="100%"
                                  height="100%"
                                  minWidth={0}
                                >
                                  {report.chartType === "donut" ? (
                                    <PieChart>
                                      <Pie
                                        data={data}
                                        dataKey="value"
                                        nameKey="name"
                                        innerRadius="72%"
                                        outerRadius="94%"
                                        paddingAngle={3}
                                        stroke="none"
                                        startAngle={90}
                                        endAngle={-270}
                                      >
                                        {data.map((item, index) => (
                                          <Cell
                                            key={item.name}
                                            fill={
                                              palette[index % palette.length]
                                            }
                                          />
                                        ))}
                                      </Pie>
                                      <Tooltip
                                        formatter={(value) =>
                                          money(Number(value))
                                        }
                                        contentStyle={{
                                          borderRadius: 6,
                                          fontSize: 12,
                                          border: "1px solid #dfe7e2",
                                        }}
                                      />
                                    </PieChart>
                                  ) : (
                                    <BarChart
                                      data={data}
                                      margin={{
                                        top: 10,
                                        right: 4,
                                        left: -14,
                                        bottom: 5,
                                      }}
                                    >
                                      <CartesianGrid
                                        strokeDasharray="3 4"
                                        vertical={false}
                                        stroke="#e9eee9"
                                      />
                                      <XAxis
                                        dataKey="name"
                                        tick={{ fontSize: 10, fill: "#6c7971" }}
                                        interval={0}
                                        tickFormatter={(value: string) =>
                                          value.length > 13
                                            ? `${value.slice(0, 11)}...`
                                            : value
                                        }
                                        axisLine={false}
                                        tickLine={false}
                                        height={40}
                                      />
                                      <YAxis
                                        tickFormatter={(value: number) =>
                                          money(value, true)
                                        }
                                        tick={{ fontSize: 10, fill: "#6c7971" }}
                                        axisLine={false}
                                        tickLine={false}
                                      />
                                      <Tooltip
                                        formatter={(value) =>
                                          money(Number(value))
                                        }
                                        cursor={{ fill: "#f4f7f4" }}
                                      />
                                      <Bar
                                        dataKey="value"
                                        radius={[4, 4, 0, 0]}
                                        maxBarSize={58}
                                      >
                                        {data.map((item, index) => (
                                          <Cell
                                            key={item.name}
                                            fill={
                                              palette[index % palette.length]
                                            }
                                          />
                                        ))}
                                      </Bar>
                                    </BarChart>
                                  )}
                                </ResponsiveContainer>
                                {report.chartType === "donut" && (
                                  <div className="donut-center">
                                    <span>Portfolio value</span>
                                    <strong>{money(total, true)}</strong>
                                    <small>
                                      {data.length}{" "}
                                      {report.grouping === "assetClass"
                                        ? "asset classes"
                                        : report.grouping === "region"
                                          ? "regions"
                                          : "holdings"}
                                    </small>
                                  </div>
                                )}
                              </div>
                              <div className="chart-legend">
                                {data.map((item, index) => (
                                  <div className="legend-item" key={item.name}>
                                    <span
                                      className="legend-dot"
                                      style={{
                                        background:
                                          palette[index % palette.length],
                                      }}
                                    />
                                    <div>
                                      <span>{item.name}</span>
                                      <strong>{money(item.value)}</strong>
                                    </div>
                                    <span className="legend-percent">
                                      {total
                                        ? ((item.value / total) * 100).toFixed(
                                            0,
                                          )
                                        : "0"}
                                      %
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="no-data">
                              <Search size={30} />
                              <h3>No matching holdings</h3>
                              <p>Try a different region or asset class.</p>
                            </div>
                          )}
                        </div>
                        <aside className="takeaways">
                          <div className="takeaway-heading">
                            <Sparkles size={16} />
                            <span>The takeaway</span>
                          </div>
                          <p className="takeaway-summary">{report.summary}</p>
                          {report.insights.slice(0, 2).map((insight, index) => (
                            <div className="takeaway-point" key={index}>
                              <span>{String(index + 1).padStart(2, "0")}</span>
                              <p>{insight}</p>
                            </div>
                          ))}
                          <div className="takeaway-footer">
                            <ShieldCheck size={14} />
                            Grounded in your portfolio data
                          </div>
                        </aside>
                      </div>
                    )}
                  </div>
                  <div className="report-footer">
                    <span>
                      <Check size={13} />
                      {report.id === "overview"
                        ? "Snapshot overview"
                        : report.engine === "demo"
                          ? "Template-generated · No LLM call"
                          : "Generated with OpenAI"}
                      <span className="footer-dot">·</span>
                      {report.portfolio.source === "demo"
                        ? "Illustrative data"
                        : "Read-only database access"}
                    </span>
                    <span>All values in GBP</span>
                  </div>
                </div>
              </section>
              <footer className="page-footer">
                <div>
                  <span className="footer-brand">folio.</span>A thoughtful view
                  of your data.
                </div>
                <span>Proof of concept · Not investment advice</span>
              </footer>
            </>
          )}
        </main>
      </div>

      <dialog
        ref={dialogRef}
        className="info-dialog"
        onCancel={() => setModal(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setModal(null);
        }}
      >
        <div className="dialog-heading">
          <span className="result-symbol">
            {modal === "connections" ? (
              <Database size={20} />
            ) : (
              <Network size={20} />
            )}
          </span>
          <h2>
            {modal === "connections"
              ? "Your data connections"
              : "Behind the intelligence"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={() => setModal(null)}
          >
            <X size={19} />
          </button>
        </div>
        {modal === "connections" ? (
          <>
            <p className="dialog-description">
              Credentials stay on the server, never in your browser.
            </p>
            <div className="connection-row">
              <div className="connection-icon">
                <Sparkles size={21} />
              </div>
              <div>
                <strong>OpenAI</strong>
                <small>
                  {status?.llm === "openai"
                    ? "API key configured · verified on generation"
                    : "No API key · generation unavailable"}
                </small>
              </div>
              <span className="connection-badge">
                {status?.llm === "openai" ? "Configured" : "Demo"}
              </span>
            </div>
            <div className="connection-row">
              <div className="connection-icon mongo-icon">
                <Database size={21} />
              </div>
              <div>
                <strong>MongoDB</strong>
                <small>
                  {connectionError ||
                    (status?.database === "mongodb"
                      ? "Connected · read-only queries"
                      : "Local sample dataset · 7 illustrative holdings")}
                </small>
              </div>
              <span
                className={`connection-badge ${connectionError ? "connection-failed" : ""}`}
              >
                {connectionError
                  ? "Error"
                  : status?.database === "mongodb"
                    ? "Connected"
                    : "Demo"}
              </span>
            </div>
            <p className="dialog-note">
              Add OPENAI_API_KEY and MONGODB_URI to .env.local, seed the
              database, then restart the server to connect your services.
            </p>
            <button
              className="primary-button"
              disabled={connecting}
              onClick={() => void refreshStatus()}
            >
              {connecting ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Database size={16} />
              )}
              Check connections
            </button>
          </>
        ) : (
          <>
            <p className="dialog-description">
              One question. A traceable path to the answer.
            </p>
            <div className="architecture-flow">
              {[
                {
                  step: "01",
                  title: "Next.js frontend",
                  detail: "Question + output format",
                },
                {
                  step: "02",
                  title: "Server-side LLM",
                  detail: "OpenAI calls a validated tool",
                },
                {
                  step: "03",
                  title: "MongoDB",
                  detail: "Read-only, allowlisted filters",
                },
                {
                  step: "04",
                  title: "Agent-generated output",
                  detail: "Text, chart, PNG, HTML or PDF",
                },
              ].map((item) => (
                <div key={item.step}>
                  <span>{item.step}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </div>
                  {item.step !== "04" && <ArrowRight size={17} />}
                </div>
              ))}
            </div>
            <p className="dialog-note">
              The agent creates reports from portfolio values. HTML previews are
              sandboxed. File generation uses a hosted sandbox. Without OpenAI
              credentials, only the portfolio overview is available. This local POC has no authentication or
              rate limiting; add both before deployment.
            </p>
          </>
        )}
      </dialog>
    </div>
  );
}
