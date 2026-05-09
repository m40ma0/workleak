import type {
  CsvParseResult,
  DataType,
  MeetingRecord,
  PullRequestRecord,
  TicketRecord,
} from "../types";

type RawRow = Record<string, string>;

const dataTypeLabel: Record<DataType, string> = {
  tickets: "tickets",
  meetings: "meetings",
  pullRequests: "pull requests",
};

export function parseCsvForType(
  csv: string,
  type: DataType,
): CsvParseResult<TicketRecord | MeetingRecord | PullRequestRecord> {
  const rawRows = parseCsv(csv);

  if (rawRows.length === 0) {
    return { rows: [], errors: [`No ${dataTypeLabel[type]} rows found.`] };
  }

  const errors: string[] = [];
  const rows = rawRows.map((row, index) => {
    try {
      if (type === "tickets") return toTicket(row);
      if (type === "meetings") return toMeeting(row);
      return toPullRequest(row);
    } catch (error) {
      errors.push(
        `Row ${index + 2}: ${
          error instanceof Error ? error.message : "Could not parse row"
        }`,
      );
      return null;
    }
  });

  return {
    rows: rows.filter((row): row is TicketRecord | MeetingRecord | PullRequestRecord => Boolean(row)),
    errors,
  };
}

export function parseCsv(csv: string): RawRow[] {
  const rows = parseCsvRows(csv.trim());
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.trim());

  return rows.slice(1).flatMap((values) => {
    if (values.every((value) => value.trim() === "")) return [];
    return [
      headers.reduce<RawRow>((row, header, index) => {
        row[header] = values[index]?.trim() ?? "";
        return row;
      }, {}),
    ];
  });
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      rows.push(row);
      current = "";
      row = [];
    } else {
      current += char;
    }
  }

  row.push(current);
  rows.push(row);

  return rows;
}

function requireValue(row: RawRow, key: string) {
  const value = row[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function toNumber(row: RawRow, key: string) {
  const value = Number(row[key]);
  if (!Number.isFinite(value)) throw new Error(`Invalid number for ${key}`);
  return value;
}

function toBoolean(row: RawRow, key: string) {
  const value = row[key]?.toLowerCase();
  if (["true", "yes", "1"].includes(value)) return true;
  if (["false", "no", "0"].includes(value)) return false;
  throw new Error(`Invalid boolean for ${key}`);
}

function toTicket(row: RawRow): TicketRecord {
  return {
    id: requireValue(row, "id"),
    title: requireValue(row, "title"),
    description: row.description ?? "",
    team: requireValue(row, "team"),
    owner: requireValue(row, "owner"),
    status: row.status ?? "Unknown",
    createdAt: row.createdAt ?? "",
    completedAt: row.completedAt ?? "",
    waitHours: toNumber(row, "waitHours"),
    cycleHours: toNumber(row, "cycleHours"),
    ownerChanges: toNumber(row, "ownerChanges"),
    blockerHours: toNumber(row, "blockerHours"),
    repeatsPerMonth: toNumber(row, "repeatsPerMonth"),
  };
}

function toMeeting(row: RawRow): MeetingRecord {
  return {
    id: requireValue(row, "id"),
    title: requireValue(row, "title"),
    team: requireValue(row, "team"),
    organizer: requireValue(row, "organizer"),
    cadence: row.cadence ?? "ad hoc",
    attendees: toNumber(row, "attendees"),
    durationMinutes: toNumber(row, "durationMinutes"),
    meetingsPerMonth: toNumber(row, "meetingsPerMonth"),
    outcomeCaptured: toBoolean(row, "outcomeCaptured"),
    actionItems: toNumber(row, "actionItems"),
    duplicateTopic: row.duplicateTopic ?? "",
  };
}

function toPullRequest(row: RawRow): PullRequestRecord {
  return {
    id: requireValue(row, "id"),
    title: requireValue(row, "title"),
    repository: requireValue(row, "repository"),
    author: requireValue(row, "author"),
    reviewer: requireValue(row, "reviewer"),
    status: row.status ?? "Unknown",
    createdAt: row.createdAt ?? "",
    mergedAt: row.mergedAt ?? "",
    reviewWaitHours: toNumber(row, "reviewWaitHours"),
    comments: toNumber(row, "comments"),
    reworkHours: toNumber(row, "reworkHours"),
    blockerHours: toNumber(row, "blockerHours"),
    repeatsPerMonth: toNumber(row, "repeatsPerMonth"),
  };
}
