import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  Cloud,
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
  Settings,
  Sparkles,
  Sun,
  Target,
  Upload,
  UserCircle,
  Workflow,
} from "lucide-react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
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
import {
  ensureUserWorkspace,
  fetchSavedReports,
  saveAnalysisSnapshot,
  type SavedReportSummary,
} from "./lib/cloudPersistence";
import { detectLeaks } from "./lib/detection";
import {
  buildCsvTemplate,
  buildFindingsCsv,
  buildJsonExport,
  buildMarkdownActionPlan,
  downloadMarkdown,
  downloadText,
} from "./lib/export";
import { firebaseAuth, firebaseEnabled } from "./lib/firebase";
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

type View = "dashboard" | "actions" | "import" | "data" | "settings";
type Theme = "light" | "dark";
type DataOrigin = "empty" | "sample" | "upload";

const CategoryCostChart = lazy(() => import("./components/CategoryCostChart"));

interface GeneratedActionPlan {
  executiveSummary: string;
  recommendation: string;
  implementationSteps: string[];
  jiraTicket: string;
  automationRecipe: {
    trigger: string;
    conditions: string[];
    action: string;
    escalation: string;
    expectedImpact: string;
  };
}

type GeminiStatus = "idle" | "loading" | "ready" | "error";
type CloudStatus = "idle" | "loading" | "saving" | "saved" | "error";

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
  { id: "settings", label: "Settings", icon: Settings },
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
  companyName: "Acme Operations",
};

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [theme, setTheme] = useState<Theme>("light");
  const [averageHourlyCost, setAverageHourlyCost] = useState(95);
  const [recoveryRate, setRecoveryRate] = useState(0.62);
  const [reportTitle, setReportTitle] = useState(exportDefaults.reportTitle);
  const [companyName, setCompanyName] = useState(exportDefaults.companyName);
  const [data, setData] = useState<WorkflowData>(emptyData);
  const [dataOrigin, setDataOrigin] = useState<DataOrigin>("empty");
  const [activeDataType, setActiveDataType] = useState<DataType>("tickets");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isLoadingSamples, setIsLoadingSamples] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(!firebaseEnabled);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signIn" | "signUp">("signIn");
  const [authBusy, setAuthBusy] = useState(false);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReportSummary[]>([]);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>("idle");
  const [cloudMessage, setCloudMessage] = useState("");

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
        dataOrigin?: DataOrigin;
      };

      if (parsed.data) setData(parsed.data);
      if (parsed.averageHourlyCost) setAverageHourlyCost(parsed.averageHourlyCost);
      if (parsed.recoveryRate) setRecoveryRate(parsed.recoveryRate);
      if (parsed.reportTitle) setReportTitle(parsed.reportTitle);
      if (parsed.companyName) setCompanyName(parsed.companyName);
      if (parsed.theme) setTheme(parsed.theme);
      if (parsed.dataOrigin) setDataOrigin(parsed.dataOrigin);
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
        dataOrigin,
      }),
    );
  }, [
    data,
    averageHourlyCost,
    recoveryRate,
    reportTitle,
    companyName,
    theme,
    dataOrigin,
  ]);

  useEffect(() => {
    if (!firebaseAuth) return undefined;

    return onAuthStateChanged(firebaseAuth, async (user) => {
      setFirebaseUser(user);
      setAuthReady(true);

      if (!user) {
        setWorkspaceId(null);
        setSavedReports([]);
        return;
      }

      setCloudStatus("loading");
      setCloudMessage("");

      try {
        const ensuredWorkspaceId = await ensureUserWorkspace(user, companyName);
        setWorkspaceId(ensuredWorkspaceId);
        setSavedReports(await fetchSavedReports(ensuredWorkspaceId));
        setCloudStatus("idle");
      } catch (error) {
        setCloudStatus("error");
        setCloudMessage(getErrorMessage(error));
      }
    });
  }, [companyName]);

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
      setDataOrigin("sample");
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
    setDataOrigin("upload");
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

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseAuth) {
      setCloudStatus("error");
      setCloudMessage("Firebase is not configured.");
      return;
    }

    setAuthBusy(true);
    setCloudStatus("loading");
    setCloudMessage("");

    try {
      if (authMode === "signUp") {
        await createUserWithEmailAndPassword(
          firebaseAuth,
          authEmail.trim(),
          authPassword,
        );
      } else {
        await signInWithEmailAndPassword(
          firebaseAuth,
          authEmail.trim(),
          authPassword,
        );
      }
      setAuthPassword("");
      setAuthPanelOpen(false);
    } catch (error) {
      setCloudStatus("error");
      setCloudMessage(getErrorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleCloudSignOut() {
    if (!firebaseAuth) return;
    await signOut(firebaseAuth);
    setAuthPanelOpen(false);
    setCloudStatus("idle");
    setCloudMessage("");
  }

  async function refreshSavedReports(ensuredWorkspaceId = workspaceId) {
    if (!ensuredWorkspaceId) return;
    setSavedReports(await fetchSavedReports(ensuredWorkspaceId));
  }

  async function handleSaveToCloud() {
    if (!firebaseUser) {
      setCloudStatus("error");
      setCloudMessage("Sign in before saving a WorkLeak report.");
      return;
    }

    if (!hasData || findings.length === 0) {
      setCloudStatus("error");
      setCloudMessage("Load or upload workflow data before saving.");
      return;
    }

    setCloudStatus("saving");
    setCloudMessage("");

    try {
      const ensuredWorkspaceId =
        workspaceId ?? (await ensureUserWorkspace(firebaseUser, companyName));

      if (!workspaceId) {
        setWorkspaceId(ensuredWorkspaceId);
      }

      const saved = await saveAnalysisSnapshot({
        user: firebaseUser,
        workspaceId: ensuredWorkspaceId,
        reportTitle,
        companyName,
        dataOrigin,
        data,
        findings,
        totals,
        dataQuality,
        averageHourlyCost,
        recoveryRate,
      });

      try {
        await refreshSavedReports(ensuredWorkspaceId);
      } catch {
        setSavedReports([]);
        setCloudStatus("saved");
        setCloudMessage(
          `Saved report ${saved.reportId.slice(0, 6)} to Firestore. Report list could not refresh; check Firestore read rules.`,
        );
        return;
      }

      setCloudStatus("saved");
      setCloudMessage(`Saved report ${saved.reportId.slice(0, 6)} to Firestore.`);
    } catch (error) {
      setCloudStatus("error");
      setCloudMessage(getErrorMessage(error));
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,hsl(var(--secondary))_0,transparent_30%),linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--muted))_100%)] dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16)_0,transparent_32%),linear-gradient(180deg,hsl(var(--background))_0%,hsl(205_28%_8%)_100%)]" />

      <ProductHeader
        tabs={tabs}
        view={view}
        onViewChange={setView}
        theme={theme}
        onThemeToggle={() =>
          setTheme((current) => (current === "dark" ? "light" : "dark"))
        }
        firebaseEnabled={firebaseEnabled}
        authReady={authReady}
        user={firebaseUser}
        authMode={authMode}
        authEmail={authEmail}
        authPassword={authPassword}
        authBusy={authBusy}
        authPanelOpen={authPanelOpen}
        cloudStatus={cloudStatus}
        cloudMessage={cloudMessage}
        onAuthPanelOpenChange={setAuthPanelOpen}
        onAuthModeChange={setAuthMode}
        onAuthEmailChange={setAuthEmail}
        onAuthPasswordChange={setAuthPassword}
        onAuthSubmit={handleAuthSubmit}
        onSignOut={handleCloudSignOut}
      />

      <div className="container py-6">

        <div key={view} className="page-transition">
          {view === "dashboard" && (
            <DashboardView
              hasData={hasData}
              data={data}
              dataOrigin={dataOrigin}
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
              isLoadingSamples={isLoadingSamples}
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

          {view === "settings" && (
            <SettingsView
              averageHourlyCost={averageHourlyCost}
              recoveryRate={recoveryRate}
              reportTitle={reportTitle}
              companyName={companyName}
              firebaseEnabled={firebaseEnabled}
              authReady={authReady}
              user={firebaseUser}
              cloudStatus={cloudStatus}
              cloudMessage={cloudMessage}
              savedReports={savedReports}
              hasData={hasData}
              findingsCount={findings.length}
              onAverageHourlyCostChange={setAverageHourlyCost}
              onRecoveryRateChange={setRecoveryRate}
              onReportTitleChange={setReportTitle}
              onCompanyNameChange={setCompanyName}
              onSave={handleSaveToCloud}
              onOpenImport={() => setView("import")}
              onExportMarkdown={handleExportMarkdown}
              onExportJson={handleExportJson}
              onExportCsv={handleExportCsv}
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
    <Button
      variant="outline"
      size="icon"
      onClick={onToggle}
      aria-label="Toggle dark mode"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

function ProductHeader({
  tabs,
  view,
  onViewChange,
  theme,
  onThemeToggle,
  firebaseEnabled: isFirebaseEnabled,
  authReady,
  user,
  authMode,
  authEmail,
  authPassword,
  authBusy,
  authPanelOpen,
  cloudStatus,
  cloudMessage,
  onAuthPanelOpenChange,
  onAuthModeChange,
  onAuthEmailChange,
  onAuthPasswordChange,
  onAuthSubmit,
  onSignOut,
}: {
  tabs: { id: View; label: string; icon: typeof BarChart3 }[];
  view: View;
  onViewChange: (view: View) => void;
  theme: Theme;
  onThemeToggle: () => void;
  firebaseEnabled: boolean;
  authReady: boolean;
  user: FirebaseUser | null;
  authMode: "signIn" | "signUp";
  authEmail: string;
  authPassword: string;
  authBusy: boolean;
  authPanelOpen: boolean;
  cloudStatus: CloudStatus;
  cloudMessage: string;
  onAuthPanelOpenChange: (open: boolean) => void;
  onAuthModeChange: (mode: "signIn" | "signUp") => void;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onAuthSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/88 shadow-sm backdrop-blur-xl">
      <div className="container flex flex-col gap-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-1.5 shadow-sm ring-1 ring-black/5 dark:bg-slate-50">
            <img
              src="/logo.png"
              alt="WorkLeak"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-normal">WorkLeak</h1>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto rounded-lg border bg-card/76 p-1 shadow-sm xl:order-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onViewChange(tab.id)}
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

        <div className="relative flex items-center gap-2 xl:justify-end">
          <ThemeToggle theme={theme} onToggle={onThemeToggle} />
          <AccountControl
            firebaseEnabled={isFirebaseEnabled}
            authReady={authReady}
            user={user}
            authPanelOpen={authPanelOpen}
            cloudStatus={cloudStatus}
            onAuthPanelOpenChange={onAuthPanelOpenChange}
            onSignOut={onSignOut}
          />
          {authPanelOpen && !user && (
            <AuthPanel
              authMode={authMode}
              authEmail={authEmail}
              authPassword={authPassword}
              authBusy={authBusy}
              cloudStatus={cloudStatus}
              cloudMessage={cloudMessage}
              onAuthModeChange={onAuthModeChange}
              onAuthEmailChange={onAuthEmailChange}
              onAuthPasswordChange={onAuthPasswordChange}
              onAuthSubmit={onAuthSubmit}
            />
          )}
        </div>
      </div>
    </header>
  );
}

function AccountControl({
  firebaseEnabled: isFirebaseEnabled,
  authReady,
  user,
  authPanelOpen,
  cloudStatus,
  onAuthPanelOpenChange,
  onSignOut,
}: {
  firebaseEnabled: boolean;
  authReady: boolean;
  user: FirebaseUser | null;
  authPanelOpen: boolean;
  cloudStatus: CloudStatus;
  onAuthPanelOpenChange: (open: boolean) => void;
  onSignOut: () => void;
}) {
  if (!isFirebaseEnabled) {
    return (
      <Badge variant="outline" className="h-10 px-3">
        Cloud off
      </Badge>
    );
  }

  if (!authReady) {
    return (
      <Button variant="outline" disabled>
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Connecting
      </Button>
    );
  }

  if (!user) {
    return (
      <Button
        type="button"
        variant={authPanelOpen ? "secondary" : "outline"}
        onClick={() => onAuthPanelOpenChange(!authPanelOpen)}
      >
        <UserCircle className="h-4 w-4" aria-hidden="true" />
        Sign in
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden max-w-[190px] items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm md:flex">
        <UserCircle className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="truncate">{user.email}</span>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={onSignOut}
        disabled={cloudStatus === "saving"}
      >
        Sign out
      </Button>
    </div>
  );
}

function AuthPanel({
  authMode,
  authEmail,
  authPassword,
  authBusy,
  cloudStatus,
  cloudMessage,
  onAuthModeChange,
  onAuthEmailChange,
  onAuthPasswordChange,
  onAuthSubmit,
}: {
  authMode: "signIn" | "signUp";
  authEmail: string;
  authPassword: string;
  authBusy: boolean;
  cloudStatus: CloudStatus;
  cloudMessage: string;
  onAuthModeChange: (mode: "signIn" | "signUp") => void;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onAuthSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Card className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-2rem))] bg-card shadow-soft page-transition">
      <CardHeader className="pb-3">
        <CardTitle>{authMode === "signIn" ? "Sign in" : "Create account"}</CardTitle>
        <CardDescription>Save reports to your private Firestore workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={onAuthSubmit}>
          <div>
            <Label htmlFor="cloud-email">Email</Label>
            <Input
              id="cloud-email"
              type="email"
              value={authEmail}
              onChange={(event) => onAuthEmailChange(event.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>
          <div>
            <Label htmlFor="cloud-password">Password</Label>
            <Input
              id="cloud-password"
              type="password"
              value={authPassword}
              onChange={(event) => onAuthPasswordChange(event.target.value)}
              placeholder="6+ characters"
              minLength={6}
              required
            />
          </div>
          {cloudMessage && (
            <p
              className={cn(
                "text-sm",
                cloudStatus === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {cloudMessage}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={authBusy}>
              {authBusy && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {authMode === "signIn" ? "Sign in" : "Create account"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onAuthModeChange(authMode === "signIn" ? "signUp" : "signIn")
              }
            >
              {authMode === "signIn" ? "Create account" : "Use sign in"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DashboardView({
  hasData,
  data,
  dataOrigin,
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
  data: WorkflowData;
  dataOrigin: DataOrigin;
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
        description="Load sample data or upload CSVs to get adjusted waste, fix-first priorities, and an action plan."
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
      <ObservabilityStrip dataOrigin={dataOrigin} />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden border-primary/20 bg-card/90 shadow-soft backdrop-blur">
          <CardContent className="p-5 lg:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">Executive Snapshot</Badge>
                  <Badge variant="outline">{getDataOriginLabel(dataOrigin)}</Badge>
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
              <MetricTile label="Workflow health" value={`${totals.workflowHealthScore}/100`} />
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
        <LeakReplayCard finding={topFinding} data={data} />
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
            <Suspense
              fallback={
                <div className="mx-auto grid h-72 w-full max-w-[680px] place-items-center rounded-md border bg-muted/25 text-sm text-muted-foreground">
                  Loading chart...
                </div>
              }
            >
              <CategoryCostChart data={categoryChart} />
            </Suspense>
          </CardContent>
        </Card>
      </section>

      <Card className="bg-card/80">
        <CardContent className="grid gap-4 p-5 lg:grid-cols-3 xl:grid-cols-5">
          <MethodNote title="Adjusted waste" text="Deduplicates overlapping signals." />
          <MethodNote title="Health" text="100 minus leak severity." />
          <MethodNote title="Fix priority" text="Savings and confidence against effort." />
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

function ObservabilityStrip({ dataOrigin }: { dataOrigin: DataOrigin }) {
  return (
    <Card className="overflow-hidden border-primary/20 bg-card/86 shadow-sm">
      <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="secondary">Workflow Observability</Badge>
            <Badge variant="outline">Privacy-first prototype</Badge>
          </div>
          <h2 className="text-xl font-semibold tracking-normal">
            WorkLeak is observability for company workflows.
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            It shows where work slows down, what it costs, and which operating
            change should happen first.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Data source" value={getDataOriginLabel(dataOrigin)} />
          <MiniStat label="Connector model" value="Ready" />
        </div>
      </CardContent>
    </Card>
  );
}

function LeakReplayCard({
  finding,
  data,
}: {
  finding?: LeakFinding;
  data: WorkflowData;
}) {
  const replay = finding ? buildLeakReplay(finding, data) : [];

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
                key={`${event.time}-${event.title}`}
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
  const [message, setMessage] = useState("CSV import is live. Connectors are preview blueprints.");
  const connectors = [
    { name: "Jira", source: "Tickets + approvals", icon: ListChecks },
    { name: "GitHub", source: "Pull requests", icon: GitPullRequest },
    { name: "Slack", source: "Blockers + handoffs", icon: Bot },
    { name: "Calendar", source: "Meetings", icon: CalendarClock },
  ];

  return (
    <Card className="bg-card/90">
      <CardHeader className="pb-3">
        <CardTitle>Connector Previews</CardTitle>
        <CardDescription>How live Jira, GitHub, Slack, and Calendar signals would map in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border bg-secondary/65 p-3 text-sm text-secondary-foreground">
          Last synced 8 min ago · preview workspace
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
                  setMessage(`${connector.name} preview selected. Use CSV import in this build.`)
                }
              >
                Preview
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
              <DarkStat label="Fix priority" value={`${finding.fixThisFirstScore}`} />
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
          <MiniStat label="Workflow health" value={`${totals.workflowHealthScore}/100`} />
          <MiniStat label="Leak severity" value={totals.leakSeverityLabel} />
          <MiniStat label="FTE back" value={formatFte(totals.fteRecovered)} />
          <MiniStat label="Fields" value={`${dataQuality.requiredFieldRate}%`} />
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
        <MiniStat label="Stale open rows" value={`${dataQuality.staleRows}`} />
        <MiniStat label="Anomalies" value={`${dataQuality.issueCount}`} />
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Checks include missing owners, impossible dates, suspicious values,
        stale open work, and inconsistent team naming.
      </p>
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

function ScoreChip({ score }: { score: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
      title="Fix priority combines savings, confidence, effort, and payback. Higher means better to fix first."
    >
      <span>Fix priority</span>
      <span className="tabular">{score}</span>
    </span>
  );
}

function ActionPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card/80 px-3 py-2">
      <p className="text-[11px] font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular">{value}</p>
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
  const [generatedPlans, setGeneratedPlans] = useState<
    Record<string, GeneratedActionPlan>
  >({});
  const [geminiStatus, setGeminiStatus] = useState<Record<string, GeminiStatus>>(
    {},
  );
  const [geminiErrors, setGeminiErrors] = useState<Record<string, string>>({});

  async function copyText(id: string, text: string) {
    await copyToClipboard(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1500);
  }

  async function generateGeminiPlan(finding: LeakFinding) {
    setGeminiStatus((current) => ({ ...current, [finding.id]: "loading" }));
    setGeminiErrors((current) => {
      const next = { ...current };
      delete next[finding.id];
      return next;
    });

    try {
      const plan = await requestGeneratedActionPlan(finding);
      setGeneratedPlans((current) => ({ ...current, [finding.id]: plan }));
      setGeminiStatus((current) => ({ ...current, [finding.id]: "ready" }));
    } catch (error) {
      setGeminiStatus((current) => ({ ...current, [finding.id]: "error" }));
      setGeminiErrors((current) => ({
        ...current,
        [finding.id]:
          error instanceof Error
            ? error.message
            : "Gemini plan could not be generated.",
      }));
    }
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
              Priority action plan.
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Three manager-ready fixes with owner, payoff, and handoff.
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
              {findings.slice(0, 3).map((finding, index) => (
                <TimelineItem
                  key={finding.id}
                  finding={finding}
                  index={index}
                  copiedId={copiedId}
                  generatedPlan={generatedPlans[finding.id]}
                  geminiStatus={geminiStatus[finding.id] ?? "idle"}
                  geminiError={geminiErrors[finding.id]}
                  onCopy={copyText}
                  onGenerateGeminiPlan={generateGeminiPlan}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle>How to Read It</CardTitle>
              <CardDescription>Plain-English scoring for managers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <MethodNote title="Fix priority" text="Higher means better to start now." />
              <MethodNote title="Confidence" text="How strong the detected signal is." />
              <MethodNote title="Payback" text="Days until the fix pays for itself." />
              <MethodNote title="Evidence" text="Source rows live inside each card." />
            </CardContent>
          </Card>

          <Card className="bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle>Plan Summary</CardTitle>
              <CardDescription>One paragraph for leadership.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted-foreground">
                {formatBoardroomSummary(findings, dataQuality)}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SettingsView({
  averageHourlyCost,
  recoveryRate,
  reportTitle,
  companyName,
  firebaseEnabled: isFirebaseEnabled,
  authReady,
  user,
  cloudStatus,
  cloudMessage,
  savedReports,
  hasData,
  findingsCount,
  onAverageHourlyCostChange,
  onRecoveryRateChange,
  onReportTitleChange,
  onCompanyNameChange,
  onSave,
  onOpenImport,
  onExportMarkdown,
  onExportJson,
  onExportCsv,
}: {
  averageHourlyCost: number;
  recoveryRate: number;
  reportTitle: string;
  companyName: string;
  firebaseEnabled: boolean;
  authReady: boolean;
  user: FirebaseUser | null;
  cloudStatus: CloudStatus;
  cloudMessage: string;
  savedReports: SavedReportSummary[];
  hasData: boolean;
  findingsCount: number;
  onAverageHourlyCostChange: (value: number) => void;
  onRecoveryRateChange: (value: number) => void;
  onReportTitleChange: (value: string) => void;
  onCompanyNameChange: (value: string) => void;
  onSave: () => void;
  onOpenImport: () => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
}) {
  const cloudBadgeLabel = !user
    ? "Sign in"
    : cloudStatus === "error"
      ? "Needs rules"
      : "Ready";
  const cloudBadgeVariant = !user
    ? "outline"
    : cloudStatus === "error"
      ? "amber"
      : "teal";

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-primary/20 bg-card/90 shadow-soft">
        <CardContent className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
          <div>
            <Badge variant="secondary">Settings</Badge>
            <h2 className="mt-2 text-2xl font-semibold tracking-normal">
              Workspace assumptions and report controls.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Tune the business model, name the report, export findings, and
              explicitly save a snapshot to Firestore when you are ready.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Findings" value={`${findingsCount}`} />
            <MiniStat label="Cloud" value={user ? "Signed in" : "Local"} />
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <Card className="bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle>Business Model</CardTitle>
            <CardDescription>
              These assumptions drive savings, payback, and exports.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <MoneyInput
              value={averageHourlyCost}
              onChange={onAverageHourlyCostChange}
            />
            <PercentInput value={recoveryRate} onChange={onRecoveryRateChange} />
            <div className="md:col-span-2">
              <Label htmlFor="settings-report-title">Report title</Label>
              <Input
                id="settings-report-title"
                className="mt-1"
                value={reportTitle}
                onChange={(event) => onReportTitleChange(event.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="settings-company-name">Company/workspace</Label>
              <Input
                id="settings-company-name"
                className="mt-1"
                value={companyName}
                onChange={(event) => onCompanyNameChange(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/90">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Cloud Reports</CardTitle>
                <CardDescription>Authenticated Firestore snapshots.</CardDescription>
              </div>
              <Badge variant={cloudBadgeVariant}>{cloudBadgeLabel}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-secondary/55 p-4 text-sm leading-6">
              <p className="font-semibold">What is saved?</p>
              <p className="mt-1 text-muted-foreground">
                Only after pressing Save: upload metadata, one analysis run,
                findings, high-priority action plans, and a report summary.
                Raw CSV files are not uploaded. Production audit logs should be
                backend-written.
              </p>
            </div>

            {!isFirebaseEnabled && (
              <p className="text-sm text-destructive">
                Firebase env values are missing.
              </p>
            )}
            {isFirebaseEnabled && !authReady && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Connecting to Firebase...
              </p>
            )}
            {cloudMessage && (
              <p
                className={cn(
                  "text-sm",
                  cloudStatus === "error" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {cloudMessage}
              </p>
            )}

            <Button
              className="w-full"
              onClick={onSave}
              disabled={!user || !hasData || cloudStatus === "saving"}
            >
              {cloudStatus === "saving" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Cloud className="h-4 w-4" aria-hidden="true" />
              )}
              Save report to Firestore
            </Button>
            {!hasData && (
              <Button className="w-full" variant="outline" onClick={onOpenImport}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Import data first
              </Button>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle>Exports</CardTitle>
            <CardDescription>Download local report artifacts.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            <Button variant="outline" onClick={onExportMarkdown} disabled={!findingsCount}>
              <FileText className="h-4 w-4" aria-hidden="true" />
              Markdown
            </Button>
            <Button variant="outline" onClick={onExportJson} disabled={!findingsCount}>
              <FileJson className="h-4 w-4" aria-hidden="true" />
              JSON
            </Button>
            <Button variant="outline" onClick={onExportCsv} disabled={!findingsCount}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              CSV
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle>Saved Reports</CardTitle>
            <CardDescription>Recent snapshots from this workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            {savedReports.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No cloud reports saved yet.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {savedReports.slice(0, 6).map((report) => (
                  <div
                    key={report.id}
                    className="rounded-lg border bg-muted/25 p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold">{report.title}</p>
                      <Badge variant="outline">{report.workflowHealthScore}/100</Badge>
                    </div>
                    <p className="mt-2 text-muted-foreground">
                      {formatCurrency(report.projectedSavings)} recoverable ·{" "}
                      {formatShortDate(report.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function TimelineItem({
  finding,
  index,
  copiedId,
  generatedPlan,
  geminiStatus,
  geminiError,
  onCopy,
  onGenerateGeminiPlan,
}: {
  finding: LeakFinding;
  index: number;
  copiedId: string | null;
  generatedPlan?: GeneratedActionPlan;
  geminiStatus: GeminiStatus;
  geminiError?: string;
  onCopy: (id: string, text: string) => void;
  onGenerateGeminiPlan: (finding: LeakFinding) => void;
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ScoreChip score={finding.fixThisFirstScore} />
              <Badge variant="outline">{finding.fingerprint}</Badge>
              <Badge variant="secondary">{finding.confidence}% confidence</Badge>
            </div>
            <h3 className="mt-3 text-lg font-semibold">{finding.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {getSuggestedOwner(finding)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-[420px] lg:justify-end">
            <ActionPill label="Savings" value={formatCurrency(finding.projectedSavings)} />
            <ActionPill label="Effort" value={`${finding.implementationDays}d`} />
            <ActionPill label="Payback" value={`${finding.paybackDays}d`} />
          </div>
        </div>

        <div className={cn("mt-4 rounded-md border p-3", accent.note)}>
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            Next move
          </p>
          <p className="mt-1 text-sm leading-6">{finding.recommendation}</p>
        </div>

        <BeforeAfterMini finding={finding} />

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Next steps
          </p>
          <ol className="grid gap-2 lg:grid-cols-3">
            {finding.implementationSteps.slice(0, 3).map((step, stepIndex) => (
              <li
                key={step}
                className="flex gap-3 rounded-md border bg-card/75 p-3 text-sm"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                  {stepIndex + 1}
                </span>
                <span className="leading-6">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <details className={cn("mt-4 rounded-md border p-3 text-sm", accent.details)}>
          <summary className="cursor-pointer font-medium">Recipe, evidence, and AI plan</summary>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Affected rows:</span>
            {finding.affectedRecords.slice(0, 5).map((recordId) => (
              <span key={recordId} className="rounded-md border bg-card/80 px-2 py-1">
                {recordId}
              </span>
            ))}
            {finding.affectedRecords.length > 5 && (
              <span className="rounded-md border bg-card/80 px-2 py-1">
                +{finding.affectedRecords.length - 5}
              </span>
            )}
          </div>
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
          <div className="mt-3 rounded-md border bg-card/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold">Gemini-generated plan</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onGenerateGeminiPlan(finding)}
                disabled={geminiStatus === "loading"}
              >
                {geminiStatus === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                )}
                {geminiStatus === "ready" ? "Regenerate" : "Generate"}
              </Button>
            </div>
            {geminiError && (
              <p className="mt-3 text-sm leading-6 text-destructive">
                {geminiError}
              </p>
            )}
            {generatedPlan && (
              <GeneratedPlanPanel
                finding={finding}
                plan={generatedPlan}
                copiedId={copiedId}
                onCopy={onCopy}
              />
            )}
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
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border bg-card/65 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{finding.simulation.currentLabel}</span>
      <span className="font-semibold tabular">{finding.simulation.currentValue}</span>
      <span className="text-muted-foreground">→</span>
      <span className="text-muted-foreground">{finding.simulation.afterLabel}</span>
      <span className="font-semibold tabular">{finding.simulation.afterValue}</span>
      <span className="hidden text-muted-foreground sm:inline">·</span>
      <span className="font-semibold tabular">
        Saves {formatCurrency(finding.simulation.savings)}
      </span>
    </div>
  );
}

function GeneratedPlanPanel({
  finding,
  plan,
  copiedId,
  onCopy,
}: {
  finding: LeakFinding;
  plan: GeneratedActionPlan;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}) {
  return (
    <div className="mt-4 space-y-3 border-t pt-3">
      <p className="text-sm leading-6 text-muted-foreground">
        {plan.executiveSummary}
      </p>
      <div className="grid gap-2">
        {plan.implementationSteps.slice(0, 3).map((step, index) => (
          <div key={step} className="flex gap-3 rounded-md border bg-muted/35 p-3 text-sm">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-secondary-foreground">
              {index + 1}
            </span>
            <span className="leading-6">{step}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton
          label="Copy AI Summary"
          copied={copiedId === `${finding.id}-ai-summary`}
          onClick={() =>
            onCopy(`${finding.id}-ai-summary`, plan.executiveSummary)
          }
        />
        <CopyButton
          label="Copy AI Jira"
          copied={copiedId === `${finding.id}-ai-jira`}
          onClick={() => onCopy(`${finding.id}-ai-jira`, plan.jiraTicket)}
        />
      </div>
    </div>
  );
}

function ImportView({
  data,
  importErrors,
  isLoadingSamples,
  onFileUpload,
  onLoadSamples,
  onTemplateDownload,
}: {
  data: WorkflowData;
  importErrors: string[];
  isLoadingSamples: boolean;
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
          <Card className="bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle>Sample Data</CardTitle>
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

async function requestGeneratedActionPlan(finding: LeakFinding) {
  const token = await firebaseAuth?.currentUser?.getIdToken();

  if (!token) {
    throw new Error("Sign in before generating a Gemini action plan.");
  }

  const response = await fetch("/api/generate-action-plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      finding: {
        title: finding.title,
        category: finding.category,
        fingerprint: finding.fingerprint,
        team: finding.team,
        sourceType: finding.sourceType,
        evidence: finding.evidence,
        evidenceDetails: finding.evidenceDetails,
        affectedRecords: finding.affectedRecords,
        adjustedMonthlyCost: finding.adjustedMonthlyCost,
        projectedSavings: finding.projectedSavings,
        confidence: finding.confidence,
        implementationEffort: finding.implementationEffort,
        paybackDays: finding.paybackDays,
        recommendation: finding.recommendation,
        implementationSteps: finding.implementationSteps,
        automationRecipe: finding.automationRecipe,
      },
    }),
  });

  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      "Gemini route is available on Vercel. Use the deployed app or run with vercel dev.",
    );
  }

  const payload = (await response.json()) as {
    plan?: GeneratedActionPlan;
    error?: string;
  };

  if (!response.ok || !payload.plan) {
    throw new Error(payload.error ?? "Gemini plan could not be generated.");
  }

  return payload.plan;
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
  status: "Good" | "Fair" | "Needs review";
  requiredFieldRate: number;
  meetingOutcomeGaps: number;
  staleRows: number;
  missingOwners: number;
  suspiciousValues: number;
  impossibleTimelines: number;
  duplicateTeamNames: number;
  issueCount: number;
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
  const leakSeverityScore = Math.min(
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
  const workflowHealthScore = Math.max(1, 100 - leakSeverityScore);
  const leakSeverityLabel = getLeakSeverityLabel(leakSeverityScore);

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
    leakSeverityScore,
    workflowHealthScore,
    leakSeverityLabel,
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
  const missingOwners =
    data.tickets.filter((ticket) => !ticket.owner.trim()).length +
    data.meetings.filter((meeting) => !meeting.organizer.trim()).length +
    data.pullRequests.filter((pr) => !pr.reviewer.trim()).length;
  const suspiciousValues =
    data.tickets.filter(
      (ticket) =>
        ticket.waitHours < 0 ||
        ticket.cycleHours < 0 ||
        ticket.blockerHours < 0 ||
        ticket.cycleHours > 720 ||
        ticket.waitHours > 720,
    ).length +
    data.meetings.filter(
      (meeting) =>
        meeting.attendees <= 0 ||
        meeting.durationMinutes <= 0 ||
        meeting.durationMinutes > 240 ||
        meeting.meetingsPerMonth > 40,
    ).length +
    data.pullRequests.filter(
      (pr) =>
        pr.reviewWaitHours < 0 ||
        pr.reworkHours < 0 ||
        pr.blockerHours < 0 ||
        pr.reviewWaitHours > 720,
    ).length;
  const impossibleTimelines =
    data.tickets.filter(
      (ticket) =>
        ticket.cycleHours < ticket.waitHours ||
        isEndBeforeStart(ticket.createdAt, ticket.completedAt),
    ).length +
    data.pullRequests.filter((pr) =>
      isEndBeforeStart(pr.createdAt, pr.mergedAt),
    ).length;
  const staleRows =
    data.tickets.filter((ticket) =>
      isStaleOpenRow(ticket.status, ticket.createdAt),
    ).length +
    data.pullRequests.filter((pr) => isStaleOpenRow(pr.status, pr.createdAt))
      .length;
  const duplicateTeamNames = countDuplicateTeamNameVariants([
    ...data.tickets.map((ticket) => ticket.team),
    ...data.meetings.map((meeting) => meeting.team),
    ...data.pullRequests.map((pr) => pr.repository),
  ]);
  const issueCount =
    meetingOutcomeGaps +
    missingOwners +
    suspiciousValues +
    impossibleTimelines +
    staleRows +
    duplicateTeamNames;
  const status =
    requiredFieldRate < 80 || issueCount >= 10
      ? "Needs review"
      : requiredFieldRate >= 90 && issueCount <= 5
        ? "Good"
        : "Fair";

  return {
    status,
    requiredFieldRate,
    meetingOutcomeGaps,
    staleRows,
    missingOwners,
    suspiciousValues,
    impossibleTimelines,
    duplicateTeamNames,
    issueCount,
  };
}

function isEndBeforeStart(start: string, end: string) {
  if (!start || !end) return false;
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return false;
  return endTime < startTime;
}

function isStaleOpenRow(status: string, createdAt: string) {
  const normalizedStatus = status.toLowerCase();
  if (
    normalizedStatus.includes("done") ||
    normalizedStatus.includes("merged") ||
    normalizedStatus.includes("closed")
  ) {
    return false;
  }

  const createdTime = Date.parse(createdAt);
  if (!Number.isFinite(createdTime)) return false;
  const ageDays = (Date.now() - createdTime) / (1000 * 60 * 60 * 24);
  return ageDays > 21;
}

function countDuplicateTeamNameVariants(values: string[]) {
  const variants = values.reduce<Record<string, Set<string>>>((groups, value) => {
    const trimmed = value.trim();
    if (!trimmed) return groups;
    const key = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
    groups[key] = groups[key] ?? new Set<string>();
    groups[key].add(trimmed);
    return groups;
  }, {});

  return Object.values(variants).filter((group) => group.size > 1).length;
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

function buildLeakReplay(finding: LeakFinding, data: WorkflowData) {
  const record = findPrimaryRecord(finding, data);
  const partialCost = finding.adjustedMonthlyCost * 0.35;
  const patternCost = finding.adjustedMonthlyCost * 0.75;

  if (record && finding.sourceType === "tickets" && "cycleHours" in record) {
    return [
      {
        time: formatTimelineDate(record.createdAt) || "Created",
        title: "Ticket opened",
        detail: `${record.id} entered ${record.team} with ${record.owner || "no owner"} assigned.`,
        cost: 0,
      },
      {
        time: addHoursLabel(record.createdAt, record.waitHours) || `${record.waitHours}h later`,
        title: `${record.waitHours}h waiting`,
        detail: `${record.ownerChanges} owner changes and ${record.blockerHours}h blocked before completion.`,
        cost: partialCost,
      },
      {
        time: formatTimelineDate(record.completedAt) || `${record.cycleHours}h cycle`,
        title: finding.fingerprint,
        detail: finding.evidence,
        cost: patternCost,
      },
      {
        time: "After fix",
        title: finding.simulation.afterLabel,
        detail: `${finding.recommendation}`,
        cost: finding.simulation.afterMonthlyCost,
      },
    ];
  }

  if (
    record &&
    finding.sourceType === "pullRequests" &&
    "reviewWaitHours" in record
  ) {
    return [
      {
        time: formatTimelineDate(record.createdAt) || "Opened",
        title: "PR opened",
        detail: `${record.id} opened in ${record.repository} and requested ${record.reviewer}.`,
        cost: 0,
      },
      {
        time:
          addHoursLabel(record.createdAt, record.reviewWaitHours) ||
          `${record.reviewWaitHours}h later`,
        title: `${record.reviewWaitHours}h review wait`,
        detail: `${record.comments} comments, ${record.reworkHours}h rework, ${record.blockerHours}h blocked.`,
        cost: partialCost,
      },
      {
        time: formatTimelineDate(record.mergedAt) || record.status,
        title: finding.fingerprint,
        detail: finding.evidence,
        cost: patternCost,
      },
      {
        time: "After fix",
        title: finding.simulation.afterLabel,
        detail: `${finding.recommendation}`,
        cost: finding.simulation.afterMonthlyCost,
      },
    ];
  }

  if (record && finding.sourceType === "meetings" && "cadence" in record) {
    const meetingHours =
      (record.attendees * record.durationMinutes * record.meetingsPerMonth) / 60;

    return [
      {
        time: record.cadence,
        title: "Meeting recurs",
        detail: `${record.title} pulls in ${record.attendees} attendees.`,
        cost: 0,
      },
      {
        time: `${record.meetingsPerMonth}/mo`,
        title: `${roundForDisplay(meetingHours)} attendee-hours`,
        detail: record.outcomeCaptured
          ? `${record.actionItems} action item${record.actionItems === 1 ? "" : "s"} captured.`
          : "No captured outcome.",
        cost: partialCost,
      },
      {
        time: "Pattern",
        title: finding.fingerprint,
        detail: finding.evidence,
        cost: patternCost,
      },
      {
        time: "After fix",
        title: finding.simulation.afterLabel,
        detail: `${finding.recommendation}`,
        cost: finding.simulation.afterMonthlyCost,
      },
    ];
  }

  const firstRecord = finding.affectedRecords[0] ?? "source row";

  return [
    {
      time: "Start",
      title: "Workflow starts",
      detail: `${firstRecord} enters ${finding.team}.`,
      cost: 0,
    },
    {
      time: "Signal",
      title: finding.simulation.currentLabel,
      detail: `${finding.simulation.currentValue} exceeds the operating threshold.`,
      cost: partialCost,
    },
    {
      time: "Pattern",
      title: finding.fingerprint,
      detail: finding.evidence,
      cost: patternCost,
    },
    {
      time: "After fix",
      title: finding.simulation.afterLabel,
      detail: `${finding.recommendation}`,
      cost: finding.simulation.afterMonthlyCost,
    },
  ];
}

function findPrimaryRecord(finding: LeakFinding, data: WorkflowData) {
  const recordId = finding.affectedRecords[0];
  if (!recordId) return undefined;

  if (finding.sourceType === "tickets") {
    return data.tickets.find((ticket) => ticket.id === recordId);
  }
  if (finding.sourceType === "meetings") {
    return data.meetings.find((meeting) => meeting.id === recordId);
  }
  return data.pullRequests.find((pr) => pr.id === recordId);
}

function formatTimelineDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function addHoursLabel(start: string, hours: number) {
  if (!start) return "";
  const date = new Date(start);
  if (!Number.isFinite(date.getTime())) return "";
  date.setHours(date.getHours() + hours);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function roundForDisplay(value: number) {
  return Number(value.toFixed(value >= 10 ? 0 : 1));
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

function formatShortDate(value?: Date) {
  if (!value) return "just now";
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getErrorMessage(error: unknown) {
  const maybeFirebaseError = error as { code?: string; message?: string };

  if (
    maybeFirebaseError.code === "permission-denied" ||
    maybeFirebaseError.message?.includes("Missing or insufficient permissions")
  ) {
    return "Firestore blocked this request. Publish the WorkLeak Firestore rules, then sign out and sign back in.";
  }

  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

function getLeakSeverityLabel(score: number) {
  if (score >= 75) return "Critical";
  if (score >= 55) return "High";
  if (score >= 30) return "Moderate";
  return "Low";
}

function getDataOriginLabel(dataOrigin: DataOrigin) {
  if (dataOrigin === "sample") return "Sample data";
  if (dataOrigin === "upload") return "Uploaded data";
  return "No data";
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

export default App;
