import type {
  AutomationRecipe,
  DataType,
  EffortLevel,
  EvidenceDetail,
  LeakCategory,
  LeakFinding,
  LeakFingerprint,
  MeetingRecord,
  PullRequestRecord,
  Severity,
  TicketRecord,
  WorkflowData,
} from "../types";

const DEFAULT_RECOVERY_RATE = 0.62;

type DraftFinding = {
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
  grossHoursLostPerMonth: number;
  confidence: number;
  implementationEffort: EffortLevel;
  implementationDays: number;
  recommendation: string;
  steps: string[];
  currentLabel: string;
  currentValue: string;
  afterLabel: string;
  afterValue: string;
};

type CostedFinding = LeakFinding & { rawFixScore: number };

export function detectLeaks(
  data: WorkflowData,
  averageHourlyCost: number,
  recoveryRate = DEFAULT_RECOVERY_RATE,
): LeakFinding[] {
  const drafts = [
    ...detectTicketLeaks(data.tickets),
    ...detectMeetingLeaks(data.meetings),
    ...detectPullRequestLeaks(data.pullRequests),
  ];

  const sourceSignalCounts = new Map<string, number>();
  drafts.forEach((finding) => {
    finding.affectedRecords.forEach((recordId) => {
      const key = sourceKey(finding.sourceType, recordId);
      sourceSignalCounts.set(key, (sourceSignalCounts.get(key) ?? 0) + 1);
    });
  });

  const costed: CostedFinding[] = drafts.map((finding) => {
    const overlapWeight = getOverlapWeight(finding, sourceSignalCounts);
    const hoursLostPerMonth = roundOne(finding.grossHoursLostPerMonth);
    const adjustedHoursLostPerMonth = roundOne(
      finding.grossHoursLostPerMonth * overlapWeight,
    );
    const monthlyCost = hoursLostPerMonth * averageHourlyCost;
    const adjustedMonthlyCost = adjustedHoursLostPerMonth * averageHourlyCost;
    const projectedSavings = adjustedMonthlyCost * recoveryRate;
    const implementationCost =
      finding.implementationDays * 8 * averageHourlyCost;
    const paybackDays =
      projectedSavings > 0
        ? implementationCost / Math.max(projectedSavings / 30, 1)
        : 0;
    const rawFixScore =
      (projectedSavings * (finding.confidence / 100)) /
      effortPoints(finding.implementationEffort);
    const automationRecipe = buildAutomationRecipe(finding);

    return {
      id: finding.id,
      category: finding.category,
      fingerprint: finding.fingerprint,
      pattern: finding.pattern,
      sourceType: finding.sourceType,
      sourceFile: finding.sourceFile,
      affectedRecords: finding.affectedRecords,
      title: finding.title,
      team: finding.team,
      evidence: finding.evidence,
      evidenceDetails: finding.evidenceDetails,
      hoursLostPerMonth,
      adjustedHoursLostPerMonth,
      monthlyCost,
      adjustedMonthlyCost,
      projectedSavings,
      severity: getSeverity(adjustedMonthlyCost, finding.confidence),
      priority: "Medium",
      confidence: finding.confidence,
      implementationEffort: finding.implementationEffort,
      implementationDays: finding.implementationDays,
      implementationCost,
      paybackDays: Number(paybackDays.toFixed(1)),
      fixThisFirstScore: 0,
      roiScore: Math.min(
        100,
        Math.max(1, Math.round((projectedSavings / implementationCost) * 18)),
      ),
      recommendation: finding.recommendation,
      implementationSteps: finding.steps,
      automationRecipe,
      simulation: {
        currentLabel: finding.currentLabel,
        currentValue: finding.currentValue,
        afterLabel: finding.afterLabel,
        afterValue: finding.afterValue,
        currentMonthlyCost: adjustedMonthlyCost,
        afterMonthlyCost: Math.max(0, adjustedMonthlyCost - projectedSavings),
        savings: projectedSavings,
      },
      jiraTicket: "",
      executiveSummary: "",
      rawFixScore,
    };
  });

  const maxFixScore = Math.max(...costed.map((finding) => finding.rawFixScore), 1);

  return costed
    .map(({ rawFixScore, ...finding }) => {
      const fixThisFirstScore = Math.min(
        100,
        Math.max(1, Math.round((rawFixScore / maxFixScore) * 100)),
      );
      const enriched = {
        ...finding,
        fixThisFirstScore,
        priority: getPriority(fixThisFirstScore, finding.severity),
      };

      return {
        ...enriched,
        executiveSummary: buildExecutiveSummary(enriched),
        jiraTicket: buildJiraTicket(enriched),
      };
    })
    .sort((a, b) => b.fixThisFirstScore - a.fixThisFirstScore);
}

