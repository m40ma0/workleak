interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

interface GeminiPart {
  text?: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
}

interface ActionPlanRequestBody {
  finding?: {
    title?: string;
    category?: string;
    fingerprint?: string;
    team?: string;
    sourceType?: string;
    evidence?: string;
    evidenceDetails?: Array<{
      label: string;
      value: string;
      threshold?: string;
    }>;
    affectedRecords?: string[];
    adjustedMonthlyCost?: number;
    projectedSavings?: number;
    confidence?: number;
    implementationEffort?: string;
    paybackDays?: number;
    recommendation?: string;
    implementationSteps?: string[];
    automationRecipe?: {
      trigger: string;
      conditions: string[];
      action: string;
      escalation: string;
      expectedImpact: string;
    };
  };
}

declare const process: {
  env: Record<string, string | undefined>;
};

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.status(405).json({ error: "Use POST." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    response.status(503).json({
      error:
        "GEMINI_API_KEY is not configured. The template action plan is still available.",
    });
    return;
  }

  const body =
    typeof request.body === "string"
      ? (JSON.parse(request.body) as ActionPlanRequestBody)
      : (request.body as ActionPlanRequestBody);

  if (!body?.finding?.title) {
    response.status(400).json({ error: "Missing finding payload." });
    return;
  }

  try {
    const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: buildPrompt(body.finding),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.35,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!geminiResponse.ok) {
      response.status(502).json({
        error: `Gemini returned ${geminiResponse.status}. Template plan remains available.`,
      });
      return;
    }

    const geminiJson = (await geminiResponse.json()) as GeminiResponse;
    const text =
      geminiJson.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("\n")
        .trim() ?? "";

    const plan = parsePlan(text);
    response.status(200).json({ source: "gemini", plan });
  } catch {
    response.status(500).json({
      error: "Gemini plan could not be generated. Template plan remains available.",
    });
  }
}

function buildPrompt(finding: NonNullable<ActionPlanRequestBody["finding"]>) {
  return [
    "You are generating an operational remediation plan for WorkLeak.",
    "Return strict JSON only. Do not use markdown.",
    "Keep it concise, credible, and useful for an internal ops or engineering team.",
    "",
    "Required JSON shape:",
    JSON.stringify(
      {
        executiveSummary: "one paragraph for leadership",
        recommendation: "one practical recommendation",
        implementationSteps: ["step 1", "step 2", "step 3"],
        jiraTicket: "Jira-ready ticket text",
        automationRecipe: {
          trigger: "workflow trigger",
          conditions: ["condition 1", "condition 2"],
          action: "automation action",
          escalation: "escalation rule",
          expectedImpact: "expected measurable impact",
        },
      },
      null,
      2,
    ),
    "",
    "Finding:",
    JSON.stringify(finding, null, 2),
  ].join("\n");
}

function parsePlan(text: string) {
  const parsed = JSON.parse(stripCodeFence(text)) as {
    executiveSummary?: string;
    recommendation?: string;
    implementationSteps?: string[];
    jiraTicket?: string;
    automationRecipe?: {
      trigger?: string;
      conditions?: string[];
      action?: string;
      escalation?: string;
      expectedImpact?: string;
    };
  };

  return {
    executiveSummary:
      parsed.executiveSummary ?? "No executive summary returned.",
    recommendation: parsed.recommendation ?? "No recommendation returned.",
    implementationSteps: Array.isArray(parsed.implementationSteps)
      ? parsed.implementationSteps.slice(0, 5)
      : [],
    jiraTicket: parsed.jiraTicket ?? "No Jira ticket returned.",
    automationRecipe: {
      trigger: parsed.automationRecipe?.trigger ?? "No trigger returned.",
      conditions: Array.isArray(parsed.automationRecipe?.conditions)
        ? parsed.automationRecipe.conditions
        : [],
      action: parsed.automationRecipe?.action ?? "No action returned.",
      escalation:
        parsed.automationRecipe?.escalation ?? "No escalation returned.",
      expectedImpact:
        parsed.automationRecipe?.expectedImpact ??
        "No expected impact returned.",
    },
  };
}

function stripCodeFence(text: string) {
  return text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}
