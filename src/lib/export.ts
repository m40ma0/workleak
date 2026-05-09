import type { DataType, LeakFinding, WorkflowData } from "../types";
import { formatCurrency, formatHours } from "./utils";

export interface ExportOptions {
  reportTitle: string;
  companyName: string;
  averageHourlyCost: number;
  recoveryRate: number;
}

export function buildMarkdownActionPlan(
  findings: LeakFinding[],
  data: WorkflowData,
  options: ExportOptions,
) {
  const totals = getExportTotals(findings);
  const reportName = options.reportTitle || "WorkLeak Action Plan";
  const companyLine = options.companyName
    ? `Company/workspace: ${options.companyName}`
    : "Company/workspace: Demo workspace";

  return [
    `# ${reportName}`,
    "",
    companyLine,
    `Average hourly cost: ${formatCurrency(options.averageHourlyCost)}`,
    `Recovery assumption: ${Math.round(options.recoveryRate * 100)}%`,
    `Imported rows: ${data.tickets.length} tickets, ${data.meetings.length} meetings, ${data.pullRequests.length} pull requests`,
    `Gross detected waste: ${formatCurrency(totals.grossCost)}`,
    `Adjusted estimated waste: ${formatCurrency(totals.adjustedCost)}`,
    `Projected recoverable savings: ${formatCurrency(totals.projectedSavings)}`,
    "",
    "> Adjusted waste deduplicates overlapping leak signals from the same workflow item.",
    "",
    "## Monday Morning Plan",
    "",
    ...findings.slice(0, 3).flatMap((leak, index) => [
      `${index + 1}. ${leak.recommendation}`,
      `   Owner: ${leak.team}`,
      `   Effort: ${leak.implementationEffort} (${leak.implementationDays} day${
        leak.implementationDays === 1 ? "" : "s"
      })`,
      `   Expected savings: ${formatCurrency(leak.projectedSavings)}/month`,
      "",
    ]),
    "## Top Fix This First Opportunities",
    "",
    ...findings.slice(0, 6).flatMap((leak, index) => [
      `### ${index + 1}. ${leak.fingerprint}: ${leak.title}`,
      "",
      `- Fix This First Score: ${leak.fixThisFirstScore}/100`,
      `- Category: ${leak.category}`,
      `- Area: ${leak.team}`,
      `- Confidence: ${leak.confidence}%`,
      `- Effort: ${leak.implementationEffort}`,
      `- Payback period: ${leak.paybackDays} days`,
      `- ROI score: ${leak.roiScore}/100`,
      `- Evidence: ${leak.evidence}`,
      `- Gross hours lost per month: ${formatHours(leak.hoursLostPerMonth)}`,
      `- Adjusted hours lost per month: ${formatHours(
        leak.adjustedHoursLostPerMonth,
      )}`,
      `- Gross detected cost: ${formatCurrency(leak.monthlyCost)}`,
      `- Adjusted cost: ${formatCurrency(leak.adjustedMonthlyCost)}`,
      `- Projected savings: ${formatCurrency(leak.projectedSavings)}`,
      `- Recommendation: ${leak.recommendation}`,
      "",
      "Why this was flagged:",
      ...leak.evidenceDetails.map((item) =>
        item.threshold
          ? `- ${item.label}: ${item.value} (threshold: ${item.threshold})`
          : `- ${item.label}: ${item.value}`,
      ),
      "",
      "Automation recipe:",
      `- Trigger: ${leak.automationRecipe.trigger}`,
      ...leak.automationRecipe.conditions.map((condition) => `- Condition: ${condition}`),
      `- Action: ${leak.automationRecipe.action}`,
      `- Escalation: ${leak.automationRecipe.escalation}`,
      `- Expected impact: ${leak.automationRecipe.expectedImpact}`,
      "",
      "Implementation steps:",
      ...leak.implementationSteps.map((step) => `- ${step}`),
      "",
      "Jira ticket text:",
      "```",
      leak.jiraTicket,
      "```",
      "",
    ]),
    "## Methodology",
    "",
    "WorkLeak estimates waste using wait time above threshold, repeat frequency, handoff count, blocker hours, attendee-hours, review delay, rework, confidence, and average hourly cost.",
    "",
    "Monthly Waste = Leak Hours x Repeat Frequency x Average Hourly Cost",
    "",
    "Adjusted waste deduplicates overlapping signals from the same ticket, meeting, or pull request so one painful workflow does not inflate the total by triggering multiple rules.",
  ].join("\n");
}

export function buildJsonExport(
  findings: LeakFinding[],
  data: WorkflowData,
  options: ExportOptions,
) {
  return JSON.stringify(
    {
      reportTitle: options.reportTitle,
      companyName: options.companyName,
      averageHourlyCost: options.averageHourlyCost,
      recoveryRate: options.recoveryRate,
      importedRows: {
        tickets: data.tickets.length,
        meetings: data.meetings.length,
        pullRequests: data.pullRequests.length,
      },
      totals: getExportTotals(findings),
      findings,
    },
    null,
    2,
  );
}

export function buildFindingsCsv(findings: LeakFinding[]) {
  const headers = [
    "rank",
    "fingerprint",
    "title",
    "team",
    "category",
    "confidence",
    "fixThisFirstScore",
    "effort",
    "paybackDays",
    "grossMonthlyCost",
    "adjustedMonthlyCost",
    "projectedSavings",
    "recommendation",
  ];

  const rows = findings.map((finding, index) => [
    String(index + 1),
    finding.fingerprint,
    finding.title,
    finding.team,
    finding.category,
    `${finding.confidence}%`,
    String(finding.fixThisFirstScore),
    finding.implementationEffort,
    String(finding.paybackDays),
    String(Math.round(finding.monthlyCost)),
    String(Math.round(finding.adjustedMonthlyCost)),
    String(Math.round(finding.projectedSavings)),
    finding.recommendation,
  ]);

  return [headers, ...rows].map(toCsvRow).join("\n");
}

export function buildCsvTemplate(type: DataType) {
  const templates: Record<DataType, string[]> = {
    tickets: [
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
    ],
    meetings: [
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
    ],
    pullRequests: [
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
    ],
  };

  return `${templates[type].join(",")}\n`;
}

export function downloadMarkdown(filename: string, content: string) {
  downloadText(filename, content, "text/markdown;charset=utf-8");
}

export function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getExportTotals(findings: LeakFinding[]) {
  return {
    grossCost: findings.reduce((total, leak) => total + leak.monthlyCost, 0),
    adjustedCost: findings.reduce(
      (total, leak) => total + leak.adjustedMonthlyCost,
      0,
    ),
    projectedSavings: findings.reduce(
      (total, leak) => total + leak.projectedSavings,
      0,
    ),
  };
}

function toCsvRow(row: string[]) {
  return row
    .map((cell) => {
      const escaped = cell.replace(/"/g, '""');
      return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
    })
    .join(",");
}
