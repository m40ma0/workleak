import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  Copy,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  GitPullRequest,
  ListChecks,
  Loader2,
  Target,
  Upload,
  Workflow,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
import { parseCsvForType } from "./lib/csv";
import { detectLeaks } from "./lib/detection";
import {
  buildCsvTemplate,
  buildFindingsCsv,
  buildJsonExport,
  buildMarkdownActionPlan,
  downloadMarkdown,
  downloadText,
} from "./lib/export";
import { cn, formatCurrency } from "./lib/utils";
import type {
  DataType,
  LeakCategory,
  LeakFinding,
  LeakFingerprint,
  MeetingRecord,
  PullRequestRecord,
  TicketRecord,
  WorkflowData,
} from "./types";

type View = "dashboard" | "import" | "data" | "actions";

const storageKey = "workleak-demo-state-v3";

const emptyData: WorkflowData = {
  tickets: [],
  meetings: [],
  pullRequests: [],
};

const dataTypeMeta: Record<
  DataType,
  {
    label: string;
    plural: string;
    samplePath: string;
    templateName: string;
    icon: typeof FileSpreadsheet;
    accent: string;
  }
> = {
  tickets: {
    label: "Tickets",
    plural: "tickets",
    samplePath: "/samples/tickets.csv",
    templateName: "workleak-ticket-template.csv",
    icon: ListChecks,
    accent: "bg-[#22577a]",
  },
  meetings: {
    label: "Meetings",
    plural: "meetings",
    samplePath: "/samples/meetings.csv",
    templateName: "workleak-meeting-template.csv",
    icon: CalendarClock,
    accent: "bg-[#38a3a5]",
  },
  pullRequests: {
    label: "Pull Requests",
    plural: "pull requests",
    samplePath: "/samples/pull_requests.csv",
    templateName: "workleak-pr-template.csv",
    icon: GitPullRequest,
    accent: "bg-[#f07167]",
  },
};

const categoryColor: Record<LeakCategory, string> = {
  "Long wait time": "#22577a",
  "Too many handoffs": "#38a3a5",
  "Repeated manual work": "#57cc99",
  "Blocked work": "#f07167",
  "Duplicate meetings/reports": "#f2c14e",
};

const fingerprintColor: Record<LeakFingerprint, string> = {
  "Approval Black Hole": "#22577a",
  "Ticket Ping-Pong": "#38a3a5",
  "PR Waiting Room": "#f07167",
  "Meeting Gravity Well": "#f2c14e",
  "Manual Report Tax": "#57cc99",
  "Ownership Fog": "#7c9eb2",
  "Rework Loop": "#a45c40",
  "Status Echo": "#80ed99",
  "Blocked Work Queue": "#c44536",
};

const tabs: { id: View; label: string; icon: typeof BarChart3 }[] = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "actions", label: "Action Plan", icon: Bot },
  { id: "import", label: "Import", icon: Upload },
  { id: "data", label: "Raw Data", icon: Database },
];

