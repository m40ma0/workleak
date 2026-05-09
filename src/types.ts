export type DataType = "tickets" | "meetings" | "pullRequests";

export type LeakCategory =
  | "Long wait time"
  | "Too many handoffs"
  | "Repeated manual work"
  | "Blocked work"
  | "Duplicate meetings/reports";

export type Severity = "Critical" | "High" | "Medium";

export type EffortLevel = "Low" | "Medium" | "High";

export type LeakFingerprint =
  | "Approval Black Hole"
  | "Ticket Ping-Pong"
  | "PR Waiting Room"
  | "Meeting Gravity Well"
  | "Manual Report Tax"
  | "Ownership Fog"
  | "Rework Loop"
  | "Status Echo"
  | "Blocked Work Queue";

export interface TicketRecord {
  id: string;
  title: string;
  description: string;
  team: string;
  owner: string;
  status: string;
  createdAt: string;
  completedAt: string;
  waitHours: number;
  cycleHours: number;
  ownerChanges: number;
  blockerHours: number;
  repeatsPerMonth: number;
}

export interface MeetingRecord {
  id: string;
  title: string;
  team: string;
  organizer: string;
  cadence: string;
  attendees: number;
  durationMinutes: number;
  meetingsPerMonth: number;
  outcomeCaptured: boolean;
  actionItems: number;
  duplicateTopic: string;
}

export interface PullRequestRecord {
  id: string;
  title: string;
  repository: string;
  author: string;
  reviewer: string;
  status: string;
  createdAt: string;
  mergedAt: string;
  reviewWaitHours: number;
  comments: number;
  reworkHours: number;
  blockerHours: number;
  repeatsPerMonth: number;
}

export interface WorkflowData {
  tickets: TicketRecord[];
  meetings: MeetingRecord[];
  pullRequests: PullRequestRecord[];
}

export interface EvidenceDetail {
  label: string;
  value: string;
  threshold?: string;
}

export interface AutomationRecipe {
  title: string;
  trigger: string;
  conditions: string[];
  action: string;
  escalation: string;
  expectedImpact: string;
}

export interface LeakSimulation {
  currentLabel: string;
  currentValue: string;
  afterLabel: string;
  afterValue: string;
  currentMonthlyCost: number;
  afterMonthlyCost: number;
  savings: number;
}

export interface LeakFinding {
  id: string;
  category: LeakCategory;
  fingerprint: LeakFingerprint;
  pattern: string;
  sourceType: DataType;
  sourceFile: string;
  affectedRecords: string[];
  title: string;
  team: string;
  evidence: string;
  evidenceDetails: EvidenceDetail[];
  hoursLostPerMonth: number;
  adjustedHoursLostPerMonth: number;
  monthlyCost: number;
  adjustedMonthlyCost: number;
  projectedSavings: number;
  severity: Severity;
  priority: Severity;
  confidence: number;
  implementationEffort: EffortLevel;
  implementationDays: number;
  implementationCost: number;
  paybackDays: number;
  fixThisFirstScore: number;
  roiScore: number;
  recommendation: string;
  implementationSteps: string[];
  automationRecipe: AutomationRecipe;
  simulation: LeakSimulation;
  jiraTicket: string;
  executiveSummary: string;
}

export interface CsvParseResult<T> {
  rows: T[];
  errors: string[];
}
