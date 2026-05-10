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
  Moon,
  Play,
  Sun,
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

type View = "dashboard" | "actions" | "import" | "data";
type Theme = "light" | "dark";

const storageKey = "workleak-demo-state-v4";

const emptyData: WorkflowData = {
  tickets: [],
  meetings: [],
  pullRequests: [],
};

const tabs: { id: View; label: string; icon: typeof BarChart3 }[] = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "actions", label: "Action Plan", icon: Bot },
  { id: "import", label: "Import", icon: Upload },
  { id: "data", label: "Raw Data", icon: Database },
];

const demoSteps: { view: View; title: string; text: string }[] = [
  {
    view: "dashboard",
    title: "Executive Snapshot",
    text: "Lead with adjusted waste, healthy work ignored, and the best first fix.",
  },
  {
    view: "dashboard",
    title: "Fix This First",
    text: "Show the ROI ranking: savings, confidence, effort, and payback.",
  },
  {
    view: "dashboard",
    title: "Leak Fingerprints",
    text: "Name the pattern so the team remembers what to fix.",
  },
  {
    view: "actions",
    title: "Monday Plan",
    text: "Turn the top leaks into owners, next steps, recipes, and Jira text.",
  },
  {
    view: "actions",
    title: "Export",
    text: "Copy the plan or export Markdown, JSON, and CSV.",
  },
];

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
    accent: "bg-sky-600",
  },
  meetings: {
    label: "Meetings",
    plural: "meetings",
    samplePath: "/samples/meetings.csv",
    templateName: "workleak-meeting-template.csv",
    icon: CalendarClock,
    accent: "bg-teal-600",
  },
  pullRequests: {
    label: "Pull Requests",
    plural: "pull requests",
    samplePath: "/samples/pull_requests.csv",
    templateName: "workleak-pr-template.csv",
    icon: GitPullRequest,
    accent: "bg-rose-500",
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

const exportDefaults = {
  reportTitle: "WorkLeak Action Plan",
  companyName: "Demo Company",
};

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [theme, setTheme] = useState<Theme>("light");
  const [averageHourlyCost, setAverageHourlyCost] = useState(95);
  const [recoveryRate, setRecoveryRate] = useState(0.62);
  const [reportTitle, setReportTitle] = useState(exportDefaults.reportTitle);
  const [companyName, setCompanyName] = useState(exportDefaults.companyName);
  const [data, setData] = useState<WorkflowData>(emptyData);
  const [activeDataType, setActiveDataType] = useState<DataType>("tickets");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isLoadingSamples, setIsLoadingSamples] = useState(false);
  const [demoStep, setDemoStep] = useState<number | null>(null);

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
        theme?: Theme;
      };

      if (parsed.data) setData(parsed.data);
      if (parsed.averageHourlyCost) setAverageHourlyCost(parsed.averageHourlyCost);
      if (parsed.recoveryRate) setRecoveryRate(parsed.recoveryRate);
      if (parsed.reportTitle) setReportTitle(parsed.reportTitle);
      if (parsed.companyName) setCompanyName(parsed.companyName);
      if (parsed.theme) setTheme(parsed.theme);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        data,
        averageHourlyCost,
        recoveryRate,
        reportTitle,
        companyName,
        theme,
      }),
    );
  }, [data, averageHourlyCost, recoveryRate, reportTitle, companyName, theme]);

  const findings = useMemo(
    () => detectLeaks(data, averageHourlyCost, recoveryRate),
    [data, averageHourlyCost, recoveryRate],
  );

  const totals = useMemo(() => getTotals(data, findings), [data, findings]);
  const dataQuality = useMemo(() => getDataQuality(data), [data]);
  const hasData = totals.importedRows > 0;

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

  const fingerprintSummaries = useMemo(
    () => buildFingerprintSummaries(findings),
    [findings],
  );

  const teamSummaries = useMemo(
    () => buildTeamSummaries(findings, totals.adjustedMonthlyCost),
    [findings, totals.adjustedMonthlyCost],
  );

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
    downloadMarkdown(
      "workleak-action-plan.md",
      buildMarkdownActionPlan(findings, data, exportOptions()),
    );
  }

  function handleExportJson() {
    downloadText(
      "workleak-findings.json",
      buildJsonExport(findings, data, exportOptions()),
      "application/json;charset=utf-8",
    );
  }

  function handleExportCsv() {
    downloadText(
      "workleak-findings.csv",
      buildFindingsCsv(findings),
      "text/csv;charset=utf-8",
    );
  }

  function handleTemplateDownload(type: DataType) {
    downloadText(
      dataTypeMeta[type].templateName,
      buildCsvTemplate(type),
      "text/csv;charset=utf-8",
    );
  }

  async function startGuidedDemo() {
    if (!hasData) {
      await loadSampleData();
    }
    setView("dashboard");
    setDemoStep(0);
  }

  function handleDemoNext() {
    if (demoStep === null) return;
    const nextStep = demoStep + 1;

    if (nextStep >= demoSteps.length) {
      setDemoStep(null);
      return;
    }

    setDemoStep(nextStep);
    setView(demoSteps[nextStep].view);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,hsl(var(--secondary))_0,transparent_30%),linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--muted))_100%)] dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16)_0,transparent_32%),linear-gradient(180deg,hsl(var(--background))_0%,hsl(205_28%_8%)_100%)]" />

      <header className="sticky top-0 z-40 border-b bg-background/86 backdrop-blur-xl">
        <div className="container flex flex-col gap-4 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-1.5 shadow-sm ring-1 ring-black/5">
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

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[160px_145px_48px_150px_auto] xl:items-end">
            <MoneyInput value={averageHourlyCost} onChange={setAverageHourlyCost} />
            <PercentInput value={recoveryRate} onChange={setRecoveryRate} />
            <ThemeToggle
              theme={theme}
              onToggle={() =>
                setTheme((current) => (current === "dark" ? "light" : "dark"))
              }
            />
            <Button
              variant="secondary"
              onClick={startGuidedDemo}
              disabled={isLoadingSamples}
            >
              {isLoadingSamples ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
              Start Demo
            </Button>
            <Button onClick={handleExportMarkdown} disabled={!findings.length}>
              <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
              Export
            </Button>
          </div>
        </div>
      </header>

      <div className="container py-5">
        <nav className="mb-5 flex gap-2 overflow-x-auto rounded-lg border bg-card/75 p-1 shadow-sm backdrop-blur">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-all",
                  view === tab.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
              teamSummaries={teamSummaries}
              dataQuality={dataQuality}
              recoveryRate={recoveryRate}
              onRecoveryRateChange={setRecoveryRate}
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
              dataQuality={dataQuality}
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

        {demoStep !== null && (
          <GuidedDemoOverlay
            step={demoStep}
            onNext={handleDemoNext}
            onClose={() => setDemoStep(null)}
          />
        )}
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
      <div className="mt-1 flex items-center rounded-md border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
        <span className="text-sm text-muted-foreground">$</span>
        <Input
          id="hourly-cost"
          type="number"
          min={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value) || 1)}
          className="border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
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
      <div className="mt-1 flex items-center rounded-md border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
        <Input
          id="recovery-rate"
          type="number"
          min={1}
          max={100}
          value={Math.round(value * 100)}
          onChange={(event) =>
            onChange(Math.min(1, Math.max(0.01, Number(event.target.value) / 100)))
          }
          className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
    </div>
  );
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <div className="self-end">
      <Button
        variant="outline"
        size="icon"
        onClick={onToggle}
        aria-label="Toggle dark mode"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </Button>
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
  teamSummaries,
  dataQuality,
  recoveryRate,
  onRecoveryRateChange,
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
  teamSummaries: TeamSummary[];
  dataQuality: DataQuality;
  recoveryRate: number;
  onRecoveryRateChange: (value: number) => void;
  isLoadingSamples: boolean;
  onLoadSamples: () => void;
  onOpenImport: () => void;
  onOpenActions: () => void;
}) {
  if (!hasData) {
    return (
      <EmptyState
        icon={<Workflow className="h-7 w-7 text-primary" aria-hidden="true" />}
        title="See where work leaks time."
        description="Load demo data or upload CSVs to get adjusted waste, fix-first priorities, and an action plan."
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
  const afterFixes = Math.max(0, totals.adjustedMonthlyCost - totals.projectedSavings);

  return (
    <div className="space-y-5">
      <ObservabilityStrip />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden border-primary/20 bg-card/90 shadow-soft backdrop-blur">
          <CardContent className="p-5 lg:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">Executive Snapshot</Badge>
                  <Badge variant="outline">{totals.importedRows} scanned</Badge>
                  <Badge variant="outline">
                    {totals.healthyWorkflowCount} ignored
                  </Badge>
                </div>
                <h2 className="max-w-3xl text-2xl font-semibold tracking-normal lg:text-3xl">
                  {formatCurrency(totals.adjustedMonthlyCost)} adjusted waste.
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Best first fix: {topFinding?.fingerprint ?? "load data"}.
                  Recover {formatCurrency(totals.projectedSavings)} with the
                  first improvement cycle.
                </p>
              </div>
              <Button onClick={onOpenActions}>
                <Target className="h-4 w-4" aria-hidden="true" />
                Open Plan
              </Button>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-5">
              <MetricTile label="Adjusted" value={formatCurrency(totals.adjustedMonthlyCost)} />
              <MetricTile label="Recoverable" value={formatCurrency(totals.projectedSavings)} />
              <MetricTile label="FTE back" value={formatFte(totals.fteRecovered)} />
              <MetricTile label="After fixes" value={formatCurrency(afterFixes)} />
              <MetricTile label="Score" value={`${totals.workLeakScore}/100`} />
            </div>
          </CardContent>
        </Card>

        <FocusCard finding={topFinding} />
      </section>

      <BoardroomSummaryCard
        totals={totals}
        findings={findings}
        dataQuality={dataQuality}
      />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <LeakReplayCard finding={topFinding} />
        <FixSimulatorCard
          finding={topFinding}
          totals={totals}
          recoveryRate={recoveryRate}
          onRecoveryRateChange={onRecoveryRateChange}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <TeamLeakMap teamSummaries={teamSummaries} />
        <IntegrationPanel />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
        <Card className="bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle>Fix This First</CardTitle>
            <CardDescription>Savings, confidence, effort, payback.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {findings.slice(0, 5).map((finding, index) => (
                <CompactFinding key={finding.id} finding={finding} rank={index + 1} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle>Source Health</CardTitle>
            <CardDescription>What was scanned and what stayed quiet.</CardDescription>
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
            <DataQualityPanel dataQuality={dataQuality} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card className="bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle>Leak Fingerprints</CardTitle>
            <CardDescription>Memorable patterns, not raw alerts.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {fingerprintSummaries.slice(0, 6).map((summary) => (
                <FingerprintCard key={summary.fingerprint} summary={summary} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle>Adjusted Cost by Category</CardTitle>
            <CardDescription>Where the money is leaking.</CardDescription>
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
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))" }}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                    formatter={(value) => formatCurrency(Number(value))}
                  />
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

      <Card className="bg-card/80">
        <CardContent className="grid gap-4 p-5 lg:grid-cols-3 xl:grid-cols-5">
          <MethodNote title="Adjusted waste" text="Deduplicates overlapping signals." />
          <MethodNote title="Score" text="Lost hours, leak density, severity." />
          <MethodNote title="Fix-first" text="Savings and confidence against effort." />
          <MethodNote title="Confidence" text="Signal strength and completeness." />
          <MethodNote
            title="Recovery"
            text={`${Math.round(recoveryRate * 100)}% first-cycle assumption.`}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ObservabilityStrip() {
  return (
    <Card className="overflow-hidden border-primary/20 bg-card/86 shadow-sm">
      <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="secondary">Workflow Observability</Badge>
            <Badge variant="outline">Privacy-first prototype</Badge>
          </div>
          <h2 className="text-xl font-semibold tracking-normal">
            Find the workflow path, the leak, and the first operating change.
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            CSV data is parsed in this browser. WorkLeak stores demo state locally
            and exports only when you click.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Prototype data" value="Local only" />
          <MiniStat label="Connector model" value="Ready" />
        </div>
      </CardContent>
    </Card>
  );
}

function LeakReplayCard({ finding }: { finding?: LeakFinding }) {
  const replay = finding ? buildLeakReplay(finding) : [];

  return (
    <Card className="bg-card/90">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Leak Replay</CardTitle>
            <CardDescription>One workflow, replayed as time turns into cost.</CardDescription>
          </div>
          {finding && <Badge variant="outline">{finding.affectedRecords[0]}</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        {finding ? (
          <div className="grid gap-3 lg:grid-cols-4">
            {replay.map((event, index) => (
              <div
                key={event.title}
                className="relative rounded-lg border bg-muted/25 p-4 transition-transform duration-200 hover:-translate-y-0.5"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    {event.time}
                  </span>
                </div>
                <p className="font-semibold">{event.title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {event.detail}
                </p>
                <p className="mt-3 text-sm font-semibold tabular">
                  {formatCurrency(event.cost)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Load data to replay the top leak.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FixSimulatorCard({
  finding,
  totals,
  recoveryRate,
  onRecoveryRateChange,
}: {
  finding?: LeakFinding;
  totals: ReturnType<typeof getTotals>;
  recoveryRate: number;
  onRecoveryRateChange: (value: number) => void;
}) {
  const simulatedSavings = finding
    ? finding.adjustedMonthlyCost * recoveryRate
    : totals.projectedSavings;
  const simulatedHours = finding
    ? finding.adjustedHoursLostPerMonth * recoveryRate
    : totals.recoverableHours;

  return (
    <Card className="bg-card/90">
      <CardHeader className="pb-3">
        <CardTitle>Fix Simulator</CardTitle>
        <CardDescription>Move the recovery assumption and watch the business case.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <Label htmlFor="recovery-simulator">Recovery assumption</Label>
            <Badge variant="secondary">{Math.round(recoveryRate * 100)}%</Badge>
          </div>
          <input
            id="recovery-simulator"
            type="range"
            min={30}
            max={85}
            step={5}
            value={Math.round(recoveryRate * 100)}
            onChange={(event) => onRecoveryRateChange(Number(event.target.value) / 100)}
            className="w-full accent-primary"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Top-fix savings" value={formatCurrency(simulatedSavings)} />
          <MiniStat label="Hours back" value={`${Math.round(simulatedHours)}h/mo`} />
          <MiniStat label="FTE recovered" value={formatFte(simulatedHours / 160)} />
          <MiniStat
            label="Payback"
            value={finding ? `${finding.paybackDays}d` : "n/a"}
          />
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          This is a planning simulator, not a claim of guaranteed savings.
          Adjust the rate to match how aggressively the team can adopt the fix.
        </p>
      </CardContent>
    </Card>
  );
}

function TeamLeakMap({ teamSummaries }: { teamSummaries: TeamSummary[] }) {
  const topTeam = teamSummaries[0];

  return (
    <Card className="bg-card/90">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Org Leak Map</CardTitle>
            <CardDescription>Which team leaks most, and where to start.</CardDescription>
          </div>
          {topTeam && <Badge variant="secondary">Top team: {topTeam.team}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {teamSummaries.slice(0, 5).map((team) => (
          <div key={team.team} className="rounded-lg border bg-muted/25 p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{team.team}</p>
                <p className="text-sm text-muted-foreground">
                  {team.findingsCount} leak{team.findingsCount === 1 ? "" : "s"} ·{" "}
                  {team.primaryFingerprint}
                </p>
              </div>
              <p className="font-semibold tabular">{formatCurrency(team.adjustedCost)}</p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${team.percent}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function IntegrationPanel() {
  const [message, setMessage] = useState("CSV import is live. Connectors are demo previews.");
  const connectors = [
    { name: "Jira", source: "Tickets + approvals", icon: ListChecks },
    { name: "GitHub", source: "Pull requests", icon: GitPullRequest },
    { name: "Slack", source: "Blockers + handoffs", icon: Bot },
    { name: "Calendar", source: "Meetings", icon: CalendarClock },
  ];

  return (
    <Card className="bg-card/90">
      <CardHeader className="pb-3">
        <CardTitle>Integration-Ready</CardTitle>
        <CardDescription>Prototype connectors with a real data model behind them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border bg-secondary/65 p-3 text-sm text-secondary-foreground">
          Last synced 8 min ago · demo workspace
        </div>
        {connectors.map((connector) => {
          const Icon = connector.icon;
          return (
            <div
              key={connector.name}
              className="flex items-center justify-between gap-3 rounded-lg border bg-muted/25 p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-card">
                  <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{connector.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {connector.source}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setMessage(`${connector.name} connector preview selected. Use CSV import for the live demo.`)
                }
              >
                Connect
              </Button>
            </div>
          );
        })}
        <p className="text-sm leading-6 text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function FocusCard({ finding }: { finding?: LeakFinding }) {
  return (
    <Card className="overflow-hidden border-primary/25 bg-primary text-primary-foreground shadow-soft">
      <CardContent className="p-5">
        <p className="text-sm text-primary-foreground/70">Fix this first</p>
        {finding ? (
          <>
            <h3 className="mt-2 text-xl font-semibold">{finding.title}</h3>
            <p className="mt-2 text-sm text-primary-foreground/75">
              {finding.fingerprint} · {finding.confidence}% confidence
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <DarkStat label="Savings" value={formatCurrency(finding.projectedSavings)} />
              <DarkStat label="Payback" value={`${finding.paybackDays}d`} />
              <DarkStat label="Effort" value={`${finding.implementationDays}d`} />
              <DarkStat label="Score" value={`${finding.fixThisFirstScore}/100`} />
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-primary-foreground/75">
            Load data to see the first move.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/45 p-4 transition-transform duration-200 hover:-translate-y-0.5">
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
    <div className="rounded-lg border border-primary-foreground/15 bg-primary-foreground/10 p-3">
      <p className="text-xs text-primary-foreground/65">{label}</p>
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
    <details className="group rounded-lg border bg-muted/25 p-3 transition-all open:bg-muted/40">
      <summary className="grid cursor-pointer list-none gap-3 md:grid-cols-[38px_minmax(0,1fr)_auto] md:items-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
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
        <MiniStat label="Adjusted" value={formatCurrency(finding.adjustedMonthlyCost)} />
        <MiniStat label="Payback" value={`${finding.paybackDays}d`} />
        <MiniStat label="Effort" value={`${finding.implementationDays}d`} />
        <MiniStat label="Priority" value={finding.priority} />
      </div>
      <div className="mt-3">
        <ConfidenceDrivers finding={finding} />
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
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${source.percent}%` }}
        />
      </div>
    </div>
  );
}

function BoardroomSummaryCard({
  totals,
  findings,
  dataQuality,
}: {
  totals: ReturnType<typeof getTotals>;
  findings: LeakFinding[];
  dataQuality: DataQuality;
}) {
  const topFinding = findings[0];

  return (
    <Card className="bg-card/85">
      <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="secondary">Boardroom Summary</Badge>
            <Badge variant="outline">Data quality: {dataQuality.status}</Badge>
          </div>
          <p className="text-lg leading-8">
            Scanned {totals.importedRows} records. Adjusted waste is{" "}
            {formatCurrency(totals.adjustedMonthlyCost)} with{" "}
            {formatCurrency(totals.projectedSavings)} recoverable, equal to{" "}
            {formatFte(totals.fteRecovered)}.
          </p>
          {topFinding && (
            <p className="mt-2 text-sm text-muted-foreground">
              Highest-ROI fix: {topFinding.fingerprint} in {topFinding.team}.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Score" value={`${totals.workLeakScore}/100`} />
          <MiniStat label="FTE back" value={formatFte(totals.fteRecovered)} />
          <MiniStat label="Fields" value={`${dataQuality.requiredFieldRate}%`} />
          <MiniStat label="Outcome gaps" value={`${dataQuality.meetingOutcomeGaps}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function DataQualityPanel({ dataQuality }: { dataQuality: DataQuality }) {
  return (
    <div className="rounded-lg border bg-muted/35 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">Data Quality</p>
        <Badge variant={dataQuality.status === "Good" ? "teal" : "amber"}>
          {dataQuality.status}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniStat label="Fields" value={`${dataQuality.requiredFieldRate}%`} />
        <MiniStat label="Outcome gaps" value={`${dataQuality.meetingOutcomeGaps}`} />
      </div>
    </div>
  );
}

function FingerprintCard({ summary }: { summary: FingerprintSummary }) {
  return (
    <div className="rounded-lg border bg-muted/25 p-4 transition-transform duration-200 hover:-translate-y-0.5">
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
    <div className="rounded-md border bg-card/80 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular">{value}</p>
    </div>
  );
}

function ActionPlanView({
  findings,
  hasData,
  dataQuality,
  isLoadingSamples,
  onLoadSamples,
  onExportMarkdown,
  onExportJson,
  onExportCsv,
}: {
  findings: LeakFinding[];
  hasData: boolean;
  dataQuality: DataQuality;
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
        description="Load sample data to create a short, copyable plan."
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
      <Card className="overflow-hidden bg-card/90">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Badge variant="secondary">Monday Morning Plan</Badge>
            <h2 className="mt-2 text-2xl font-semibold tracking-normal">
              Three fixes to start with.
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Owners, effort, payback, and one-click handoff.
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
        <Card className="bg-card/90">
          <CardContent className="p-5">
            <div className="relative space-y-4 before:absolute before:left-[19px] before:top-3 before:h-[calc(100%-24px)] before:w-px before:bg-border">
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
          <Card className="bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle>Today’s Focus</CardTitle>
              <CardDescription>Smallest practical starting point.</CardDescription>
            </CardHeader>
            <CardContent>
              {findings[0] && (
                <div className="space-y-3">
                  <Badge variant="outline">{findings[0].fingerprint}</Badge>
                  <p className="text-lg font-semibold">{findings[0].title}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <MiniStat
                      label="Savings"
                      value={formatCurrency(findings[0].projectedSavings)}
                    />
                    <MiniStat label="Payback" value={`${findings[0].paybackDays}d`} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle>Boardroom Summary</CardTitle>
              <CardDescription>One paragraph for leadership.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted-foreground">
                {formatBoardroomSummary(findings, dataQuality)}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle>How To Read It</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <MethodNote title="Owner" text="Who takes the first pass." />
              <MethodNote title="Recipe" text="Trigger, action, escalation." />
              <MethodNote title="Evidence" text="Source rows and thresholds." />
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
        className={cn(
          "absolute left-0 top-1 flex h-10 w-10 items-center justify-center rounded-md border text-sm font-semibold shadow-sm transition-transform duration-200 hover:scale-105",
          accent.marker,
        )}
      >
        {index + 1}
      </div>
      <div
        className={cn(
          "rounded-lg border p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft",
          accent.card,
        )}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={severityVariant(finding.priority)}>
                {finding.fixThisFirstScore}/100
              </Badge>
              <Badge variant="outline">{finding.fingerprint}</Badge>
              <Badge variant="secondary">{finding.confidence}%</Badge>
            </div>
            <h3 className="mt-3 text-lg font-semibold">{finding.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {getSuggestedOwner(finding)}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-left lg:w-[360px]">
            <MiniStat label="Savings" value={formatCurrency(finding.projectedSavings)} />
            <MiniStat label="Effort" value={`${finding.implementationDays}d`} />
            <MiniStat label="Payback" value={`${finding.paybackDays}d`} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Affected:</span>
          {finding.affectedRecords.slice(0, 5).map((recordId) => (
            <span key={recordId} className="rounded-md border bg-card/80 px-2 py-1">
              {recordId}
            </span>
          ))}
        </div>

        <div className={cn("mt-4 rounded-md border p-3 text-sm leading-6", accent.note)}>
          {finding.recommendation}
        </div>

        <BeforeAfterMini finding={finding} />

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {finding.implementationSteps.slice(0, 3).map((step, stepIndex) => {
            const stepAccent = getStepAccent(stepIndex);
            return (
              <div
                key={step}
                className={cn(
                  "rounded-md border p-3 text-sm shadow-sm transition-transform duration-200 hover:-translate-y-0.5",
                  stepAccent,
                )}
              >
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Step {stepIndex + 1}
                </div>
                {step}
              </div>
            );
          })}
        </div>

        <details className={cn("mt-4 rounded-md border p-3 text-sm", accent.details)}>
          <summary className="cursor-pointer font-medium">Recipe and evidence</summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border bg-card/80 p-3">
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
          <div className="mt-3">
            <ConfidenceDrivers finding={finding} />
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

function BeforeAfterMini({ finding }: { finding: LeakFinding }) {
  return (
    <div className="mt-4 grid gap-3 rounded-md border bg-card/65 p-3 sm:grid-cols-3">
      <MiniStat label={finding.simulation.currentLabel} value={finding.simulation.currentValue} />
      <MiniStat label={finding.simulation.afterLabel} value={finding.simulation.afterValue} />
      <MiniStat label="Savings" value={formatCurrency(finding.simulation.savings)} />
    </div>
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
        <Card className="bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle>Bring Your Workflow Data</CardTitle>
            <CardDescription>
              CSV now, integrations later.
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
          <Card className="border-primary/20 bg-secondary/60">
            <CardHeader className="pb-3">
              <CardTitle>Privacy First</CardTitle>
              <CardDescription>
                CSVs are parsed locally in this prototype.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted-foreground">
                Nothing is uploaded to a backend. Imported rows live in browser
                storage until you replace or clear them.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle>Demo Data</CardTitle>
              <CardDescription>60 balanced workflow rows.</CardDescription>
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

          <Card className="bg-card/90">
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

      <Card className="bg-card/90">
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
    <div className="rounded-lg border bg-muted/25 p-4 shadow-sm">
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
    <div className="rounded-lg border bg-muted/25 p-4">
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
    <Card className="bg-card/90">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Raw Imported Data</CardTitle>
            <CardDescription>
              The rows behind the recommendations.
            </CardDescription>
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {(Object.keys(dataTypeMeta) as DataType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onActiveDataTypeChange(type)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center rounded-md px-3 text-sm font-medium transition-colors",
                  activeDataType === type
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
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
          className="rounded-md border bg-card/80 p-3"
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

function ConfidenceDrivers({ finding }: { finding: LeakFinding }) {
  const confidenceLevel =
    finding.confidence >= 85
      ? "High"
      : finding.confidence >= 75
        ? "Medium"
        : "Directional";
  const drivers = [
    `${confidenceLevel} confidence`,
    `${finding.evidenceDetails.length} evidence fields`,
    `${finding.affectedRecords.length} affected row${
      finding.affectedRecords.length === 1 ? "" : "s"
    }`,
    `${finding.adjustedHoursLostPerMonth} adjusted h/mo`,
  ];

  return (
    <div className="rounded-md border bg-card/75 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">How this was calculated</p>
        <Badge variant="secondary">{finding.confidence}% confidence</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {drivers.map((driver) => (
          <span
            key={driver}
            className="rounded-md border bg-muted/45 px-2 py-1 text-xs text-muted-foreground"
          >
            {driver}
          </span>
        ))}
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Confidence combines source completeness, signal strength, repeat
        frequency, and how far the workflow exceeded the threshold.
      </p>
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
    <div className="grid min-h-[340px] place-items-center rounded-lg border border-dashed bg-card/70 p-8 text-center">
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

function GuidedDemoOverlay({
  step,
  onNext,
  onClose,
}: {
  step: number;
  onNext: () => void;
  onClose: () => void;
}) {
  const current = demoSteps[step];
  const isLast = step === demoSteps.length - 1;

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[min(360px,calc(100vw-2.5rem))] rounded-lg border bg-card p-4 shadow-soft page-transition">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Badge variant="secondary">90-second demo</Badge>
          <h3 className="mt-2 font-semibold">{current.title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close guided demo"
        >
          Close
        </button>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {current.text}
      </p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex gap-1">
          {demoSteps.map((item, index) => (
            <span
              key={item.title}
              className={cn(
                "h-2 w-7 rounded-full transition-colors",
                index <= step ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
        <Button size="sm" onClick={onNext}>
          {isLast ? "Finish" : "Next"}
        </Button>
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

interface TeamSummary {
  team: string;
  findingsCount: number;
  adjustedCost: number;
  projectedSavings: number;
  primaryFingerprint: LeakFingerprint;
  bestFixScore: number;
  percent: number;
}

interface DataQuality {
  status: "Good" | "Fair";
  requiredFieldRate: number;
  meetingOutcomeGaps: number;
}

function getTotals(data: WorkflowData, findings: LeakFinding[]) {
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
  const recoverableHours = findings.reduce((total, finding) => {
    const recoveryShare =
      finding.adjustedMonthlyCost > 0
        ? finding.projectedSavings / finding.adjustedMonthlyCost
        : 0;
    return total + finding.adjustedHoursLostPerMonth * recoveryShare;
  }, 0);
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
    adjustedHoursLost,
    grossMonthlyCost,
    adjustedMonthlyCost,
    projectedSavings,
    recoverableHours,
    fteRecovered: recoverableHours / 160,
    importedRows,
    flaggedRecordCount,
    healthyWorkflowCount,
    findingsCount: findings.length,
    workLeakScore,
  };
}

function getDataQuality(data: WorkflowData): DataQuality {
  const ticketFields: (keyof TicketRecord)[] = [
    "id",
    "title",
    "team",
    "owner",
    "status",
    "waitHours",
    "cycleHours",
    "ownerChanges",
    "blockerHours",
    "repeatsPerMonth",
  ];
  const meetingFields: (keyof MeetingRecord)[] = [
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
  ];
  const prFields: (keyof PullRequestRecord)[] = [
    "id",
    "title",
    "repository",
    "author",
    "reviewer",
    "status",
    "reviewWaitHours",
    "comments",
    "reworkHours",
    "blockerHours",
    "repeatsPerMonth",
  ];

  const required = [
    ...data.tickets.flatMap((row) => ticketFields.map((field) => row[field])),
    ...data.meetings.flatMap((row) => meetingFields.map((field) => row[field])),
    ...data.pullRequests.flatMap((row) => prFields.map((field) => row[field])),
  ];
  const present = required.filter(
    (value) => value !== undefined && value !== null && value !== "",
  ).length;
  const requiredFieldRate =
    required.length === 0 ? 0 : Math.round((present / required.length) * 100);
  const meetingOutcomeGaps = data.meetings.filter(
    (meeting) => !meeting.outcomeCaptured || meeting.actionItems === 0,
  ).length;

  return {
    status: requiredFieldRate >= 90 ? "Good" : "Fair",
    requiredFieldRate,
    meetingOutcomeGaps,
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

function buildTeamSummaries(
  findings: LeakFinding[],
  totalAdjustedCost: number,
): TeamSummary[] {
  const grouped = findings.reduce<Record<string, LeakFinding[]>>(
    (groups, finding) => {
      groups[finding.team] = groups[finding.team]
        ? [...groups[finding.team], finding]
        : [finding];
      return groups;
    },
    {},
  );

  return Object.entries(grouped)
    .map(([team, group]) => {
      const fingerprintCounts = group.reduce<Record<string, number>>(
        (counts, finding) => {
          counts[finding.fingerprint] = (counts[finding.fingerprint] ?? 0) + 1;
          return counts;
        },
        {},
      );
      const primaryFingerprint = Object.entries(fingerprintCounts).sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0] as LeakFingerprint;
      const adjustedCost = group.reduce(
        (total, finding) => total + finding.adjustedMonthlyCost,
        0,
      );

      return {
        team,
        findingsCount: group.length,
        adjustedCost,
        projectedSavings: group.reduce(
          (total, finding) => total + finding.projectedSavings,
          0,
        ),
        primaryFingerprint,
        bestFixScore: Math.max(
          ...group.map((finding) => finding.fixThisFirstScore),
        ),
        percent:
          totalAdjustedCost > 0
            ? Math.max(4, Math.round((adjustedCost / totalAdjustedCost) * 100))
            : 0,
      };
    })
    .sort((a, b) => b.adjustedCost - a.adjustedCost);
}

function buildLeakReplay(finding: LeakFinding) {
  const firstRecord = finding.affectedRecords[0] ?? "source row";
  const halfCost = finding.adjustedMonthlyCost * 0.5;
  const finalCost = finding.adjustedMonthlyCost;

  return [
    {
      time: "Day 1",
      title: "Workflow starts",
      detail: `${firstRecord} enters ${finding.team}.`,
      cost: 0,
    },
    {
      time: "Signal",
      title: finding.simulation.currentLabel,
      detail: `${finding.simulation.currentValue} exceeds the operating threshold.`,
      cost: halfCost,
    },
    {
      time: "Pattern",
      title: finding.fingerprint,
      detail: finding.evidence,
      cost: finalCost,
    },
    {
      time: "Fix",
      title: finding.simulation.afterLabel,
      detail: `${finding.recommendation}`,
      cost: finding.simulation.afterMonthlyCost,
    },
  ];
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

function formatBoardroomSummary(findings: LeakFinding[], dataQuality: DataQuality) {
  const topFinding = findings[0];
  const adjustedWaste = findings.reduce(
    (total, finding) => total + finding.adjustedMonthlyCost,
    0,
  );
  const savings = findings.reduce(
    (total, finding) => total + finding.projectedSavings,
    0,
  );

  if (!topFinding) {
    return "WorkLeak has not detected high-value workflow leaks yet.";
  }

  return `WorkLeak identified ${
    findings.length
  } high-value workflow leaks with ${dataQuality.status.toLowerCase()} data quality. Adjusted monthly waste is ${formatCurrency(
    adjustedWaste,
  )}, with ${formatCurrency(
    savings,
  )} recoverable. The highest-ROI fix is ${topFinding.fingerprint.toLowerCase()} in ${
    topFinding.team
  }.`;
}

function formatFte(value: number) {
  return `${value.toFixed(value >= 1 ? 1 : 2)} FTE`;
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
      marker: "action-marker-sky",
      card: "action-card-sky",
      note: "action-note-sky",
      details: "action-details-sky",
    },
    {
      marker: "action-marker-teal",
      card: "action-card-teal",
      note: "action-note-teal",
      details: "action-details-teal",
    },
    {
      marker: "action-marker-amber",
      card: "action-card-amber",
      note: "action-note-amber",
      details: "action-details-amber",
    },
    {
      marker: "action-marker-rose",
      card: "action-card-rose",
      note: "action-note-rose",
      details: "action-details-rose",
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
    "step-accent-teal",
    "step-accent-amber",
    "step-accent-emerald",
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