function detectTicketLeaks(tickets: TicketRecord[]) {
  const findings: DraftFinding[] = [];
  const groups = groupBy(tickets, (ticket) => normalizeText(ticket.title));

  tickets.forEach((ticket) => {
    if (ticket.cycleHours >= 72 || ticket.waitHours >= 36) {
      const hoursLost =
        Math.max(ticket.waitHours - 24, ticket.cycleHours * 0.1) *
        Math.max(ticket.repeatsPerMonth, 1) *
        0.35;

      findings.push(
        makeDraft({
          id: `ticket-wait-${ticket.id}`,
          category: "Long wait time",
          fingerprint: ticket.title.toLowerCase().includes("approval")
            ? "Approval Black Hole"
            : "Ownership Fog",
          pattern:
            "A request waits beyond the operating threshold before the next owner acts.",
          sourceType: "tickets",
          sourceFile: "tickets.csv",
          affectedRecords: [ticket.id],
          title: ticket.title,
          team: ticket.team,
          evidence: `${ticket.id} spent ${ticket.waitHours}h waiting inside a ${ticket.cycleHours}h cycle.`,
          evidenceDetails: [
            detail("Wait time", `${ticket.waitHours}h`, "> 36h"),
            detail("Cycle time", `${ticket.cycleHours}h`, "> 72h"),
            detail("Repeats per month", `${ticket.repeatsPerMonth}`),
            detail("Affected team", ticket.team),
            detail("Source", "tickets.csv"),
          ],
          grossHoursLostPerMonth: hoursLost,
          confidence: 86,
          implementationEffort: "Medium",
          implementationDays: 2,
          recommendation:
            "Set a response-time owner and add an escalation rule once a ticket waits more than one business day.",
          steps: [
            "Assign a single accountable owner for the waiting state.",
            "Add a queue alert at 24 hours with a named backup reviewer.",
            "Review this queue twice weekly until the median wait time drops.",
          ],
          currentLabel: "Current wait",
          currentValue: `${ticket.waitHours}h`,
          afterLabel: "Target wait",
          afterValue: "12h",
        }),
      );
    }

    if (ticket.ownerChanges >= 3) {
      const hoursLost =
        ticket.ownerChanges * 0.9 * Math.max(ticket.repeatsPerMonth, 1);

      findings.push(
        makeDraft({
          id: `ticket-handoff-${ticket.id}`,
          category: "Too many handoffs",
          fingerprint: "Ticket Ping-Pong",
          pattern:
            "Work bounces between owners before it reaches the resolving team.",
          sourceType: "tickets",
          sourceFile: "tickets.csv",
          affectedRecords: [ticket.id],
          title: ticket.title,
          team: ticket.team,
          evidence: `${ticket.id} changed owners ${ticket.ownerChanges} times before completion.`,
          evidenceDetails: [
            detail("Owner changes", `${ticket.ownerChanges}`, "> 3"),
            detail("Repeats per month", `${ticket.repeatsPerMonth}`),
            detail("Current owner", ticket.owner),
            detail("Affected team", ticket.team),
            detail("Source", "tickets.csv"),
          ],
          grossHoursLostPerMonth: hoursLost,
          confidence: 82,
          implementationEffort: "Medium",
          implementationDays: 2,
          recommendation:
            "Clarify intake ownership and route this request type directly to the team that resolves it most often.",
          steps: [
            "Create an intake rule based on request type and customer segment.",
            "Name a fallback owner for edge cases.",
            "Audit handoffs for two weeks and remove the highest-friction routing step.",
          ],
          currentLabel: "Current handoffs",
          currentValue: `${ticket.ownerChanges}`,
          afterLabel: "Target handoffs",
          afterValue: "1",
        }),
      );
    }

    if (ticket.blockerHours >= 12) {
      findings.push(
        makeDraft({
          id: `ticket-blocked-${ticket.id}`,
          category: "Blocked work",
          fingerprint: "Blocked Work Queue",
          pattern:
            "Work remains blocked long enough to create avoidable waiting and context switching.",
          sourceType: "tickets",
          sourceFile: "tickets.csv",
          affectedRecords: [ticket.id],
          title: ticket.title,
          team: ticket.team,
          evidence: `${ticket.id} was blocked for ${ticket.blockerHours}h.`,
          evidenceDetails: [
            detail("Blocked time", `${ticket.blockerHours}h`, "> 12h"),
            detail("Repeats per month", `${ticket.repeatsPerMonth}`),
            detail("Status", ticket.status),
            detail("Affected team", ticket.team),
            detail("Source", "tickets.csv"),
          ],
          grossHoursLostPerMonth:
            ticket.blockerHours * Math.max(ticket.repeatsPerMonth, 1) * 0.55,
          confidence: 84,
          implementationEffort: "Low",
          implementationDays: 1,
          recommendation:
            "Create a blocker reason template and a daily unblock owner for this queue.",
          steps: [
            "Add a required blocker reason field.",
            "Review blocked items at the start of each working day.",
            "Escalate dependency blockers after eight working hours.",
          ],
          currentLabel: "Current blocked time",
          currentValue: `${ticket.blockerHours}h`,
          afterLabel: "Target blocked time",
          afterValue: "6h",
        }),
      );
    }
  });

  Object.entries(groups).forEach(([normalizedTitle, repeatedTickets]) => {
    const monthlyRepeats = repeatedTickets.reduce(
      (total, ticket) => total + ticket.repeatsPerMonth,
      0,
    );

    if (repeatedTickets.length >= 2 && monthlyRepeats >= 8) {
      const representative = repeatedTickets[0];
      const duplicateHours = repeatedTickets.reduce(
        (total, ticket) =>
          total +
          Math.max(ticket.cycleHours * 0.08, 0.75) * ticket.repeatsPerMonth,
        0,
      );
      const fingerprint =
        representative.title.toLowerCase().includes("report") ||
        representative.title.toLowerCase().includes("status")
          ? "Manual Report Tax"
          : "Status Echo";

      findings.push(
        makeDraft({
          id: `ticket-repeat-${normalizedTitle}`,
          category: "Repeated manual work",
          fingerprint,
          pattern:
            "The same work pattern repeats often enough that a template or automation should own it.",
          sourceType: "tickets",
          sourceFile: "tickets.csv",
          affectedRecords: repeatedTickets.map((ticket) => ticket.id),
          title: representative.title,
          team: representative.team,
          evidence: `${repeatedTickets.length} similar ticket rows account for ${monthlyRepeats} repeats per month.`,
          evidenceDetails: [
            detail("Similar rows", `${repeatedTickets.length}`, "> 1"),
            detail("Repeats per month", `${monthlyRepeats}`, "> 8"),
            detail("Affected records", repeatedTickets.map((ticket) => ticket.id).join(", ")),
            detail("Affected team", representative.team),
            detail("Source", "tickets.csv"),
          ],
          grossHoursLostPerMonth: duplicateHours,
          confidence: 79,
          implementationEffort: "Low",
          implementationDays: 1,
          recommendation:
            "Turn this repeated request into a template or automation so the team stops rebuilding the same answer.",
          steps: [
            "Standardize the request checklist and required fields.",
            "Create a reusable response or fulfillment template.",
            "Automate the lowest-risk step and measure saved cycle time.",
          ],
          currentLabel: "Current repeat volume",
          currentValue: `${monthlyRepeats}/mo`,
          afterLabel: "Manual repeats after fix",
          afterValue: `${Math.ceil(monthlyRepeats * 0.35)}/mo`,
        }),
      );
    }
  });

  return findings;
}

