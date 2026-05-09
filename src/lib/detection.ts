import type {
  DataType,
  LeakCategory,
  LeakFinding,
  MeetingRecord,
  PullRequestRecord,
  Severity,
  TicketRecord,
  WorkflowData,
} from "../types";

const SAVINGS_CAPTURE_RATE = 0.62;

export function detectLeaks(
  data: WorkflowData,
  averageHourlyCost: number,
): LeakFinding[] {
  const findings: Omit<LeakFinding, "monthlyCost" | "projectedSavings" | "severity">[] = [
    ...detectTicketLeaks(data.tickets),
    ...detectMeetingLeaks(data.meetings),
    ...detectPullRequestLeaks(data.pullRequests),
  ];

  return findings
    .map((finding) => {
      const monthlyCost = finding.hoursLostPerMonth * averageHourlyCost;
      return {
        ...finding,
        monthlyCost,
        projectedSavings: monthlyCost * SAVINGS_CAPTURE_RATE,
        severity: getSeverity(monthlyCost),
      };
    })
    .sort((a, b) => b.monthlyCost - a.monthlyCost);
}

function detectTicketLeaks(tickets: TicketRecord[]) {
  const findings: Omit<LeakFinding, "monthlyCost" | "projectedSavings" | "severity">[] = [];
  const groups = groupBy(tickets, (ticket) => normalizeText(ticket.title));

  tickets.forEach((ticket) => {
    if (ticket.cycleHours >= 72 || ticket.waitHours >= 36) {
      const hoursLost = Math.max(ticket.waitHours - 18, ticket.cycleHours * 0.18);
      findings.push(
        makeFinding({
          id: `ticket-wait-${ticket.id}`,
          category: "Long wait time",
          sourceType: "tickets",
          title: ticket.title,
          team: ticket.team,
          evidence: `${ticket.id} spent ${ticket.waitHours}h waiting inside a ${ticket.cycleHours}h cycle.`,
          hoursLostPerMonth: hoursLost * Math.max(ticket.repeatsPerMonth, 1),
          confidence: 86,
          recommendation:
            "Set a response-time owner and add an escalation rule once a ticket waits more than one business day.",
          steps: [
            "Assign a single accountable owner for the waiting state.",
            "Add a queue alert at 24 hours with a named backup reviewer.",
            "Review this queue twice weekly until the median wait time drops.",
          ],
        }),
      );
    }

    if (ticket.ownerChanges >= 3) {
      const hoursLost = ticket.ownerChanges * 1.6 * Math.max(ticket.repeatsPerMonth, 1);
      findings.push(
        makeFinding({
          id: `ticket-handoff-${ticket.id}`,
          category: "Too many handoffs",
          sourceType: "tickets",
          title: ticket.title,
          team: ticket.team,
          evidence: `${ticket.id} changed owners ${ticket.ownerChanges} times before completion.`,
          hoursLostPerMonth: hoursLost,
          confidence: 82,
          recommendation:
            "Clarify intake ownership and route this request type directly to the team that resolves it most often.",
          steps: [
            "Create an intake rule based on request type and customer segment.",
            "Name a fallback owner for edge cases.",
            "Audit handoffs for two weeks and remove the highest-friction routing step.",
          ],
        }),
      );
    }

    if (ticket.blockerHours >= 12) {
      findings.push(
        makeFinding({
          id: `ticket-blocked-${ticket.id}`,
          category: "Blocked work",
          sourceType: "tickets",
          title: ticket.title,
          team: ticket.team,
          evidence: `${ticket.id} was blocked for ${ticket.blockerHours}h.`,
          hoursLostPerMonth: ticket.blockerHours * Math.max(ticket.repeatsPerMonth, 1),
          confidence: 84,
          recommendation:
            "Create a blocker reason template and a daily unblock owner for this queue.",
          steps: [
            "Add a required blocker reason field.",
            "Review blocked items at the start of each working day.",
            "Escalate dependency blockers after eight working hours.",
          ],
        }),
      );
    }
  });

  Object.entries(groups).forEach(([normalizedTitle, repeatedTickets]) => {
    const monthlyRepeats = repeatedTickets.reduce(
      (total, ticket) => total + ticket.repeatsPerMonth,
      0,
    );

    if (repeatedTickets.length >= 2 || monthlyRepeats >= 6) {
      const representative = repeatedTickets[0];
      const duplicateHours = repeatedTickets.reduce(
        (total, ticket) => total + Math.max(ticket.cycleHours * 0.16, 1) * ticket.repeatsPerMonth,
        0,
      );

      findings.push(
        makeFinding({
          id: `ticket-repeat-${normalizedTitle}`,
          category: "Repeated manual work",
          sourceType: "tickets",
          title: representative.title,
          team: representative.team,
          evidence: `${repeatedTickets.length} similar ticket rows account for ${monthlyRepeats} repeats per month.`,
          hoursLostPerMonth: duplicateHours,
          confidence: 79,
          recommendation:
            "Turn this repeated request into a template or automation so the team stops rebuilding the same answer.",
          steps: [
            "Standardize the request checklist and required fields.",
            "Create a reusable response or fulfillment template.",
            "Automate the lowest-risk step and measure saved cycle time.",
          ],
        }),
      );
    }
  });

  return findings;
}

