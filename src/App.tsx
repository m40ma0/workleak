import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Database,
  FileSpreadsheet,
  FileText,
  Gauge,
  GitPullRequest,
  Handshake,
  LineChart,
  ListChecks,
  Loader2,
  Upload,
  WalletCards,
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
import { buildMarkdownActionPlan, downloadMarkdown } from "./lib/export";
import { cn, formatCurrency, formatHours } from "./lib/utils";
import type {
  DataType,
  LeakCategory,
  LeakFinding,
  MeetingRecord,
  PullRequestRecord,
  TicketRecord,
  WorkflowData,
} from "./types";

type View = "dashboard" | "import" | "data" | "actions";

const storageKey = "workleak-demo-state";

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
    icon: typeof FileSpreadsheet;
    accent: string;
  }
> = {
  tickets: {
    label: "Tickets",
    plural: "tickets",
    samplePath: "/samples/tickets.csv",
    icon: ListChecks,
    accent: "bg-[#22577a]",
  },
  meetings: {
    label: "Meetings",
    plural: "meetings",
    samplePath: "/samples/meetings.csv",
    icon: CalendarClock,
    accent: "bg-[#38a3a5]",
  },
  pullRequests: {
    label: "Pull Requests",
    plural: "pull requests",
    samplePath: "/samples/pull_requests.csv",
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

const tabs: { id: View; label: string; icon: typeof BarChart3 }[] = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "import", label: "Import", icon: Upload },
  { id: "data", label: "Raw Data", icon: Database },
  { id: "actions", label: "Action Plan", icon: Bot },
];

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [averageHourlyCost, setAverageHourlyCost] = useState(95);
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
      };
      if (parsed.data) setData(parsed.data);
      if (parsed.averageHourlyCost) {
        setAverageHourlyCost(parsed.averageHourlyCost);
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ data, averageHourlyCost }),
    );
  }, [data, averageHourlyCost]);

  const findings = useMemo(
    () => detectLeaks(data, averageHourlyCost),
    [data, averageHourlyCost],
  );

  const totals = useMemo(() => {
    const hoursLost = findings.reduce(
      (total, finding) => total + finding.hoursLostPerMonth,
      0,
    );
    const monthlyCost = findings.reduce(
      (total, finding) => total + finding.monthlyCost,
      0,
    );
    const projectedSavings = findings.reduce(
      (total, finding) => total + finding.projectedSavings,
      0,
    );
    const importedRows =
      data.tickets.length + data.meetings.length + data.pullRequests.length;

    return { hoursLost, monthlyCost, projectedSavings, importedRows };
  }, [data, findings]);

  const categoryChart = useMemo(() => {
    const totalsByCategory = findings.reduce<Record<string, number>>(
      (totalsByCategory, finding) => {
        totalsByCategory[finding.category] =
          (totalsByCategory[finding.category] ?? 0) + finding.monthlyCost;
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
          .reduce((total, finding) => total + finding.monthlyCost, 0);

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
      { name: "Current Waste", cost: Math.round(totals.monthlyCost) },
      {
        name: "After Fixes",
        cost: Math.round(totals.monthlyCost - totals.projectedSavings),
      },
    ],
    [totals.monthlyCost, totals.projectedSavings],
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

  function handleExport() {
    const markdown = buildMarkdownActionPlan(
      findings,
      data,
      averageHourlyCost,
    );
    downloadMarkdown("workleak-action-plan.md", markdown);
  }

  const hasData = totals.importedRows > 0;
  const topFinding = findings[0];

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7fbfb_0%,#edf5f3_48%,#f8faf8_100%)]">
      <div className="border-b bg-white/80 backdrop-blur">
        <div className="container flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-leak-ink text-white shadow-soft">
              <Gauge className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">
                WorkLeak
              </h1>
              <p className="text-sm text-muted-foreground">
                Operations intelligence dashboard
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:w-44">
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
            <Button onClick={handleExport} disabled={!findings.length}>
              <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
              Export
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
            onLoadSamples={loadSampleData}
            isLoadingSamples={isLoadingSamples}
            onOpenImport={() => setView("import")}
          />
        )}

        {view === "import" && (
          <ImportView
            data={data}
            importErrors={importErrors}
            onFileUpload={handleFileUpload}
            onLoadSamples={loadSampleData}
            isLoadingSamples={isLoadingSamples}
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
  onLoadSamples,
  isLoadingSamples,
  onOpenImport,
}: {
  hasData: boolean;
  totals: {
    hoursLost: number;
    monthlyCost: number;
    projectedSavings: number;
    importedRows: number;
  };
  findings: LeakFinding[];
  topFinding?: LeakFinding;
  categoryChart: { category: string; cost: number; fill: string }[];
  sourceChart: { name: string; value: number; fill: string }[];
  projectionData: { name: string; cost: number }[];
  onLoadSamples: () => void;
  isLoadingSamples: boolean;
  onOpenImport: () => void;
}) {
  if (!hasData) {
    return (
      <div className="grid min-h-[64vh] place-items-center">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-white shadow-soft">
            <WalletCards className="h-7 w-7 text-primary" aria-hidden="true" />
          </div>
          <h2 className="text-3xl font-semibold tracking-normal">
            Find the work leaks worth fixing first.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Upload workflow CSVs or open the seeded demo to see monthly waste,
            ranked savings opportunities, and ready-to-use action plans.
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Monthly Waste"
          value={formatCurrency(totals.monthlyCost)}
          note="Hours lost x hourly cost"
          icon={WalletCards}
          tone="bg-[#22577a]"
        />
        <MetricCard
          title="Projected Savings"
          value={formatCurrency(totals.projectedSavings)}
          note="Recoverable with first fixes"
          icon={LineChart}
          tone="bg-[#57cc99]"
        />
        <MetricCard
          title="Hours Lost"
          value={formatHours(totals.hoursLost)}
          note="Estimated per month"
          icon={Clock3}
          tone="bg-[#f07167]"
        />
        <MetricCard
          title="Leaks Found"
          value={String(findings.length)}
          note={`${totals.importedRows} imported rows`}
          icon={AlertTriangle}
          tone="bg-[#f2c14e]"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Top Savings Opportunities</CardTitle>
            <CardDescription>
              Ranked by estimated monthly cost.
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
            <CardTitle>Before / After Projection</CardTitle>
            <CardDescription>
              Model assumes the first improvement cycle captures 62% of waste.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={projectionData} margin={{ top: 24, right: 8, left: 8, bottom: 0 }}>
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Cost by Leak Category</CardTitle>
            <CardDescription>
              Which type of friction is costing the most.
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

      {topFinding && (
        <Card className="border-primary/30 bg-white">
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>Executive Summary</CardTitle>
                <CardDescription>
                  The highest-value improvement from this dataset.
                </CardDescription>
              </div>
              <Badge variant={severityVariant(topFinding.severity)}>
                {topFinding.severity}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="max-w-5xl text-lg leading-8">
              {topFinding.executiveSummary}
            </p>
          </CardContent>
        </Card>
      )}
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
    <div className="grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-[48px_minmax(0,1fr)_auto] md:items-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-base font-semibold">
        {rank}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-semibold">{finding.title}</h3>
          <Badge variant={severityVariant(finding.severity)}>
            {finding.severity}
          </Badge>
          <Badge variant="outline">{finding.category}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {finding.evidence}
        </p>
      </div>
      <div className="text-left md:text-right">
        <p className="text-xl font-semibold tabular">
          {formatCurrency(finding.monthlyCost)}
        </p>
        <p className="text-sm text-muted-foreground">
          {formatHours(finding.hoursLostPerMonth)}h/mo
        </p>
      </div>
    </div>
  );
}

function ImportView({
  data,
  importErrors,
  onFileUpload,
  onLoadSamples,
  isLoadingSamples,
}: {
  data: WorkflowData;
  importErrors: string[];
  onFileUpload: (type: DataType, file: File | null) => void;
  onLoadSamples: () => void;
  isLoadingSamples: boolean;
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
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Seed Dataset</CardTitle>
            <CardDescription>
              Demo data has high-friction tickets, meetings, and PRs.
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
              Required columns are included in the sample CSV files under{" "}
              <span className="font-medium text-foreground">public/samples</span>.
            </div>
          </CardContent>
        </Card>
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
}: {
  findings: LeakFinding[];
  hasData: boolean;
  onLoadSamples: () => void;
  isLoadingSamples: boolean;
}) {
  if (!hasData) {
    return (
      <EmptyState
        title="No action plan yet"
        description="Load the seeded dataset to generate summaries, recommendations, implementation steps, and Jira ticket text."
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
      {findings.slice(0, 6).map((finding, index) => (
        <Card key={finding.id}>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">#{index + 1}</Badge>
                  <Badge variant={severityVariant(finding.severity)}>
                    {finding.severity}
                  </Badge>
                  <Badge variant="secondary">{finding.category}</Badge>
                </div>
                <CardTitle>{finding.title}</CardTitle>
                <CardDescription>{finding.evidence}</CardDescription>
              </div>
              <div className="text-left lg:text-right">
                <p className="text-2xl font-semibold tabular">
                  {formatCurrency(finding.monthlyCost)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatCurrency(finding.projectedSavings)} projected savings
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
              <div className="space-y-4">
                <ActionBlock
                  icon={Bot}
                  title="Summary"
                  text={finding.executiveSummary}
                />
                <ActionBlock
                  icon={CheckCircle2}
                  title="Recommended Fix"
                  text={finding.recommendation}
                />
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <Handshake
                      className="h-4 w-4 text-primary"
                      aria-hidden="true"
                    />
                    <h3 className="font-semibold">Implementation Steps</h3>
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
              </div>
              <div className="rounded-lg border bg-leak-ink p-4 text-white">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  <h3 className="font-semibold">Jira Ticket Text</h3>
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-black/20 p-4 text-sm leading-6 text-white/90">
                  {finding.jiraTicket}
                </pre>
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
}: {
  icon: typeof Bot;
  title: string;
  text: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="rounded-md border bg-white p-3 text-sm leading-6 text-muted-foreground">
        {text}
      </p>
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

function severityVariant(severity: LeakFinding["severity"]) {
  if (severity === "Critical") return "danger";
  if (severity === "High") return "amber";
  return "teal";
}

export default App;