function detectMeetingLeaks(meetings: MeetingRecord[]) {
  const findings: DraftFinding[] = [];
  const groups = groupBy(meetings, (meeting) =>
    normalizeText(meeting.duplicateTopic || meeting.title),
  );

  meetings.forEach((meeting) => {
    if (!meeting.outcomeCaptured || meeting.actionItems === 0) {
      const meetingHours =
        (meeting.attendees * meeting.durationMinutes * meeting.meetingsPerMonth) /
        60;

      findings.push(
        makeDraft({
          id: `meeting-outcome-${meeting.id}`,
          category: "Duplicate meetings/reports",
          fingerprint: "Meeting Gravity Well",
          pattern:
            "Recurring meetings pull people in without producing a clear decision or action trail.",
          sourceType: "meetings",
          sourceFile: "meetings.csv",
          affectedRecords: [meeting.id],
          title: meeting.title,
          team: meeting.team,
          evidence: `${meeting.cadence} meeting with ${meeting.attendees} attendees has ${
            meeting.outcomeCaptured ? "no action items" : "no captured outcome"
          }.`,
          evidenceDetails: [
            detail("Outcome captured", meeting.outcomeCaptured ? "yes" : "no", "yes"),
            detail("Action items", `${meeting.actionItems}`, "> 0"),
            detail("Monthly attendee-hours", `${roundOne(meetingHours)}h`),
            detail("Affected team", meeting.team),
            detail("Source", "meetings.csv"),
          ],
          grossHoursLostPerMonth:
            meetingHours * (meeting.outcomeCaptured ? 0.35 : 0.55),
          confidence: 77,
          implementationEffort: "Low",
          implementationDays: 1,
          recommendation:
            "Replace or shorten the meeting unless the owner records decisions and action items every time.",
          steps: [
            "Require a decision owner before the meeting starts.",
            "Move status sharing to an async update.",
            "Cancel the next occurrence if no agenda or decision is needed.",
          ],
          currentLabel: "Current meeting load",
          currentValue: `${roundOne(meetingHours)} attendee-hours/mo`,
          afterLabel: "Expected load",
          afterValue: `${roundOne(meetingHours * 0.45)} attendee-hours/mo`,
        }),
      );
    }
  });

  Object.entries(groups).forEach(([topic, repeatedMeetings]) => {
    if (repeatedMeetings.length < 2) return;

    const monthlyHours = repeatedMeetings.reduce(
      (total, meeting) =>
        total +
        (meeting.attendees * meeting.durationMinutes * meeting.meetingsPerMonth) /
          60,
      0,
    );
    const representative = repeatedMeetings[0];

    findings.push(
      makeDraft({
        id: `meeting-duplicate-${topic}`,
        category: "Duplicate meetings/reports",
        fingerprint: "Meeting Gravity Well",
        pattern:
          "Multiple recurring forums cover the same topic instead of using one decision loop.",
        sourceType: "meetings",
        sourceFile: "meetings.csv",
        affectedRecords: repeatedMeetings.map((meeting) => meeting.id),
        title: representative.duplicateTopic || representative.title,
        team: representative.team,
        evidence: `${repeatedMeetings.length} recurring meetings cover the same topic.`,
        evidenceDetails: [
          detail("Overlapping meetings", `${repeatedMeetings.length}`, "> 1"),
          detail("Monthly attendee-hours", `${roundOne(monthlyHours)}h`),
          detail("Affected records", repeatedMeetings.map((meeting) => meeting.id).join(", ")),
          detail("Affected team", representative.team),
          detail("Source", "meetings.csv"),
        ],
        grossHoursLostPerMonth: monthlyHours * 0.35,
        confidence: 81,
        implementationEffort: "Low",
        implementationDays: 1,
        recommendation:
          "Consolidate overlapping meetings into one decision forum with a shared async pre-read.",
        steps: [
          "Choose one owner for the combined meeting.",
          "Merge attendee lists and remove optional listeners.",
          "Replace duplicate status review with a shared written update.",
        ],
        currentLabel: "Current forums",
        currentValue: `${repeatedMeetings.length}`,
        afterLabel: "Target forums",
        afterValue: "1",
      }),
    );
  });

  return findings;
}

