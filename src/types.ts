export type DataType = "tickets" | "meetings" | "pullRequests";

export type LeakCategory =
  | "Long wait time"
  | "Too many handoffs"
  | "Repeated manual work"
  | "Blocked work"
  | "Duplicate meetings/reports";

export type Severity = "Critical" | "High" | "Medium";

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

export interface LeakFinding {
  id: string;
  category: LeakCategory;
  sourceType: DataType;
  title: string;
  team: string;
  evidence: string;
  hoursLostPerMonth: number;
  monthlyCost: number;
  projectedSavings: number;
  severity: Severity;
  confidence: number;
  recommendation: string;
  implementationSteps: string[];
  jiraTicket: string;
  executiveSummary: string;
}

export interface CsvParseResult<T> {
  rows: T[];
  errors: string[];
}