const exportDefaults = {
  reportTitle: "WorkLeak Action Plan",
  companyName: "Demo Company",
};

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [averageHourlyCost, setAverageHourlyCost] = useState(95);
  const [recoveryRate, setRecoveryRate] = useState(0.62);
  const [reportTitle, setReportTitle] = useState(exportDefaults.reportTitle);
  const [companyName, setCompanyName] = useState(exportDefaults.companyName);
  const [data, setData] = useState<WorkflowData>(emptyData);
  const [activeDataType, setActiveDataType] = useState<DataType>("tickets");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isLoadingSamples, setIsLoadingSamples] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as {
        data?: WorkflowData;
        averageHourlyCost?: number;
        recoveryRate?: number;
        reportTitle?: string;
        companyName?: string;
      };
      if (parsed.data) setData(parsed.data);
      if (parsed.averageHourlyCost) setAverageHourlyCost(parsed.averageHourlyCost);
      if (parsed.recoveryRate) setRecoveryRate(parsed.recoveryRate);
      if (parsed.reportTitle) setReportTitle(parsed.reportTitle);
      if (parsed.companyName) setCompanyName(parsed.companyName);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        data,
        averageHourlyCost,
        recoveryRate,
        reportTitle,
        companyName,
      }),
    );
  }, [data, averageHourlyCost, recoveryRate, reportTitle, companyName]);

  const findings = useMemo(
    () => detectLeaks(data, averageHourlyCost, recoveryRate),
    [data, averageHourlyCost, recoveryRate],
  );

  const totals = useMemo(() => getTotals(data, findings), [data, findings]);

  const categoryChart = useMemo(() => {
    const totalsByCategory = findings.reduce<Record<string, number>>(
      (totalsByCategory, finding) => {
        totalsByCategory[finding.category] =
          (totalsByCategory[finding.category] ?? 0) +
          finding.adjustedMonthlyCost;
        return totalsByCategory;
      },
      {},
    );

    return Object.entries(totalsByCategory).map(([category, cost]) => ({
      category,
      cost: Math.round(cost),
      fill: categoryColor[category as LeakCategory],
    }));
  }, [findings]);

  const sourceBreakdown = useMemo(
    () =>
      (Object.keys(dataTypeMeta) as DataType[]).map((sourceType) => {
        const cost = findings
          .filter((finding) => finding.sourceType === sourceType)
          .reduce((total, finding) => total + finding.adjustedMonthlyCost, 0);

        return {
          type: sourceType,
          label: dataTypeMeta[sourceType].label,
          rows: data[sourceType].length,
          cost,
          percent:
            totals.adjustedMonthlyCost > 0
              ? Math.round((cost / totals.adjustedMonthlyCost) * 100)
              : 0,
        };
      }),
    [data, findings, totals.adjustedMonthlyCost],
  );

  const fingerprintSummaries = useMemo(
    () => buildFingerprintSummaries(findings),
    [findings],
  );

  async function loadSampleData() {
    setIsLoadingSamples(true);
    setImportErrors([]);

    try {
      const [ticketsCsv, meetingsCsv, prsCsv] = await Promise.all([
        fetch(dataTypeMeta.tickets.samplePath).then((response) =>
          response.text(),
        ),
        fetch(dataTypeMeta.meetings.samplePath).then((response) =>
          response.text(),
        ),
        fetch(dataTypeMeta.pullRequests.samplePath).then((response) =>
          response.text(),
        ),
      ]);

      const tickets = parseCsvForType(ticketsCsv, "tickets");
      const meetings = parseCsvForType(meetingsCsv, "meetings");
      const pullRequests = parseCsvForType(prsCsv, "pullRequests");

      setData({
        tickets: tickets.rows as TicketRecord[],
        meetings: meetings.rows as MeetingRecord[],
        pullRequests: pullRequests.rows as PullRequestRecord[],
      });
      setImportErrors([
        ...tickets.errors,
        ...meetings.errors,
        ...pullRequests.errors,
      ]);
      setView("dashboard");
    } catch {
      setImportErrors(["Could not load sample CSV files."]);
    } finally {
      setIsLoadingSamples(false);
    }
  }

  async function handleFileUpload(type: DataType, file: File | null) {
    if (!file) return;

    const csv = await file.text();
    const result = parseCsvForType(csv, type);

    setImportErrors(result.errors);
    setData((current) => ({
      ...current,
      [type]: result.rows,
    }));
  }

  function exportOptions() {
    return {
      reportTitle,
      companyName,
      averageHourlyCost,
      recoveryRate,
    };
  }

  function handleExportMarkdown() {
    const markdown = buildMarkdownActionPlan(findings, data, exportOptions());
    downloadMarkdown("workleak-action-plan.md", markdown);
  }

  function handleExportJson() {
    const json = buildJsonExport(findings, data, exportOptions());
    downloadText("workleak-findings.json", json, "application/json;charset=utf-8");
  }

  function handleExportCsv() {
    const csv = buildFindingsCsv(findings);
    downloadText("workleak-findings.csv", csv, "text/csv;charset=utf-8");
  }

  function handleTemplateDownload(type: DataType) {
    downloadText(
      dataTypeMeta[type].templateName,
      buildCsvTemplate(type),
      "text/csv;charset=utf-8",
    );
  }

  const hasData = totals.importedRows > 0;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f5fbf7_0%,#edf6f1_46%,#f8faf8_100%)]">
      <header className="border-b bg-white/90 backdrop-blur">
        <div className="container flex flex-col gap-4 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm">
              <img
                src="/logo.png"
                alt="WorkLeak"
                className="h-full w-full object-contain"
              />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">
                WorkLeak
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Observability for how work moves through your company.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[180px_170px_160px_auto] xl:items-end">
            <MoneyInput
              value={averageHourlyCost}
              onChange={setAverageHourlyCost}
            />
            <PercentInput value={recoveryRate} onChange={setRecoveryRate} />
            <Button
              variant="secondary"
              onClick={loadSampleData}
              disabled={isLoadingSamples}
            >
              {isLoadingSamples ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              )}
              Sample Data
            </Button>
            <Button onClick={handleExportMarkdown} disabled={!findings.length}>
              <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
              Export
            </Button>
          </div>
        </div>
      </header>

      <div className="container py-5">
        <nav className="mb-5 flex gap-2 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors",
                  view === tab.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-white text-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div key={view} className="page-transition">
          {view === "dashboard" && (
            <DashboardView
              hasData={hasData}
              totals={totals}
              findings={findings}
              categoryChart={categoryChart}
              sourceBreakdown={sourceBreakdown}
              fingerprintSummaries={fingerprintSummaries}
              recoveryRate={recoveryRate}
              isLoadingSamples={isLoadingSamples}
              onLoadSamples={loadSampleData}
              onOpenImport={() => setView("import")}
              onOpenActions={() => setView("actions")}
            />
          )}

          {view === "actions" && (
            <ActionPlanView
              findings={findings}
              hasData={hasData}
              isLoadingSamples={isLoadingSamples}
              onLoadSamples={loadSampleData}
              onExportMarkdown={handleExportMarkdown}
              onExportJson={handleExportJson}
              onExportCsv={handleExportCsv}
            />
          )}

          {view === "import" && (
            <ImportView
              data={data}
              importErrors={importErrors}
              reportTitle={reportTitle}
              companyName={companyName}
              isLoadingSamples={isLoadingSamples}
              onReportTitleChange={setReportTitle}
              onCompanyNameChange={setCompanyName}
              onFileUpload={handleFileUpload}
              onLoadSamples={loadSampleData}
              onTemplateDownload={handleTemplateDownload}
            />
          )}

          {view === "data" && (
            <RawDataView
              data={data}
              activeDataType={activeDataType}
              onActiveDataTypeChange={setActiveDataType}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function MoneyInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <Label htmlFor="hourly-cost">Hourly cost</Label>
      <div className="mt-1 flex items-center rounded-md border bg-white px-3 focus-within:ring-2 focus-within:ring-ring">
        <span className="text-sm text-muted-foreground">$</span>
        <Input
          id="hourly-cost"
          type="number"
          min={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value) || 1)}
          className="border-0 px-2 shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

function PercentInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <Label htmlFor="recovery-rate">Recovery</Label>
      <div className="mt-1 flex items-center rounded-md border bg-white px-3 focus-within:ring-2 focus-within:ring-ring">
        <Input
          id="recovery-rate"
          type="number"
          min={1}
          max={100}
          value={Math.round(value * 100)}
          onChange={(event) =>
            onChange(Math.min(1, Math.max(0.01, Number(event.target.value) / 100)))
          }
          className="border-0 px-0 shadow-none focus-visible:ring-0"
        />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
    </div>
  );
}

function DashboardView({
  hasData,
  totals,
  findings,
  categoryChart,
  sourceBreakdown,
  fingerprintSummaries,
  recoveryRate,
  isLoadingSamples,
  onLoadSamples,
  onOpenImport,
  onOpenActions,
}: {
  hasData: boolean;
  totals: ReturnType<typeof getTotals>;
  findings: LeakFinding[];
  categoryChart: { category: string; cost: number; fill: string }[];
  sourceBreakdown: {
    type: DataType;
    label: string;
    rows: number;
    cost: number;
    percent: number;
  }[];
  fingerprintSummaries: FingerprintSummary[];
  recoveryRate: number;
  isLoadingSamples: boolean;
  onLoadSamples: () => void;
  onOpenImport: () => void;
  onOpenActions: () => void;
}) {
  if (!hasData) {
    return (
      <EmptyState
        icon={<Workflow className="h-7 w-7 text-primary" aria-hidden="true" />}
        title="A calmer way to see where work leaks time."
        description="Load the demo data or upload CSVs to get adjusted waste, fix-first priorities, and a practical action plan."
        action={
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button onClick={onLoadSamples} disabled={isLoadingSamples}>
              {isLoadingSamples ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              )}
              Sample Data
            </Button>
            <Button variant="outline" onClick={onOpenImport}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Upload CSV
            </Button>
          </div>
        }
      />
    );
  }

  const topFinding = findings[0];
  const afterFixes = totals.adjustedMonthlyCost - totals.projectedSavings;

  return (
    <div className="space-y-5">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden border-primary/20 bg-white">
          <CardContent className="p-5 lg:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">Executive Snapshot</Badge>
                  <Badge variant="outline">
                    {totals.importedRows} scanned
                  </Badge>
                  <Badge variant="outline">
                    {totals.healthyWorkflowCount} healthy ignored
                  </Badge>
                </div>
                <h2 className="max-w-3xl text-2xl font-semibold tracking-normal lg:text-3xl">
                  Flagged {totals.findingsCount} high-value leaks. Best first
                  fix: {topFinding?.fingerprint ?? "load data"}.
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  WorkLeak uses deterministic workflow rules and generated
                  recommendation templates. Adjusted waste keeps overlapping
                  signals from inflating the story.
                </p>
              </div>
              <Button onClick={onOpenActions}>
                <Target className="h-4 w-4" aria-hidden="true" />
                Open Plan
              </Button>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              <MetricTile
                label="Adjusted waste"
                value={formatCurrency(totals.adjustedMonthlyCost)}
              />
              <MetricTile
                label="Recoverable"
                value={formatCurrency(totals.projectedSavings)}
              />
              <MetricTile
                label="After fixes"
                value={formatCurrency(afterFixes)}
              />
              <MetricTile
                label="WorkLeak score"
                value={`${totals.workLeakScore}/100`}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#17202a] text-white">
          <CardContent className="p-5">
            <p className="text-sm text-white/65">Fix this first</p>
            {topFinding ? (
              <>
                <h3 className="mt-2 text-xl font-semibold">
                  {topFinding.title}
                </h3>
                <p className="mt-2 text-sm text-white/72">
                  {topFinding.fingerprint} · {topFinding.confidence}% confidence
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <DarkStat
                    label="Savings"
                    value={formatCurrency(topFinding.projectedSavings)}
                  />
                  <DarkStat
                    label="Payback"
                    value={`${topFinding.paybackDays}d`}
                  />
                  <DarkStat
                    label="Effort"
                    value={`${topFinding.implementationDays}d`}
                  />
                  <DarkStat
                    label="Score"
                    value={`${topFinding.fixThisFirstScore}/100`}
                  />
                </div>
                <p className="mt-5 text-sm leading-6 text-white/82">
                  {topFinding.recommendation}
                </p>
              </>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Fix This First</CardTitle>
            <CardDescription>
              Practical ranking by savings, confidence, effort, and payback.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {findings.slice(0, 5).map((finding, index) => (
                <CompactFinding key={finding.id} finding={finding} rank={index + 1} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Source Health</CardTitle>
            <CardDescription>
              Scanned rows, ignored normal work, and adjusted cost by source.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="Scanned" value={`${totals.importedRows}`} />
              <MiniStat label="Flagged" value={`${totals.flaggedRecordCount}`} />
              <MiniStat label="Ignored" value={`${totals.healthyWorkflowCount}`} />
            </div>
            <div className="space-y-3">
              {sourceBreakdown.map((source) => (
                <SourceRow key={source.type} source={source} />
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Leak Fingerprints</CardTitle>
            <CardDescription>Named patterns the team can remember.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {fingerprintSummaries.slice(0, 6).map((summary) => (
                <FingerprintCard key={summary.fingerprint} summary={summary} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Adjusted Cost by Category</CardTitle>
            <CardDescription>
              A quick read of where the money is leaking.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mx-auto h-72 w-full max-w-[680px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryChart}
                  layout="vertical"
                  margin={{ top: 8, right: 64, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `$${Number(value) / 1000}k`}
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={116}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="cost" radius={[0, 6, 6, 0]}>
                    {categoryChart.map((entry) => (
                      <Cell key={entry.category} fill={entry.fill} />
                    ))}
                    <LabelList
                      dataKey="cost"
                      position="right"
                      formatter={(value: number) => formatCurrency(value)}
                      className="fill-foreground text-xs font-semibold"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="grid gap-4 p-5 lg:grid-cols-3">
          <MethodNote
            title="Adjusted waste"
            text="Deduplicates overlapping signals from the same workflow item."
          />
          <MethodNote
            title="Fix-first score"
            text="Projected savings and confidence, normalized by effort."
          />
          <MethodNote
            title="Recovery assumption"
            text={`Current model assumes ${Math.round(
              recoveryRate * 100,
            )}% recovery from the first improvement cycle.`}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-[#f9fbf8] p-4">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-normal tabular">
        {value}
      </p>
    </div>
  );
}

function DarkStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/15 bg-white/8 p-3">
      <p className="text-xs text-white/60">{label}</p>
      <p className="mt-1 font-semibold tabular">{value}</p>
    </div>
  );
}

function CompactFinding({
  finding,
  rank,
}: {
  finding: LeakFinding;
  rank: number;
}) {
  return (
    <details className="group rounded-lg border bg-white p-3 transition-colors open:bg-[#fbfdfb]">
      <summary className="grid cursor-pointer list-none gap-3 md:grid-cols-[38px_minmax(0,1fr)_auto] md:items-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-sm font-semibold">
          {rank}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{finding.title}</span>
            <Badge variant="outline">{finding.fingerprint}</Badge>
            <Badge variant="secondary">{finding.confidence}%</Badge>
          </span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {getSuggestedOwner(finding)} · {formatCurrency(finding.projectedSavings)}
            /mo savings
          </span>
        </span>
        <span className="text-left md:text-right">
          <span className="block text-lg font-semibold tabular">
            {finding.fixThisFirstScore}/100
          </span>
          <span className="text-xs text-muted-foreground">fix-first</span>
        </span>
      </summary>
      <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-4">
        <MiniStat
          label="Adjusted waste"
          value={formatCurrency(finding.adjustedMonthlyCost)}
        />
        <MiniStat label="Payback" value={`${finding.paybackDays}d`} />
        <MiniStat
          label="Effort"
          value={`${finding.implementationEffort}, ${finding.implementationDays}d`}
        />
        <MiniStat label="Priority" value={finding.priority} />
      </div>
    </details>
  );
}

function SourceRow({
  source,
}: {
  source: {
    label: string;
    rows: number;
    cost: number;
    percent: number;
  };
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{source.label}</span>
        <span className="text-muted-foreground">
          {source.rows} rows · {formatCurrency(source.cost)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${source.percent}%` }}
        />
      </div>
    </div>
  );
}

function FingerprintCard({ summary }: { summary: FingerprintSummary }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{summary.fingerprint}</p>
          <p className="text-sm text-muted-foreground">
            {summary.count} signal{summary.count === 1 ? "" : "s"}
          </p>
        </div>
        <span
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: summary.color }}
        />
      </div>
      <p className="mt-4 text-xl font-semibold tabular">
        {formatCurrency(summary.adjustedCost)}
      </p>
    </div>
  );
}

function MethodNote({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-white px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular">{value}</p>
    </div>
  );
}

function ActionPlanView({
  findings,
  hasData,
  isLoadingSamples,
  onLoadSamples,
  onExportMarkdown,
  onExportJson,
  onExportCsv,
}: {
  findings: LeakFinding[];
  hasData: boolean;
  isLoadingSamples: boolean;
  onLoadSamples: () => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyText(id: string, text: string) {
    await copyToClipboard(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1500);
  }

  if (!hasData) {
    return (
      <EmptyState
        icon={<Bot className="h-7 w-7 text-primary" aria-hidden="true" />}
        title="No action plan yet."
        description="Load sample data to create a short, copyable plan for the highest-return fixes."
        action={
          <Button onClick={onLoadSamples} disabled={isLoadingSamples}>
            {isLoadingSamples ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            )}
            Sample Data
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-[#f2c14e]/35 bg-[linear-gradient(135deg,#fff9ec_0%,#f6fbf6_54%,#eef8f8_100%)]">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Badge variant="secondary">Monday Morning Plan</Badge>
            <h2 className="mt-2 text-2xl font-semibold tracking-normal">
              Three fixes to start with.
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A quiet timeline for owners, savings, effort, and next action.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton
              label="Copy Plan"
              copied={copiedId === "monday-plan"}
              onClick={() => copyText("monday-plan", formatMondayMorningPlan(findings))}
            />
            <Button variant="outline" size="sm" onClick={onExportMarkdown}>
              <FileText className="h-4 w-4" aria-hidden="true" />
              Markdown
            </Button>
            <Button variant="outline" size="sm" onClick={onExportJson}>
              <FileJson className="h-4 w-4" aria-hidden="true" />
              JSON
            </Button>
            <Button variant="outline" size="sm" onClick={onExportCsv}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-[#d7e7df] bg-[#fbfdfb]">
          <CardContent className="p-5">
            <div className="relative space-y-4 before:absolute before:left-[19px] before:top-3 before:h-[calc(100%-24px)] before:w-px before:bg-[#b9d8cd]">
              {findings.slice(0, 6).map((finding, index) => (
                <TimelineItem
                  key={finding.id}
                  finding={finding}
                  index={index}
                  copiedId={copiedId}
                  onCopy={copyText}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="border-[#f2c14e]/35 bg-[#fff9ec]">
            <CardHeader className="pb-3">
              <CardTitle>Today’s Focus</CardTitle>
              <CardDescription>Smallest practical starting point.</CardDescription>
            </CardHeader>
            <CardContent>
              {findings[0] && (
                <div className="space-y-3">
                  <Badge variant="outline">{findings[0].fingerprint}</Badge>
                  <p className="text-lg font-semibold">{findings[0].title}</p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {findings[0].recommendation}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <MiniStat
                      label="Savings"
                      value={formatCurrency(findings[0].projectedSavings)}
                    />
                    <MiniStat
                      label="Payback"
                      value={`${findings[0].paybackDays}d`}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[#d7e7df] bg-white">
            <CardHeader className="pb-3">
              <CardTitle>Plan Shape</CardTitle>
              <CardDescription>How to read each action.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <MethodNote title="Owner" text="Who should take the first pass." />
              <MethodNote title="Recipe" text="Trigger, action, and escalation." />
              <MethodNote title="Evidence" text="Only the data needed to trust it." />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TimelineItem({
  finding,
  index,
  copiedId,
  onCopy,
}: {
  finding: LeakFinding;
  index: number;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}) {
  const accent = getActionAccent(index, finding.fingerprint);

  return (
    <article className="relative pl-12">
      <div
        className="absolute left-0 top-1 flex h-10 w-10 items-center justify-center rounded-md border text-sm font-semibold shadow-sm transition-transform duration-200 hover:scale-105"
        style={{
          backgroundColor: accent.marker,
          borderColor: accent.border,
          color: accent.markerText,
          boxShadow: `0 10px 26px ${accent.shadow}`,
        }}
      >
        {index + 1}
      </div>
      <div
        className="rounded-lg border p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft"
        style={{
          background: accent.card,
          borderColor: accent.border,
        }}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={severityVariant(finding.priority)}>
                {finding.fixThisFirstScore}/100
              </Badge>
              <Badge variant="outline">{finding.fingerprint}</Badge>
              <Badge variant="secondary">{finding.confidence}% confidence</Badge>
            </div>
            <h3 className="mt-3 text-lg font-semibold">{finding.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {getSuggestedOwner(finding)}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-left lg:w-[360px]">
            <MiniStat
              label="Savings"
              value={formatCurrency(finding.projectedSavings)}
            />
            <MiniStat label="Effort" value={`${finding.implementationDays}d`} />
            <MiniStat label="Payback" value={`${finding.paybackDays}d`} />
          </div>
        </div>

        <div
          className="mt-4 rounded-md border p-3 text-sm leading-6"
          style={{
            backgroundColor: accent.note,
            borderColor: accent.border,
          }}
        >
          {finding.recommendation}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {finding.implementationSteps.slice(0, 3).map((step, stepIndex) => {
            const stepAccent = getStepAccent(stepIndex);
            return (
              <div
                key={step}
                className="rounded-md border p-3 text-sm shadow-sm transition-transform duration-200 hover:-translate-y-0.5"
                style={{
                  backgroundColor: stepAccent.background,
                  borderColor: stepAccent.border,
                }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: stepAccent.dot }}
                  />
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    Step {stepIndex + 1}
                  </span>
                </div>
                {step}
              </div>
            );
          })}
        </div>

        <details
          className="mt-4 rounded-md border p-3 text-sm"
          style={{
            backgroundColor: accent.details,
            borderColor: accent.border,
          }}
        >
          <summary className="cursor-pointer font-medium">Recipe and evidence</summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div
              className="rounded-md border p-3"
              style={{
                backgroundColor: "#ffffff",
                borderColor: accent.border,
              }}
            >
              <p className="font-semibold">Automation recipe</p>
              <p className="mt-2 text-muted-foreground">
                {finding.automationRecipe.trigger}
              </p>
              <p className="mt-2 text-muted-foreground">
                {finding.automationRecipe.action}
              </p>
            </div>
            <EvidenceList finding={finding} compact />
          </div>
        </details>

        <div className="mt-4 flex flex-wrap gap-2">
          <CopyButton
            label="Copy Jira"
            copied={copiedId === `${finding.id}-jira`}
            onClick={() => onCopy(`${finding.id}-jira`, finding.jiraTicket)}
          />
          <CopyButton
            label="Copy Recipe"
            copied={copiedId === `${finding.id}-recipe`}
            onClick={() =>
              onCopy(`${finding.id}-recipe`, formatAutomationRecipe(finding))
            }
          />
          <CopyButton
            label="Copy Summary"
            copied={copiedId === `${finding.id}-summary`}
            onClick={() => onCopy(`${finding.id}-summary`, finding.executiveSummary)}
          />
        </div>
      </div>
    </article>
  );
}

function ImportView({
  data,
  importErrors,
  reportTitle,
  companyName,
  isLoadingSamples,
  onReportTitleChange,
  onCompanyNameChange,
  onFileUpload,
  onLoadSamples,
  onTemplateDownload,
}: {
  data: WorkflowData;
  importErrors: string[];
  reportTitle: string;
  companyName: string;
  isLoadingSamples: boolean;
  onReportTitleChange: (value: string) => void;
  onCompanyNameChange: (value: string) => void;
  onFileUpload: (type: DataType, file: File | null) => void;
  onLoadSamples: () => void;
  onTemplateDownload: (type: DataType) => void;
}) {
  return (
    <div className="space-y-5">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Bring Your Workflow Data</CardTitle>
            <CardDescription>
              CSV keeps the demo reliable and maps cleanly to future integrations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {(Object.keys(dataTypeMeta) as DataType[]).map((type) => (
                <UploadCard
                  key={type}
                  type={type}
                  rows={data[type].length}
                  onFileUpload={onFileUpload}
                  onTemplateDownload={onTemplateDownload}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Demo Data</CardTitle>
              <CardDescription>
                Healthy rows, mild friction, and serious leaks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                onClick={onLoadSamples}
                disabled={isLoadingSamples}
              >
                {isLoadingSamples ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                )}
                Load Sample Data
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Report Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="report-title">Report title</Label>
                <Input
                  id="report-title"
                  className="mt-1"
                  value={reportTitle}
                  onChange={(event) => onReportTitleChange(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="company-name">Company/workspace</Label>
                <Input
                  id="company-name"
                  className="mt-1"
                  value={companyName}
                  onChange={(event) => onCompanyNameChange(event.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {importErrors.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-3">
            <CardTitle>Import Notices</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-destructive">
              {importErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>CSV Shape</CardTitle>
          <CardDescription>Required columns for each upload type.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-3">
            <FieldList
              title="Tickets"
              fields={[
                "id",
                "title",
                "team",
                "owner",
                "waitHours",
                "cycleHours",
                "ownerChanges",
                "blockerHours",
                "repeatsPerMonth",
              ]}
            />
            <FieldList
              title="Meetings"
              fields={[
                "id",
                "title",
                "team",
                "attendees",
                "durationMinutes",
                "meetingsPerMonth",
                "outcomeCaptured",
                "actionItems",
              ]}
            />
            <FieldList
              title="Pull Requests"
              fields={[
                "id",
                "title",
                "repository",
                "reviewer",
                "reviewWaitHours",
                "comments",
                "reworkHours",
                "blockerHours",
              ]}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UploadCard({
  type,
  rows,
  onFileUpload,
  onTemplateDownload,
}: {
  type: DataType;
  rows: number;
  onFileUpload: (type: DataType, file: File | null) => void;
  onTemplateDownload: (type: DataType) => void;
}) {
  const meta = dataTypeMeta[type];
  const Icon = meta.icon;

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-md text-white",
            meta.accent,
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="font-semibold">{meta.label}</h3>
          <p className="text-sm text-muted-foreground">
            {rows} {meta.plural}
          </p>
        </div>
      </div>
      <Input
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => onFileUpload(type, event.target.files?.[0] ?? null)}
      />
      <Button
        className="mt-3 w-full"
        variant="outline"
        size="sm"
        onClick={() => onTemplateDownload(type)}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Template
      </Button>
    </div>
  );
}

function FieldList({ title, fields }: { title: string; fields: string[] }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {fields.map((field) => (
          <Badge key={field} variant="secondary">
            {field}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function RawDataView({
  data,
  activeDataType,
  onActiveDataTypeChange,
}: {
  data: WorkflowData;
  activeDataType: DataType;
  onActiveDataTypeChange: (type: DataType) => void;
}) {
  const rows = data[activeDataType];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Raw Imported Data</CardTitle>
            <CardDescription>
              A transparent look at the rows behind the recommendations.
            </CardDescription>
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {(Object.keys(dataTypeMeta) as DataType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onActiveDataTypeChange(type)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-sm font-medium transition-colors",
                  activeDataType === type
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-white text-foreground hover:bg-muted",
                )}
              >
                {dataTypeMeta[type].label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title="No rows imported"
            description="Load sample data or upload a CSV to populate this table."
          />
        ) : (
          <DataTable rows={rows} />
        )}
      </CardContent>
    </Card>
  );
}

function DataTable({
  rows,
}: {
  rows: TicketRecord[] | MeetingRecord[] | PullRequestRecord[];
}) {
  const headers = Object.keys(rows[0] ?? {});

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {headers.map((header) => (
            <TableHead key={header}>{header}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            {headers.map((header) => (
              <TableCell key={header} className="whitespace-nowrap">
                {String(row[header as keyof typeof row])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EvidenceList({
  finding,
  compact = false,
}: {
  finding: LeakFinding;
  compact?: boolean;
}) {
  const details = compact ? finding.evidenceDetails.slice(0, 4) : finding.evidenceDetails;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {details.map((item) => (
        <div
          key={`${finding.id}-${item.label}`}
          className="rounded-md border bg-white p-3"
        >
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {item.label}
          </p>
          <p className="mt-1 font-semibold">{item.value}</p>
          {item.threshold && (
            <p className="mt-1 text-xs text-muted-foreground">
              Threshold: {item.threshold}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function CopyButton({
  label,
  copied,
  onClick,
}: {
  label: string;
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Copy className="h-4 w-4" aria-hidden="true" />
      {copied ? "Copied" : label}
    </Button>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-[340px] place-items-center rounded-lg border border-dashed bg-white/70 p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-muted">
          {icon ?? <Database className="h-6 w-6 text-primary" aria-hidden="true" />}
        </div>
        <h2 className="text-2xl font-semibold tracking-normal">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

interface FingerprintSummary {
  fingerprint: LeakFingerprint;
  count: number;
  adjustedCost: number;
  color: string;
}

function getTotals(data: WorkflowData, findings: LeakFinding[]) {
  const grossHoursLost = findings.reduce(
    (total, finding) => total + finding.hoursLostPerMonth,
    0,
  );
  const adjustedHoursLost = findings.reduce(
    (total, finding) => total + finding.adjustedHoursLostPerMonth,
    0,
  );
  const grossMonthlyCost = findings.reduce(
    (total, finding) => total + finding.monthlyCost,
    0,
  );
  const adjustedMonthlyCost = findings.reduce(
    (total, finding) => total + finding.adjustedMonthlyCost,
    0,
  );
  const projectedSavings = findings.reduce(
    (total, finding) => total + finding.projectedSavings,
    0,
  );
  const importedRows =
    data.tickets.length + data.meetings.length + data.pullRequests.length;
  const flaggedRecordCount = new Set(
    findings.flatMap((finding) =>
      finding.affectedRecords.map(
        (recordId) => `${finding.sourceType}:${recordId}`,
      ),
    ),
  ).size;
  const healthyWorkflowCount = Math.max(0, importedRows - flaggedRecordCount);
  const criticalCount = findings.filter(
    (finding) => finding.priority === "Critical",
  ).length;
  const workLeakScore = Math.min(
    100,
    Math.max(
      1,
      Math.round(
        (adjustedHoursLost / Math.max(importedRows, 1)) * 9 +
          findings.length * 1.25 +
          criticalCount * 3,
      ),
    ),
  );

  return {
    grossHoursLost,
    adjustedHoursLost,
    grossMonthlyCost,
    adjustedMonthlyCost,
    projectedSavings,
    importedRows,
    flaggedRecordCount,
    healthyWorkflowCount,
    findingsCount: findings.length,
    workLeakScore,
  };
}

function buildFingerprintSummaries(findings: LeakFinding[]): FingerprintSummary[] {
  const grouped = findings.reduce<Record<string, LeakFinding[]>>(
    (groups, finding) => {
      groups[finding.fingerprint] = groups[finding.fingerprint]
        ? [...groups[finding.fingerprint], finding]
        : [finding];
      return groups;
    },
    {},
  );

  return Object.entries(grouped)
    .map(([fingerprint, group]) => ({
      fingerprint: fingerprint as LeakFingerprint,
      count: group.length,
      adjustedCost: group.reduce(
        (total, finding) => total + finding.adjustedMonthlyCost,
        0,
      ),
      color: fingerprintColor[fingerprint as LeakFingerprint],
    }))
    .sort((a, b) => b.adjustedCost - a.adjustedCost);
}

function formatAutomationRecipe(finding: LeakFinding) {
  return [
    `Automation Recipe: ${finding.automationRecipe.title}`,
    "",
    `Trigger: ${finding.automationRecipe.trigger}`,
    "",
    "Conditions:",
    ...finding.automationRecipe.conditions.map((condition) => `- ${condition}`),
    "",
    `Action: ${finding.automationRecipe.action}`,
    `Escalation: ${finding.automationRecipe.escalation}`,
    `Expected impact: ${finding.automationRecipe.expectedImpact}`,
  ].join("\n");
}

function formatMondayMorningPlan(findings: LeakFinding[]) {
  return findings
    .slice(0, 3)
    .map((finding, index) =>
      [
        `${index + 1}. ${finding.recommendation}`,
        `Suggested owner: ${getSuggestedOwner(finding)}`,
        `Effort: ${finding.implementationEffort} (${finding.implementationDays} day${
          finding.implementationDays === 1 ? "" : "s"
        })`,
        `Expected savings: ${formatCurrency(finding.projectedSavings)}/month`,
        `Fix This First Score: ${finding.fixThisFirstScore}/100`,
      ].join("\n"),
    )
    .join("\n\n");
}

function getSuggestedOwner(finding: LeakFinding) {
  if (finding.fingerprint === "Approval Black Hole") {
    return `${finding.team} + Finance Ops`;
  }
  if (finding.sourceType === "pullRequests") {
    return `Engineering owner for ${finding.team}`;
  }
  if (finding.sourceType === "meetings") {
    return `${finding.team} meeting owner`;
  }
  if (finding.fingerprint === "Manual Report Tax") {
    return `${finding.team} analytics owner`;
  }
  return `${finding.team} workflow owner`;
}

function getActionAccent(index: number, fingerprint: LeakFingerprint) {
  const presets = [
    {
      marker: "#22577a",
      markerText: "#ffffff",
      border: "#9dc8d8",
      card: "linear-gradient(135deg, #f4fbff 0%, #ffffff 56%, #eef8f8 100%)",
      note: "#eef8f8",
      details: "#f4fbff",
      shadow: "rgba(34, 87, 122, 0.16)",
    },
    {
      marker: "#38a3a5",
      markerText: "#ffffff",
      border: "#a7dedd",
      card: "linear-gradient(135deg, #effafa 0%, #ffffff 58%, #f4fff9 100%)",
      note: "#effafa",
      details: "#f4fff9",
      shadow: "rgba(56, 163, 165, 0.17)",
    },
    {
      marker: "#f2c14e",
      markerText: "#17202a",
      border: "#f6d98b",
      card: "linear-gradient(135deg, #fff9ec 0%, #ffffff 58%, #f7fbf0 100%)",
      note: "#fff5dc",
      details: "#fffaf0",
      shadow: "rgba(242, 193, 78, 0.2)",
    },
    {
      marker: "#f07167",
      markerText: "#ffffff",
      border: "#f5b0aa",
      card: "linear-gradient(135deg, #fff3f1 0%, #ffffff 58%, #fff8ec 100%)",
      note: "#fff0ee",
      details: "#fff7f5",
      shadow: "rgba(240, 113, 103, 0.17)",
    },
    {
      marker: "#57cc99",
      markerText: "#10251b",
      border: "#afe7cd",
      card: "linear-gradient(135deg, #effcf5 0%, #ffffff 58%, #f8fbef 100%)",
      note: "#effcf5",
      details: "#f7fff9",
      shadow: "rgba(87, 204, 153, 0.18)",
    },
  ];

  if (fingerprint === "PR Waiting Room" || fingerprint === "Rework Loop") {
    return presets[3];
  }
  if (fingerprint === "Meeting Gravity Well" || fingerprint === "Manual Report Tax") {
    return presets[2];
  }
  return presets[index % presets.length];
}

function getStepAccent(index: number) {
  const accents = [
    { background: "#eef8f8", border: "#b7dddc", dot: "#38a3a5" },
    { background: "#fff7e7", border: "#f5d58a", dot: "#f2c14e" },
    { background: "#effcf5", border: "#b9e9d1", dot: "#57cc99" },
  ];

  return accents[index % accents.length];
}

async function copyToClipboard(text: string) {
  if (window.navigator.clipboard) {
    await window.navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}

function severityVariant(severity: LeakFinding["severity"]) {
  if (severity === "Critical") return "danger";
  if (severity === "High") return "amber";
  return "teal";
}

export default App;