function detectPullRequestLeaks(prs: PullRequestRecord[]) {
  const findings: DraftFinding[] = [];
  const groups = groupBy(prs, (pr) => normalizeText(pr.title));

  prs.forEach((pr) => {
    if (pr.reviewWaitHours >= 24) {
      findings.push(
        makeDraft({
          id: `pr-review-${pr.id}`,
          category: "Long wait time",
          fingerprint: "PR Waiting Room",
          pattern:
            "Code sits ready for review longer than the team review threshold.",
          sourceType: "pullRequests",
          sourceFile: "pull_requests.csv",
          affectedRecords: [pr.id],
          title: pr.title,
          team: pr.repository,
          evidence: `${pr.id} waited ${pr.reviewWaitHours}h for review.`,
          evidenceDetails: [
            detail("Review wait", `${pr.reviewWaitHours}h`, "> 24h"),
            detail("Repeats per month", `${pr.repeatsPerMonth}`),
            detail("Reviewer", pr.reviewer),
            detail("Repository", pr.repository),
            detail("Source", "pull_requests.csv"),
          ],
          grossHoursLostPerMonth:
            Math.max(pr.reviewWaitHours - 16, 1.5) *
            Math.max(pr.repeatsPerMonth, 1) *
            0.45,
          confidence: 88,
          implementationEffort: "Low",
          implementationDays: 1,
          recommendation:
            "Create a reviewer rotation and auto-request backup reviewers when PRs wait over one business day.",
          steps: [
            "Define primary and backup reviewers for this repository.",
            "Add a 24-hour stale-review alert.",
            "Limit PR size or split changes when review wait repeats.",
          ],
          currentLabel: "Current review wait",
          currentValue: `${pr.reviewWaitHours}h`,
          afterLabel: "Target review wait",
          afterValue: "8h",
        }),
      );
    }

    if (pr.blockerHours >= 8) {
      findings.push(
        makeDraft({
          id: `pr-blocked-${pr.id}`,
          category: "Blocked work",
          fingerprint: "Blocked Work Queue",
          pattern:
            "Engineering work waits on dependencies that could be surfaced earlier.",
          sourceType: "pullRequests",
          sourceFile: "pull_requests.csv",
          affectedRecords: [pr.id],
          title: pr.title,
          team: pr.repository,
          evidence: `${pr.id} recorded ${pr.blockerHours}h of blocked engineering time.`,
          evidenceDetails: [
            detail("Blocked time", `${pr.blockerHours}h`, "> 8h"),
            detail("Repeats per month", `${pr.repeatsPerMonth}`),
            detail("Repository", pr.repository),
            detail("Status", pr.status),
            detail("Source", "pull_requests.csv"),
          ],
          grossHoursLostPerMonth:
            pr.blockerHours * Math.max(pr.repeatsPerMonth, 1) * 0.55,
          confidence: 83,
          implementationEffort: "Low",
          implementationDays: 1,
          recommendation:
            "Add pre-merge dependency checks and call out unresolved blockers in the PR template.",
          steps: [
            "Add a dependency checklist to the PR template.",
            "Mark blocked PRs with a dedicated label.",
            "Review the blocked label daily during standup.",
          ],
          currentLabel: "Current blocked time",
          currentValue: `${pr.blockerHours}h`,
          afterLabel: "Target blocked time",
          afterValue: "4h",
        }),
      );
    }

    if (pr.reworkHours >= 8 || pr.comments >= 18) {
      findings.push(
        makeDraft({
          id: `pr-rework-${pr.id}`,
          category: "Repeated manual work",
          fingerprint: "Rework Loop",
          pattern:
            "The same review feedback creates avoidable rework after code is already written.",
          sourceType: "pullRequests",
          sourceFile: "pull_requests.csv",
          affectedRecords: [pr.id],
          title: pr.title,
          team: pr.repository,
          evidence: `${pr.id} needed ${pr.reworkHours}h of rework and ${pr.comments} review comments.`,
          evidenceDetails: [
            detail("Rework", `${pr.reworkHours}h`, "> 8h"),
            detail("Review comments", `${pr.comments}`, "> 18"),
            detail("Repeats per month", `${pr.repeatsPerMonth}`),
            detail("Repository", pr.repository),
            detail("Source", "pull_requests.csv"),
          ],
          grossHoursLostPerMonth:
            Math.max(pr.reworkHours * 0.85, pr.comments * 0.18) *
            Math.max(pr.repeatsPerMonth, 1),
          confidence: 76,
          implementationEffort: "Medium",
          implementationDays: 2,
          recommendation:
            "Move common review comments into a checklist, lint rule, or shared implementation pattern.",
          steps: [
            "Cluster the top repeated review comments.",
            "Turn objective comments into automated checks.",
            "Document the remaining judgment calls in the team review guide.",
          ],
          currentLabel: "Current rework",
          currentValue: `${pr.reworkHours}h`,
          afterLabel: "Target rework",
          afterValue: "3h",
        }),
      );
    }
  });

  Object.entries(groups).forEach(([title, repeatedPrs]) => {
    const monthlyRepeats = repeatedPrs.reduce(
      (total, pr) => total + pr.repeatsPerMonth,
      0,
    );

    if (repeatedPrs.length >= 2 && monthlyRepeats >= 5) {
      const representative = repeatedPrs[0];
      findings.push(
        makeDraft({
          id: `pr-repeat-${title}`,
          category: "Repeated manual work",
          fingerprint: "Rework Loop",
          pattern:
            "Similar code changes repeat often enough that the team should productize the pattern.",
          sourceType: "pullRequests",
          sourceFile: "pull_requests.csv",
          affectedRecords: repeatedPrs.map((pr) => pr.id),
          title: representative.title,
          team: representative.repository,
          evidence: `${repeatedPrs.length} similar PR rows repeat ${monthlyRepeats} times per month.`,
          evidenceDetails: [
            detail("Similar PRs", `${repeatedPrs.length}`, "> 1"),
            detail("Repeats per month", `${monthlyRepeats}`, "> 5"),
            detail("Affected records", repeatedPrs.map((pr) => pr.id).join(", ")),
            detail("Repository", representative.repository),
            detail("Source", "pull_requests.csv"),
          ],
          grossHoursLostPerMonth: repeatedPrs.reduce(
            (total, pr) =>
              total + Math.max(pr.reworkHours, 1) * pr.repeatsPerMonth * 0.75,
            0,
          ),
          confidence: 74,
          implementationEffort: "Medium",
          implementationDays: 2,
          recommendation:
            "Create a shared component, migration script, or checklist for this recurring engineering change.",
          steps: [
            "Identify the repeated implementation steps.",
            "Extract the reusable code or script.",
            "Add a short checklist to the repository contribution guide.",
          ],
          currentLabel: "Current repeated PRs",
          currentValue: `${monthlyRepeats}/mo`,
          afterLabel: "Manual repeats after fix",
          afterValue: `${Math.ceil(monthlyRepeats * 0.35)}/mo`,
        }),
      );
    }
  });

  return findings;
}

