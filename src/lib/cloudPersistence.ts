import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { firestoreDb } from "./firebase";
import type { LeakFinding, WorkflowData } from "../types";

interface TotalsSnapshot {
  importedRows: number;
  flaggedRecordCount: number;
  healthyWorkflowCount: number;
  adjustedMonthlyCost: number;
  projectedSavings: number;
  fteRecovered: number;
  workflowHealthScore: number;
  leakSeverityLabel: string;
}

interface DataQualitySnapshot {
  status: string;
  requiredFieldRate: number;
  meetingOutcomeGaps: number;
  staleRows: number;
  missingOwners: number;
  suspiciousValues: number;
  impossibleTimelines: number;
  duplicateTeamNames: number;
  issueCount: number;
}

export interface SaveAnalysisInput {
  user: User;
  workspaceId: string;
  reportTitle: string;
  companyName: string;
  dataOrigin: string;
  data: WorkflowData;
  findings: LeakFinding[];
  totals: TotalsSnapshot;
  dataQuality: DataQualitySnapshot;
  averageHourlyCost: number;
  recoveryRate: number;
}

export interface SavedReportSummary {
  id: string;
  title: string;
  companyName: string;
  analysisRunId: string;
  adjustedMonthlyCost: number;
  projectedSavings: number;
  workflowHealthScore: number;
  leakSeverityLabel: string;
  createdAt?: Date;
}

