import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Gauge,
  GitPullRequest,
  Handshake,
  LineChart,
  ListChecks,
  Loader2,
  Play,
  Target,
  Upload,
  WalletCards,
  Workflow,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
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
import { cn, formatCurrency, formatHours } from "./lib/utils";
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

const storageKey = "workleak-demo-state-v2";

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
  { id: "import", label: "Import", icon: Upload },
  { id: "data", label: "Raw Data", icon: Database },
  { id: "actions", label: "Action Plan", icon: Bot },
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

  const sourceChart = useMemo(
    () =>
      (Object.keys(dataTypeMeta) as DataType[]).map((sourceType) => {
        const cost = findings
          .filter((finding) => finding.sourceType === sourceType)
          .reduce((total, finding) => total + finding.adjustedMonthlyCost, 0);

        return {
          name: dataTypeMeta[sourceType].label,
          value: Math.round(cost),
          fill:
            sourceType === "tickets"
              ? "#22577a"
              : sourceType === "meetings"
                ? "#38a3a5"
                : "#f07167",
        };
      }),
    [findings],
  );

  const projectionData = useMemo(
    () => [
      { name: "Adjusted Waste", cost: Math.round(totals.adjustedMonthlyCost) },
      {
        name: "After First Fixes",
        cost: Math.round(totals.adjustedMonthlyCost - totals.projectedSavings),
      },
    ],
    [totals.adjustedMonthlyCost, totals.projectedSavings],
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
  const topFinding = findings[0];

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7fbfb_0%,#edf5f3_48%,#f8faf8_100%)]">
      <div className="border-b bg-white/86 backdrop-blur">
        <div className="container flex flex-col gap-4 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col">
            <div className="flex h-11 w-32 items-center justify-center rounded-lg">
              <img src="/logo.png" alt="" />
            </div>
            <div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[180px_170px_160px_auto] xl:items-end">
            <div>
              <Label htmlFor="hourly-cost">Average hourly cost</Label>
              <div className="mt-1 flex items-center rounded-md border bg-white px-3 focus-within:ring-2 focus-within:ring-ring">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  id="hourly-cost"
                  type="number"
                  min={1}
                  value={averageHourlyCost}
                  onChange={(event) =>
                    setAverageHourlyCost(Number(event.target.value) || 1)
                  }
                  className="border-0 px-2 shadow-none focus-visible:ring-0"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="recovery-rate">Recovery assumption</Label>
              <div className="mt-1 flex items-center rounded-md border bg-white px-3 focus-within:ring-2 focus-within:ring-ring">
                <Input
                  id="recovery-rate"
                  type="number"
                  min={1}
                  max={100}
                  value={Math.round(recoveryRate * 100)}
                  onChange={(event) =>
                    setRecoveryRate(
                      Math.min(1, Math.max(0.01, Number(event.target.value) / 100)),
                    )
                  }
                  className="border-0 px-0 shadow-none focus-visible:ring-0"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
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
              Export MD
            </Button>
          </div>
        </div>
      </div>

      <div className="container py-5">
        <div className="mb-5 flex gap-2 overflow-x-auto">
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
                    : "border-border bg-white text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {view === "dashboard" && (
          <DashboardView
            hasData={hasData}
            totals={totals}
            findings={findings}
            topFinding={topFinding}
            categoryChart={categoryChart}
            sourceChart={sourceChart}
            projectionData={projectionData}
            fingerprintSummaries={fingerprintSummaries}
            recoveryRate={recoveryRate}
            onLoadSamples={loadSampleData}
            isLoadingSamples={isLoadingSamples}
            onOpenImport={() => setView("import")}
            onOpenActions={() => setView("actions")}
          />
        )}

        {view === "import" && (
          <ImportView
            data={data}
            importErrors={importErrors}
            reportTitle={reportTitle}
            companyName={companyName}
            onReportTitleChange={setReportTitle}
            onCompanyNameChange={setCompanyName}
            onFileUpload={handleFileUpload}
            onLoadSamples={loadSampleData}
            isLoadingSamples={isLoadingSamples}
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

        {view === "actions" && (
          <ActionPlanView
            findings={findings}
            hasData={hasData}
            onLoadSamples={loadSampleData}
            isLoadingSamples={isLoadingSamples}
            onExportMarkdown={handleExportMarkdown}
            onExportJson={handleExportJson}
            onExportCsv={handleExportCsv}
          />
        )}
      </div>
    </main>
  );
}