function makeDraft(finding: DraftFinding): DraftFinding {
  return {
    ...finding,
    grossHoursLostPerMonth: roundOne(finding.grossHoursLostPerMonth),
  };
}

function detail(label: string, value: string, threshold?: string): EvidenceDetail {
  return { label, value, threshold };
}

function getOverlapWeight(
  finding: DraftFinding,
  sourceSignalCounts: Map<string, number>,
) {
  if (finding.affectedRecords.length === 0) return 1;

  const averageInverseOverlap =
    finding.affectedRecords.reduce((total, recordId) => {
      const count = sourceSignalCounts.get(sourceKey(finding.sourceType, recordId)) ?? 1;
      return total + 1 / count;
    }, 0) / finding.affectedRecords.length;

  return Math.max(0.28, Math.min(1, averageInverseOverlap));
}

function sourceKey(sourceType: DataType, recordId: string) {
  return `${sourceType}:${recordId}`;
}

function buildExecutiveSummary(finding: LeakFinding) {
  return `${finding.team} is losing an adjusted ${Math.round(
    finding.adjustedHoursLostPerMonth,
  )} hours per month from ${finding.fingerprint.toLowerCase()} around "${
    finding.title
  }". The first fix is expected to recover ${Math.round(
    finding.projectedSavings,
  ).toLocaleString("en-US")} dollars per month with ${finding.confidence}% confidence.`;
}

