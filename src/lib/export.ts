import type { LeakFinding, WorkflowData } from "../types";
import { formatCurrency, formatHours } from "./utils";

export function buildMarkdownActionPlan(
  findings: LeakFinding[],
  data: WorkflowData,
  averageHourlyCost: number,
) {
  const totalCost = findings.reduce((total, leak) => total + leak.monthlyCost, 0);
  const totalSavings = findings.reduce(
    (total, leak) => total + leak.projectedSavings,
    0,
  );

  return [
    "# WorkLeak Action Plan",
    "",
    `Average hourly cost: ${formatCurrency(averageHourlyCost)}`,
    `Imported rows: ${data.tickets.length} tickets, ${data.meetings.length} meetings, ${data.pullRequests.length} pull requests`,
    `Estimated monthly waste: ${formatCurrency(totalCost)}`,
    `Projected recoverable savings: ${formatCurrency(totalSavings)}`,
    "",
    "## Top Savings Opportunities",
    "",
    ...findings.slice(0, 5).flatMap((leak, index) => [
      `### ${index + 1}. ${leak.title}`,
      "",
      `- Category: ${leak.category}`,
      `- Area: ${leak.team}`,
      `- Evidence: ${leak.evidence}`,
      `- Hours lost per month: ${formatHours(leak.hoursLostPerMonth)}`,
      `- Monthly cost: ${formatCurrency(leak.monthlyCost)}`,
      `- Projected savings: ${formatCurrency(leak.projectedSavings)}`,
      `- Recommendation: ${leak.recommendation}`,
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
  ].join("\n");
}

export function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