function detectMeetingLeaks(meetings: MeetingRecord[]) {
  const findings: Omit<LeakFinding, "monthlyCost" | "projectedSavings" | "severity">[] = [];
  const groups = groupBy(meetings, (meeting) =>
    normalizeText(meeting.duplicateTopic || meeting.title),
  );

  meetings.forEach((meeting) => {
    if (!meeting.outcomeCaptured || meeting.actionItems === 0) {
      const hoursLost =
        (meeting.attendees * meeting.durationMinutes * meeting.meetingsPerMonth) / 60;

      findings.push(
        makeFinding({
          id: `meeting-outcome-${meeting.id}`,
          category: "Duplicate meetings/reports",
          sourceType: "meetings",
          title: meeting.title,
          team: meeting.team,
          evidence: `${meeting.cadence} meeting with ${meeting.attendees} attendees has ${
            meeting.outcomeCaptured ? "no action items" : "no captured outcome"
          }.`,
          hoursLostPerMonth: hoursLost,
          confidence: 77,
          recommendation:
            "Replace or shorten the meeting unless the owner records decisions and action items every time.",
          steps: [
            "Require a decision owner before the meeting starts.",
            "Move status sharing to an async update.",
            "Cancel the next occurrence if no agenda or decision is needed.",
          ],
        }),
      );
    }
  });

  Object.entries(groups).forEach(([topic, repeatedMeetings]) => {
    if (repeatedMeetings.length < 2) return;

    const monthlyHours = repeatedMeetings.reduce(
      (total, meeting) =>
        total +
        (meeting.attendees * meeting.durationMinutes * meeting.meetingsPerMonth) / 60,
      0,
    );
    const representative = repeatedMeetings[0];

    findings.push(
      makeFinding({
        id: `meeting-duplicate-${topic}`,
        category: "Duplicate meetings/reports",
        sourceType: "meetings",
        title: representative.duplicateTopic || representative.title,
        team: representative.team,
        evidence: `${repeatedMeetings.length} recurring meetings cover the same topic.`,
        hoursLostPerMonth: monthlyHours * 0.55,
        confidence: 81,
        recommendation:
          "Consolidate overlapping meetings into one decision forum with a shared async pre-read.",
        steps: [
          "Choose one owner for the combined meeting.",
          "Merge attendee lists and remove optional listeners.",
          "Replace duplicate status review with a shared written update.",
        ],
      }),
    );
  });

  return findings;
}