function buildJiraTicket(finding: LeakFinding) {
  return [
    `[WorkLeak] ${finding.fingerprint}: ${finding.title}`,
    "",
    `Problem: ${finding.evidence}`,
    `Adjusted monthly waste: $${Math.round(
      finding.adjustedMonthlyCost,
    ).toLocaleString("en-US")}`,
    `Projected monthly savings: $${Math.round(
      finding.projectedSavings,
    ).toLocaleString("en-US")}`,
    `Confidence: ${finding.confidence}%`,
    `Effort: ${finding.implementationEffort} (${finding.implementationDays} day${
      finding.implementationDays === 1 ? "" : "s"
    })`,
    `Payback period: ${finding.paybackDays} days`,
    "",
    `Recommendation: ${finding.recommendation}`,
    "",
    "Automation recipe:",
    `- Trigger: ${finding.automationRecipe.trigger}`,
    `- Action: ${finding.automationRecipe.action}`,
    `- Escalation: ${finding.automationRecipe.escalation}`,
    "",
    "Acceptance criteria:",
    ...finding.implementationSteps.map((step) => `- ${step}`),
  ].join("\n");
}

function buildAutomationRecipe(finding: DraftFinding): AutomationRecipe {
  const commonConditions = [
    "The workflow item matches this request pattern.",
    "The item is not marked as customer-critical exception handling.",
  ];

  const recipes: Record<LeakFingerprint, AutomationRecipe> = {
    "Approval Black Hole": {
      title: "Approval Black Hole",
      trigger: "An approval-related ticket waits more than 24 hours.",
      conditions: [
        "Customer tier is not enterprise exception.",
        "Contract value is below the manual-review threshold.",
        "Security review is already complete.",
      ],
      action:
        "Auto-route to the backup approver and attach the approval checklist.",
      escalation:
        "If no response after 8 business hours, notify the team lead.",
      expectedImpact: `Reduce ${finding.currentValue} to ${finding.afterValue}.`,
    },
    "Ticket Ping-Pong": {
      title: "Ticket Ping-Pong",
      trigger: "A ticket changes owners more than twice.",
      conditions: commonConditions,
      action:
        "Route future matching requests directly to the resolving team owner.",
      escalation:
        "Flag the request type for intake-rule review if handoffs continue.",
      expectedImpact: `Reduce ${finding.currentValue} handoffs to ${finding.afterValue}.`,
    },
    "PR Waiting Room": {
      title: "PR Waiting Room",
      trigger: "A pull request waits more than 24 hours for review.",
      conditions: [
        "The PR is not in draft.",
        "CI checks are passing or not required.",
        "The primary reviewer has not responded.",
      ],
      action:
        "Request the backup reviewer from the rotation and add a stale-review label.",
      escalation:
        "Notify the engineering lead if no review arrives after another business day.",
      expectedImpact: `Reduce review wait from ${finding.currentValue} to ${finding.afterValue}.`,
    },
    "Meeting Gravity Well": {
      title: "Meeting Gravity Well",
      trigger: "A recurring meeting has no captured outcome or overlaps another forum.",
      conditions: [
        "No decision is required from every attendee.",
        "The topic has an existing async status channel.",
      ],
      action:
        "Replace status sharing with an async update and keep only the decision segment.",
      escalation:
        "Cancel the next occurrence if no owner posts an agenda 24 hours ahead.",
      expectedImpact: `Reduce meeting load from ${finding.currentValue} to ${finding.afterValue}.`,
    },
    "Manual Report Tax": {
      title: "Manual Report Tax",
      trigger: "A recurring report or status update repeats every month.",
      conditions: [
        "The source data exists in another system.",
        "The output format is mostly stable.",
      ],
      action:
        "Create a reusable report template and automate the data refresh step.",
      escalation:
        "Review exceptions weekly until the manual copy step is removed.",
      expectedImpact: `Reduce manual repeats from ${finding.currentValue} to ${finding.afterValue}.`,
    },
    "Ownership Fog": {
      title: "Ownership Fog",
      trigger: "A request waits beyond SLA without a clear owner.",
      conditions: commonConditions,
      action:
        "Assign a named queue owner and backup owner for this workflow state.",
      escalation:
        "Escalate to the workflow owner once the SLA is missed.",
      expectedImpact: `Reduce wait from ${finding.currentValue} to ${finding.afterValue}.`,
    },
    "Rework Loop": {
      title: "Rework Loop",
      trigger: "A PR pattern repeatedly generates the same review corrections.",
      conditions: [
        "The feedback is objective enough to document or automate.",
        "The pattern has repeated at least twice this month.",
      ],
      action:
        "Move repeated comments into a checklist, lint rule, or reusable implementation path.",
      escalation:
        "Review any remaining manual comments in the next engineering retro.",
      expectedImpact: `Reduce rework from ${finding.currentValue} to ${finding.afterValue}.`,
    },
    "Status Echo": {
      title: "Status Echo",
      trigger: "The same status update is manually reposted across tools.",
      conditions: [
        "The source status exists in a system of record.",
        "The destination update does not require human judgment.",
      ],
      action:
        "Publish a single source-of-truth update and automate reposting to the secondary channel.",
      escalation:
        "Flag any manual repost that still happens after the template is live.",
      expectedImpact: `Reduce manual repeats from ${finding.currentValue} to ${finding.afterValue}.`,
    },
    "Blocked Work Queue": {
      title: "Blocked Work Queue",
      trigger: "A ticket or PR stays blocked beyond the unblock threshold.",
      conditions: [
        "The blocker reason is known.",
        "The dependency owner can be identified.",
      ],
      action:
        "Require blocker reason, dependency owner, and next review time before marking blocked.",
      escalation:
        "Notify the dependency owner after 8 business hours without movement.",
      expectedImpact: `Reduce blocked time from ${finding.currentValue} to ${finding.afterValue}.`,
    },
  };

  return recipes[finding.fingerprint];
}

function getSeverity(adjustedMonthlyCost: number, confidence: number): Severity {
  const weightedCost = adjustedMonthlyCost * (confidence / 100);
  if (weightedCost >= 8000) return "Critical";
  if (weightedCost >= 3500) return "High";
  return "Medium";
}

function getPriority(fixThisFirstScore: number, severity: Severity): Severity {
  if (fixThisFirstScore >= 82 || severity === "Critical") return "Critical";
  if (fixThisFirstScore >= 60 || severity === "High") return "High";
  return "Medium";
}

function effortPoints(effort: EffortLevel) {
  if (effort === "Low") return 1;
  if (effort === "Medium") return 2;
  return 3.5;
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

function roundOne(value: number) {
  return Number(value.toFixed(1));
}