function DashboardView({
  hasData,
  totals,
  findings,
  topFinding,
  categoryChart,
  sourceChart,
  projectionData,
  fingerprintSummaries,
  recoveryRate,
  onLoadSamples,
  isLoadingSamples,
  onOpenImport,
  onOpenActions,
}: {
  hasData: boolean;
  totals: ReturnType<typeof getTotals>;
  findings: LeakFinding[];
  topFinding?: LeakFinding;
  categoryChart: { category: string; cost: number; fill: string }[];
  sourceChart: { name: string; value: number; fill: string }[];
  projectionData: { name: string; cost: number }[];
  fingerprintSummaries: FingerprintSummary[];
  recoveryRate: number;
  onLoadSamples: () => void;
  isLoadingSamples: boolean;
  onOpenImport: () => void;
  onOpenActions: () => void;
}) {
  if (!hasData) {
    return (
      <div className="grid min-h-[64vh] place-items-center">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-white shadow-soft">
            <Workflow className="h-7 w-7 text-primary" aria-hidden="true" />
          </div>
          <h2 className="text-3xl font-semibold tracking-normal">
            Find the operating-system change worth making first.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Upload workflow CSVs or open the seeded demo to see adjusted waste,
            leak fingerprints, ROI-ranked fixes, automation recipes, and
            Jira-ready action plans.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
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
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ExecutiveImpactBanner
        totals={totals}
        topFinding={topFinding}
        recoveryRate={recoveryRate}
        onOpenActions={onOpenActions}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Adjusted Waste"
          value={formatCurrency(totals.adjustedMonthlyCost)}
          note="Deduplicated estimate"
          icon={WalletCards}
          tone="bg-[#22577a]"
        />
        <MetricCard
          title="Projected Savings"
          value={formatCurrency(totals.projectedSavings)}
          note={`${Math.round(recoveryRate * 100)}% recovery assumption`}
          icon={LineChart}
          tone="bg-[#57cc99]"
        />
        <MetricCard
          title="Adjusted Hours Lost"
          value={formatHours(totals.adjustedHoursLost)}
          note="Estimated per month"
          icon={Clock3}
          tone="bg-[#f07167]"
        />
        <MetricCard
          title="WorkLeak Score"
          value={`${totals.workLeakScore}/100`}
          note={getLeakageLabel(totals.workLeakScore)}
          icon={Gauge}
          tone="bg-[#f2c14e]"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Fix This First</CardTitle>
            <CardDescription>
              Ranked by projected savings, confidence, effort, and payback.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {findings.slice(0, 5).map((finding, index) => (
                <FindingRow
                  key={finding.id}
                  finding={finding}
                  rank={index + 1}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Before / After Simulation</CardTitle>
            <CardDescription>
              Uses adjusted waste and the current recovery assumption.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={projectionData}
                  margin={{ top: 24, right: 8, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${Number(value) / 1000}k`}
                  />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="cost" radius={[6, 6, 0, 0]}>
                    {projectionData.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={index === 0 ? "#f07167" : "#57cc99"}
                      />
                    ))}
                    <LabelList
                      dataKey="cost"
                      position="top"
                      formatter={(value: number) => formatCurrency(value)}
                      className="fill-foreground text-xs font-semibold"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leak Fingerprints</CardTitle>
          <CardDescription>
            Named operational patterns make the diagnosis memorable and repeatable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {fingerprintSummaries.slice(0, 8).map((summary) => (
              <div
                key={summary.fingerprint}
                className="rounded-lg border bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{summary.fingerprint}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {summary.count} signal{summary.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: summary.color }}
                  />
                </div>
                <p className="mt-4 text-2xl font-semibold tabular">
                  {formatCurrency(summary.adjustedCost)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Top fix: {summary.topRecommendation}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Adjusted Cost by Category</CardTitle>
            <CardDescription>
              Which type of friction is costing the most after deduplication.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryChart}
                  layout="vertical"
                  margin={{ top: 8, right: 28, left: 128, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${Number(value) / 1000}k`}
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={126}
                    tickLine={false}
                    axisLine={false}
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

        <Card>
          <CardHeader>
            <CardTitle>Waste by Source</CardTitle>
            <CardDescription>
              Tickets, meetings, and pull requests in one view.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sourceChart}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={104}
                    paddingAngle={4}
                  >
                    {sourceChart.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <MethodologyCard recoveryRate={recoveryRate} />
        <IntegrationReadinessCard />
      </div>
    </div>
  );
}

function ExecutiveImpactBanner({
  totals,
  topFinding,
  recoveryRate,
  onOpenActions,
}: {
  totals: ReturnType<typeof getTotals>;
  topFinding?: LeakFinding;
  recoveryRate: number;
  onOpenActions: () => void;
}) {
  return (
    <Card className="overflow-hidden border-primary/30 bg-leak-ink text-white">
      <CardContent className="p-5 lg:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Executive Impact Snapshot</Badge>
              <Badge variant="outline" className="border-white/30 text-white">
                {totals.importedRows} records scanned
              </Badge>
            </div>
            <h2 className="text-2xl font-semibold tracking-normal lg:text-3xl">
              WorkLeak found {totals.findingsCount} workflow leaks across
              tickets, meetings, and pull requests.
            </h2>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-white/76">
              Adjusted waste deduplicates overlapping leak signals from the
              same workflow item. Projected savings assumes the first
              improvement cycle recovers {Math.round(recoveryRate * 100)}% of
              adjusted waste.
            </p>
          </div>
          <Button variant="secondary" onClick={onOpenActions}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Monday Plan
          </Button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <BannerMetric label="Gross detected waste" value={formatCurrency(totals.grossMonthlyCost)} />
          <BannerMetric label="Adjusted waste estimate" value={formatCurrency(totals.adjustedMonthlyCost)} />
          <BannerMetric label="Recoverable savings" value={formatCurrency(totals.projectedSavings)} />
          <BannerMetric
            label="Fix this first"
            value={topFinding ? topFinding.fingerprint : "No leak"}
            compact
          />
        </div>

        {topFinding && (
          <div className="mt-5 rounded-lg border border-white/15 bg-white/8 p-4">
            <p className="text-sm text-white/70">Best first fix</p>
            <p className="mt-1 font-semibold">{topFinding.recommendation}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BannerMetric({
  label,
  value,
  compact,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/15 bg-white/8 p-4">
      <p className="text-xs font-medium uppercase text-white/60">{label}</p>
      <p
        className={cn(
          "mt-2 font-semibold tracking-normal tabular",
          compact ? "text-lg" : "text-2xl",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MetricCard({
  title,
  value,
  note,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  note: string;
  icon: typeof WalletCards;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-semibold tracking-normal tabular">
            {value}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{note}</p>
        </div>
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white",
            tone,
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

function FindingRow({
  finding,
  rank,
}: {
  finding: LeakFinding;
  rank: number;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="grid gap-3 md:grid-cols-[48px_minmax(0,1fr)_auto] md:items-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-base font-semibold">
          {rank}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{finding.title}</h3>
            <Badge variant={severityVariant(finding.priority)}>
              Priority {finding.priority}
            </Badge>
            <Badge variant="outline">{finding.fingerprint}</Badge>
            <Badge variant="secondary">{finding.confidence}% confidence</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {finding.evidence}
          </p>
        </div>
        <div className="text-left md:text-right">
          <p className="text-xl font-semibold tabular">
            {finding.fixThisFirstScore}/100
          </p>
          <p className="text-sm text-muted-foreground">Fix This First</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <MiniStat label="Adjusted cost" value={formatCurrency(finding.adjustedMonthlyCost)} />
        <MiniStat label="Savings" value={formatCurrency(finding.projectedSavings)} />
        <MiniStat label="Effort" value={`${finding.implementationEffort}, ${finding.implementationDays}d`} />
        <MiniStat label="Payback" value={`${finding.paybackDays}d`} />
      </div>
      <details className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
        <summary className="cursor-pointer font-medium">Why this was flagged</summary>
        <EvidenceList finding={finding} />
      </details>
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

function MethodologyCard({ recoveryRate }: { recoveryRate: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>How WorkLeak Calculates Impact</CardTitle>
        <CardDescription>
          Transparent rules make the prototype easier to trust.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="font-semibold">Monthly Waste</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Leak hours x repeat frequency x average hourly cost
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="font-semibold">Adjusted Waste</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Deduplicates overlapping signals from the same ticket, meeting, or
            pull request so one workflow does not inflate the total.
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="font-semibold">Fix This First Score</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Projected savings x confidence, normalized by implementation effort.
            Current recovery assumption: {Math.round(recoveryRate * 100)}%.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationReadinessCard() {
  const integrations = [
    "Jira ticket ingest",
    "GitHub PR ingest",
    "Slack workflow signals",
    "Google Calendar meetings",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integration-Ready Data Model</CardTitle>
        <CardDescription>
          CSV is the reliable demo path; these fields map to production integrations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {integrations.map((integration) => (
            <div key={integration} className="rounded-lg border bg-white p-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
                <p className="font-semibold">{integration}</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Coming next after the hackathon prototype.
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ImportView({
  data,
  importErrors,
  reportTitle,
  companyName,
  onReportTitleChange,
  onCompanyNameChange,
  onFileUpload,
  onLoadSamples,
  isLoadingSamples,
  onTemplateDownload,
}: {
  data: WorkflowData;
  importErrors: string[];
  reportTitle: string;
  companyName: string;
  onReportTitleChange: (value: string) => void;
  onCompanyNameChange: (value: string) => void;
  onFileUpload: (type: DataType, file: File | null) => void;
  onLoadSamples: () => void;
  isLoadingSamples: boolean;
  onTemplateDownload: (type: DataType) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>CSV Import</CardTitle>
            <CardDescription>
              Add tickets, meetings, and pull request exports.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {(Object.keys(dataTypeMeta) as DataType[]).map((type) => {
                const meta = dataTypeMeta[type];
                const Icon = meta.icon;
                const rows = data[type].length;

                return (
                  <div
                    key={type}
                    className="rounded-lg border bg-white p-4 shadow-sm"
                  >
                    <div
                      className={cn(
                        "mb-4 flex h-10 w-10 items-center justify-center rounded-md text-white",
                        meta.accent,
                      )}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="mb-4">
                      <h3 className="font-semibold">{meta.label}</h3>
                      <p className="text-sm text-muted-foreground">
                        {rows} {meta.plural} imported
                      </p>
                    </div>
                    <Label
                      htmlFor={`${type}-upload`}
                      className="mb-2 block text-xs uppercase text-muted-foreground"
                    >
                      CSV file
                    </Label>
                    <Input
                      id={`${type}-upload`}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) =>
                        onFileUpload(type, event.target.files?.[0] ?? null)
                      }
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
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Seed Dataset</CardTitle>
              <CardDescription>
                Balanced demo data includes healthy rows, mild friction, and serious leaks.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
              <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                The sample set is intentionally not broken everywhere, so
                WorkLeak can ignore healthy workflows and surface the highest-value leaks.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Report Details</CardTitle>
              <CardDescription>
                Used in Markdown, JSON, and CSV exports.
              </CardDescription>
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
      </div>

      {importErrors.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
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
        <CardHeader>
          <CardTitle>Expected CSV Fields</CardTitle>
          <CardDescription>
            Column names are case-sensitive for this prototype.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-3">
            <FieldList
              title="Tickets"
              fields={[
                "id",
                "title",
                "description",
                "team",
                "owner",
                "status",
                "createdAt",
                "completedAt",
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
                "organizer",
                "cadence",
                "attendees",
                "durationMinutes",
                "meetingsPerMonth",
                "outcomeCaptured",
                "actionItems",
                "duplicateTopic",
              ]}
            />
            <FieldList
              title="Pull Requests"
              fields={[
                "id",
                "title",
                "repository",
                "author",
                "reviewer",
                "status",
                "createdAt",
                "mergedAt",
                "reviewWaitHours",
                "comments",
                "reworkHours",
                "blockerHours",
                "repeatsPerMonth",
              ]}
            />
          </div>
        </CardContent>
      </Card>
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
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Raw Imported Data</CardTitle>
              <CardDescription>
                Review exactly what the detection engine is reading.
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
                      : "bg-white hover:bg-muted",
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
    </div>
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

function ActionPlanView({
  findings,
  hasData,
  onLoadSamples,
  isLoadingSamples,
  onExportMarkdown,
  onExportJson,
  onExportCsv,
}: {
  findings: LeakFinding[];
  hasData: boolean;
  onLoadSamples: () => void;
  isLoadingSamples: boolean;
  onExportMarkdown: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyText(id: string, text: string) {
    await copyToClipboard(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1600);
  }

  if (!hasData) {
    return (
      <EmptyState
        title="No action plan yet"
        description="Load the seeded dataset to generate summaries, recommendations, implementation steps, automation recipes, and Jira ticket text."
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
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Monday Morning Plan</CardTitle>
              <CardDescription>
                The top three fixes a team can start next week.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
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
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-3">
            {findings.slice(0, 3).map((finding, index) => (
              <div key={finding.id} className="rounded-lg border bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Badge variant="outline">#{index + 1}</Badge>
                  <Badge variant={severityVariant(finding.priority)}>
                    {finding.fixThisFirstScore}/100
                  </Badge>
                </div>
                <p className="font-semibold">{finding.recommendation}</p>
                <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <p>Owner: {finding.team}</p>
                  <p>
                    Effort: {finding.implementationEffort},{" "}
                    {finding.implementationDays} day
                    {finding.implementationDays === 1 ? "" : "s"}
                  </p>
                  <p>
                    Expected savings: {formatCurrency(finding.projectedSavings)}
                    /month
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {findings.slice(0, 8).map((finding, index) => (
        <Card key={finding.id}>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">#{index + 1}</Badge>
                  <Badge variant={severityVariant(finding.priority)}>
                    Priority {finding.priority}
                  </Badge>
                  <Badge variant="secondary">{finding.fingerprint}</Badge>
                  <Badge variant="outline">{finding.confidence}% confidence</Badge>
                </div>
                <CardTitle>{finding.title}</CardTitle>
                <CardDescription>{finding.evidence}</CardDescription>
              </div>
              <div className="text-left lg:text-right">
                <p className="text-2xl font-semibold tabular">
                  {finding.fixThisFirstScore}/100
                </p>
                <p className="text-sm text-muted-foreground">Fix This First</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(360px,1.08fr)]">
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <MiniStat label="Adjusted waste" value={formatCurrency(finding.adjustedMonthlyCost)} />
                  <MiniStat label="Projected savings" value={formatCurrency(finding.projectedSavings)} />
                  <MiniStat label="Payback" value={`${finding.paybackDays} days`} />
                  <MiniStat label="ROI score" value={`${finding.roiScore}/100`} />
                </div>

                <ActionBlock
                  icon={Bot}
                  title="Executive Summary"
                  text={finding.executiveSummary}
                  action={
                    <CopyButton
                      label="Copy"
                      copied={copiedId === `${finding.id}-summary`}
                      onClick={() =>
                        copyText(`${finding.id}-summary`, finding.executiveSummary)
                      }
                    />
                  }
                />
                <ActionBlock
                  icon={CheckCircle2}
                  title="Recommended Fix"
                  text={finding.recommendation}
                />

                <PerLeakSimulation finding={finding} />

                <details className="rounded-md border bg-white p-4 text-sm">
                  <summary className="cursor-pointer font-semibold">
                    Why this was flagged
                  </summary>
                  <EvidenceList finding={finding} />
                </details>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Handshake className="h-4 w-4 text-primary" aria-hidden="true" />
                      <h3 className="font-semibold">Implementation Steps</h3>
                    </div>
                    <CopyButton
                      label="Copy"
                      copied={copiedId === `${finding.id}-steps`}
                      onClick={() =>
                        copyText(
                          `${finding.id}-steps`,
                          finding.implementationSteps
                            .map((step, stepIndex) => `${stepIndex + 1}. ${step}`)
                            .join("\n"),
                        )
                      }
                    />
                  </div>
                  <ol className="space-y-2">
                    {finding.implementationSteps.map((step, stepIndex) => (
                      <li
                        key={step}
                        className="flex gap-3 rounded-md border bg-muted/30 p-3 text-sm"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-xs font-semibold">
                          {stepIndex + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <AutomationRecipeBlock
                  finding={finding}
                  copied={copiedId === `${finding.id}-recipe`}
                  onCopy={() =>
                    copyText(`${finding.id}-recipe`, formatAutomationRecipe(finding))
                  }
                />

                <div className="rounded-lg border bg-leak-ink p-4 text-white">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4" aria-hidden="true" />
                      <h3 className="font-semibold">Jira Ticket Text</h3>
                    </div>
                    <CopyButton
                      label="Copy Jira"
                      copied={copiedId === `${finding.id}-jira`}
                      onClick={() => copyText(`${finding.id}-jira`, finding.jiraTicket)}
                    />
                  </div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-black/20 p-4 text-sm leading-6 text-white/90">
                    {finding.jiraTicket}
                  </pre>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ActionBlock({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof Bot;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 className="font-semibold">{title}</h3>
        </div>
        {action}
      </div>
      <p className="rounded-md border bg-white p-3 text-sm leading-6 text-muted-foreground">
        {text}
      </p>
    </div>
  );
}

function PerLeakSimulation({ finding }: { finding: LeakFinding }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="font-semibold">Simulate Fix</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat
          label={finding.simulation.currentLabel}
          value={finding.simulation.currentValue}
        />
        <MiniStat
          label={finding.simulation.afterLabel}
          value={finding.simulation.afterValue}
        />
        <MiniStat
          label="Monthly savings"
          value={formatCurrency(finding.simulation.savings)}
        />
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[#57cc99]"
          style={{
            width: `${Math.min(
              100,
              (finding.simulation.savings /
                Math.max(finding.simulation.currentMonthlyCost, 1)) *
                100,
            )}%`,
          }}
        />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Current adjusted cost {formatCurrency(finding.simulation.currentMonthlyCost)} becomes{" "}
        {formatCurrency(finding.simulation.afterMonthlyCost)} after the first
        improvement cycle.
      </p>
    </div>
  );
}

function AutomationRecipeBlock({
  finding,
  copied,
  onCopy,
}: {
  finding: LeakFinding;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 className="font-semibold">Automation Recipe</h3>
        </div>
        <CopyButton label="Copy" copied={copied} onClick={onCopy} />
      </div>
      <div className="space-y-3 text-sm">
        <RecipeLine label="Trigger" value={finding.automationRecipe.trigger} />
        <div>
          <p className="font-medium">Conditions</p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {finding.automationRecipe.conditions.map((condition) => (
              <li key={condition}>- {condition}</li>
            ))}
          </ul>
        </div>
        <RecipeLine label="Action" value={finding.automationRecipe.action} />
        <RecipeLine label="Escalation" value={finding.automationRecipe.escalation} />
        <RecipeLine
          label="Expected impact"
          value={finding.automationRecipe.expectedImpact}
        />
      </div>
    </div>
  );
}

function RecipeLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-medium">{label}</p>
      <p className="mt-1 text-muted-foreground">{value}</p>
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

function EvidenceList({ finding }: { finding: LeakFinding }) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {finding.evidenceDetails.map((item) => (
        <div key={`${finding.id}-${item.label}`} className="rounded-md border bg-white p-3">
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

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-[340px] place-items-center rounded-lg border border-dashed bg-white/70 p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
          <Database className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

interface FingerprintSummary {
  fingerprint: LeakFingerprint;
  count: number;
  adjustedCost: number;
  topRecommendation: string;
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
    findingsCount: findings.length,
    workLeakScore,
  };
}

function buildFingerprintSummaries(findings: LeakFinding[]): FingerprintSummary[] {
  const grouped = findings.reduce<Record<string, LeakFinding[]>>((groups, finding) => {
    groups[finding.fingerprint] = groups[finding.fingerprint]
      ? [...groups[finding.fingerprint], finding]
      : [finding];
    return groups;
  }, {});

  return Object.entries(grouped)
    .map(([fingerprint, group]) => {
      const sorted = [...group].sort(
        (a, b) => b.projectedSavings - a.projectedSavings,
      );
      return {
        fingerprint: fingerprint as LeakFingerprint,
        count: group.length,
        adjustedCost: group.reduce(
          (total, finding) => total + finding.adjustedMonthlyCost,
          0,
        ),
        topRecommendation: sorted[0]?.recommendation ?? "Review workflow owner",
        color: fingerprintColor[fingerprint as LeakFingerprint],
      };
    })
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

function getLeakageLabel(score: number) {
  if (score >= 72) return "Severe operational leakage";
  if (score >= 44) return "Moderate operational leakage";
  return "Low operational leakage";
}

function severityVariant(severity: LeakFinding["severity"]) {
  if (severity === "Critical") return "danger";
  if (severity === "High") return "amber";
  return "teal";
}

export default App;