export async function ensureUserWorkspace(user: User, companyName: string) {
  if (!firestoreDb) throw new Error("Firebase is not configured.");

  const workspaceId = `${user.uid}_default`;
  const now = serverTimestamp();

  await Promise.all([
    setDoc(
      doc(firestoreDb, "users", user.uid),
      {
        uid: user.uid,
        email: user.email ?? "",
        displayName: user.displayName ?? user.email?.split("@")[0] ?? "User",
        defaultWorkspaceId: workspaceId,
        updatedAt: now,
        lastLoginAt: now,
        createdAt: now,
      },
      { merge: true },
    ),
    setDoc(
      doc(firestoreDb, "workspaces", workspaceId),
      {
        name: companyName || "WorkLeak Workspace",
        ownerUid: user.uid,
        plan: "demo",
        settings: {
          averageHourlyCost: 95,
          recoveryRate: 0.62,
          deleteRawUploadsAfterAnalysis: true,
        },
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    ),
    setDoc(
      doc(firestoreDb, "memberships", `${workspaceId}_${user.uid}`),
      {
        workspaceId,
        uid: user.uid,
        email: user.email ?? "",
        role: "owner",
        status: "active",
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    ),
  ]);

  return workspaceId;
}

export async function saveAnalysisSnapshot(input: SaveAnalysisInput) {
  if (!firestoreDb) throw new Error("Firebase is not configured.");
  const db = firestoreDb;

  const batch = writeBatch(db);
  const analysisRunRef = doc(collection(db, "analysisRuns"));
  const uploadRef = doc(collection(db, "uploads"));
  const reportRef = doc(collection(db, "reports"));
  const auditRef = doc(collection(db, "auditLogs"));
  const now = serverTimestamp();

  batch.set(uploadRef, {
    workspaceId: input.workspaceId,
    uploadedByUid: input.user.uid,
    fileName:
      input.dataOrigin === "sample"
        ? "workleak-sample-dataset"
        : "browser-imported-csv",
    storagePath: null,
    dataType: "mixed",
    source: input.dataOrigin === "sample" ? "sample" : "csv",
    status: "processed",
    rowCount:
      input.data.tickets.length +
      input.data.meetings.length +
      input.data.pullRequests.length,
    errorCount: 0,
    createdAt: now,
    processedAt: now,
  });

  batch.set(analysisRunRef, {
    workspaceId: input.workspaceId,
    createdByUid: input.user.uid,
    uploadIds: [uploadRef.id],
    status: "completed",
    importedRows: input.totals.importedRows,
    flaggedRecordCount: input.totals.flaggedRecordCount,
    healthyWorkflowCount: input.totals.healthyWorkflowCount,
    adjustedMonthlyCost: input.totals.adjustedMonthlyCost,
    projectedSavings: input.totals.projectedSavings,
    fteRecovered: input.totals.fteRecovered,
    workflowHealthScore: input.totals.workflowHealthScore,
    leakSeverityLabel: input.totals.leakSeverityLabel,
    dataQuality: input.dataQuality,
    averageHourlyCost: input.averageHourlyCost,
    recoveryRate: input.recoveryRate,
    createdAt: now,
    completedAt: now,
  });

  input.findings.slice(0, 50).forEach((finding) => {
    const findingRef = doc(collection(db, "findings"));
    batch.set(findingRef, {
      ...cleanForFirestore(finding),
      workspaceId: input.workspaceId,
      analysisRunId: analysisRunRef.id,
      createdAt: now,
    });

    if (finding.fixThisFirstScore >= 80) {
      const actionPlanRef = doc(collection(db, "actionPlans"));
      batch.set(actionPlanRef, {
        workspaceId: input.workspaceId,
        analysisRunId: analysisRunRef.id,
        findingId: findingRef.id,
        source: "template",
        executiveSummary: finding.executiveSummary,
        recommendation: finding.recommendation,
        implementationSteps: finding.implementationSteps,
        jiraTicket: finding.jiraTicket,
        automationRecipe: finding.automationRecipe,
        createdByUid: input.user.uid,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  batch.set(reportRef, {
    workspaceId: input.workspaceId,
    analysisRunId: analysisRunRef.id,
    createdByUid: input.user.uid,
    title: input.reportTitle || "WorkLeak Action Plan",
    companyName: input.companyName || "WorkLeak Workspace",
    format: "saved-report",
    storagePath: null,
    contentPreview: `${input.totals.importedRows} records scanned. ${input.totals.leakSeverityLabel} leak severity. ${Math.round(input.totals.projectedSavings).toLocaleString("en-US")} projected savings.`,
    adjustedMonthlyCost: input.totals.adjustedMonthlyCost,
    projectedSavings: input.totals.projectedSavings,
    workflowHealthScore: input.totals.workflowHealthScore,
    leakSeverityLabel: input.totals.leakSeverityLabel,
    createdAt: now,
  });

  batch.set(auditRef, {
    workspaceId: input.workspaceId,
    actorUid: input.user.uid,
    actorEmail: input.user.email ?? "",
    action: "analysis.completed",
    targetType: "analysisRun",
    targetId: analysisRunRef.id,
    metadata: {
      reportId: reportRef.id,
      uploadId: uploadRef.id,
      findings: input.findings.length,
    },
    createdAt: now,
  });

  await batch.commit();

  return {
    analysisRunId: analysisRunRef.id,
    reportId: reportRef.id,
  };
}

export async function fetchSavedReports(workspaceId: string) {
  if (!firestoreDb) throw new Error("Firebase is not configured.");

  const snapshot = await getDocs(
    query(
      collection(firestoreDb, "reports"),
      where("workspaceId", "==", workspaceId),
      limit(12),
    ),
  );

  return snapshot.docs
    .map((reportDoc) => {
      const data = reportDoc.data() as {
        title?: string;
        companyName?: string;
        analysisRunId?: string;
        adjustedMonthlyCost?: number;
        projectedSavings?: number;
        workflowHealthScore?: number;
        leakSeverityLabel?: string;
        createdAt?: Timestamp;
      };

      return {
        id: reportDoc.id,
        title: data.title ?? "Saved WorkLeak Report",
        companyName: data.companyName ?? "Workspace",
        analysisRunId: data.analysisRunId ?? "",
        adjustedMonthlyCost: data.adjustedMonthlyCost ?? 0,
        projectedSavings: data.projectedSavings ?? 0,
        workflowHealthScore: data.workflowHealthScore ?? 0,
        leakSeverityLabel: data.leakSeverityLabel ?? "Unknown",
        createdAt: data.createdAt?.toDate(),
      };
    })
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

function cleanForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