function detectPullRequestLeaks(prs: PullRequestRecord[]) {
  const findings: Omit<LeakFinding, "monthlyCost" | "projectedSavings" | "severity">[] = [];
  const groups = groupBy(prs, (pr) => normalizeText(pr.title));

  prs.forEach((pr) => {
    if (pr.reviewWaitHours >= 24) {
      findings.push(
        makeFinding({
          id: `pr-review-${pr.id}`,
          category: "Long wait time",
          sourceType: "pullRequests",
          title: pr.title,
          team: pr.repository,
          evidence: `${pr.id} waited ${pr.reviewWaitHours}h for review.`,
          hoursLostPerMonth:
            Math.max(pr.reviewWaitHours - 12, 2) * Math.max(pr.repeatsPerMonth, 1),
          confidence: 88,
          recommendation:
            "Create a reviewer rotation and auto-request backup reviewers when PRs wait over one business day.",
          steps: [
            "Define primary and backup reviewers for this repository.",
            "Add a 24-hour stale-review alert.",
            "Limit PR size or split changes when review wait repeats.",
          ],
        }),
      );
    }

    if (pr.blockerHours >= 8) {
      findings.push(
        makeFinding({
          id: `pr-blocked-${pr.id}`,
          category: "Blocked work",
          sourceType: "pullRequests",
          title: pr.title,
          team: pr.repository,
          evidence: `${pr.id} recorded ${pr.blockerHours}h of blocked engineering time.`,
          hoursLostPerMonth: pr.blockerHours * Math.max(pr.repeatsPerMonth, 1),
          confidence: 83,
          recommendation:
            "Add pre-merge dependency checks and call out unresolved blockers in the PR template.",
          steps: [
            "Add a dependency checklist to the PR template.",
            "Mark blocked PRs with a dedicated label.",
            "Review the blocked label daily during standup.",
          ],
        }),
      );
    }

    if (pr.reworkHours >= 8 || pr.comments >= 18) {
      findings.push(
        makeFinding({
          id: `pr-rework-${pr.id}`,
          category: "Repeated manual work",
          sourceType: "pullRequests",
          title: pr.title,
          team: pr.repository,
          evidence: `${pr.id} needed ${pr.reworkHours}h of rework and ${pr.comments} review comments.`,
          hoursLostPerMonth:
            Math.max(pr.reworkHours, pr.comments * 0.28) *
            Math.max(pr.repeatsPerMonth, 1),
          confidence: 76,
          recommendation:
            "Move common review comments into a checklist, lint rule, or shared implementation pattern.",
          steps: [
            "Cluster the top repeated review comments.",
            "Turn objective comments into automated checks.",
            "Document the remaining judgment calls in the team review guide.",
          ],
        }),
      );
    }
  });

  Object.entries(groups).forEach(([title, repeatedPrs]) => {
    const monthlyRepeats = repeatedPrs.reduce(
      (total, pr) => total + pr.repeatsPerMonth,
      0,
    );

    if (repeatedPrs.length >= 2 || monthlyRepeats >= 5) {
      const representative = repeatedPrs[0];
      findings.push(
        makeFinding({
          id: `pr-repeat-${title}`,
          category: "Repeated manual work",
          sourceType: "pullRequests",
          title: representative.title,
          team: representative.repository,
          evidence: `${repeatedPrs.length} similar PR rows repeat ${monthlyRepeats} times per month.`,
          hoursLostPerMonth: repeatedPrs.reduce(
            (total, pr) => total + Math.max(pr.reworkHours, 1.5) * pr.repeatsPerMonth,
            0,
          ),
          confidence: 74,
          recommendation:
            "Create a shared component, migration script, or checklist for this recurring engineering change.",
          steps: [
            "Identify the repeated implementation steps.",
            "Extract the reusable code or script.",
            "Add a short checklist to the repository contribution guide.",
          ],
        }),
      );
    }
  });

  return findings;
}

function makeFinding({
  id,
  category,
  sourceType,
  title,
  team,
  evidence,
  hoursLostPerMonth,
  confidence,
  recommendation,
  steps,
}: {
  id: string;
  category: LeakCategory;
  sourceType: DataType;
  title: string;
  team: string;
  evidence: string;
  hoursLostPerMonth: number;
  confidence: number;
  recommendation: string;
  steps: string[];
}): Omit<LeakFinding, "monthlyCost" | "projectedSavings" | "severity"> {
  return {
    id,
    category,
    sourceType,
    title,
    team,
    evidence,
    hoursLostPerMonth: Number(hoursLostPerMonth.toFixed(1)),
    confidence,
    recommendation,
    implementationSteps: steps,
    jiraTicket: buildJiraTicket(title, category, evidence, recommendation, steps),
    executiveSummary: buildExecutiveSummary(category, title, team, hoursLostPerMonth),
  };
}

function buildExecutiveSummary(
  category: LeakCategory,
  title: string,
  team: string,
  hoursLostPerMonth: number,
) {
  return `${team} is losing about ${Math.round(
    hoursLostPerMonth,
  )} hours per month from ${category.toLowerCase()} around "${title}". Fixing the routing, ownership, or automation path should recover a meaningful share next month.`;
}

function buildJiraTicket(
  title: string,
  category: LeakCategory,
  evidence: string,
  recommendation: string,
  steps: string[],
) {
  return [
    `[WorkLeak] Reduce ${category.toLowerCase()}: ${title}`,
    "",
    `Problem: ${evidence}`,
    `Recommendation: ${recommendation}`,
    "",
    "Acceptance criteria:",
    ...steps.map((step) => `- ${step}`),
  ].join("\n");
}

function getSeverity(monthlyCost: number): Severity {
  if (monthlyCost >= 12000) return "Critical";
  if (monthlyCost >= 5000) return "High";
  return "Medium";
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(v[0-9]+|phase|part|copy|update|fix)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = getKey(item) || "uncategorized";
    groups[key] = groups[key] ? [...groups[key], item] : [item];
    return groups;
  }, {});
}
