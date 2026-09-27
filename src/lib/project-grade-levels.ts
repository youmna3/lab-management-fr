export type ProjectProgram = "DECI" | "DEMI";

export interface GradeLevelOption {
  value: number;
  label: string;
  shortLabel: string;
  track?: string;
  level: number;
}

export const DEMI_GRADE_OPTIONS: readonly GradeLevelOption[] = [
  { value: 4, label: "Grade 4 (G4)", shortLabel: "G4", level: 4 },
  { value: 5, label: "Grade 5 (G5)", shortLabel: "G5", level: 5 },
  { value: 6, label: "Grade 6 (G6)", shortLabel: "G6", level: 6 },
];

export const DECI_GRADE_LEVEL_OPTIONS: readonly GradeLevelOption[] = [
  { value: 101, label: "Computer Fundamentals - Level 1", shortLabel: "Computer L1", track: "Computer Fundamentals", level: 1 },
  { value: 102, label: "Computer Advanced - Level 2", shortLabel: "Computer L2", track: "Computer Advanced", level: 2 },
  { value: 203, label: "Cyber Security - Level 3", shortLabel: "Cyber Security L3", track: "Cyber Security", level: 3 },
  { value: 204, label: "Cyber Security - Level 4", shortLabel: "Cyber Security L4", track: "Cyber Security", level: 4 },
  { value: 205, label: "Cyber Security - Level 5", shortLabel: "Cyber Security L5", track: "Cyber Security", level: 5 },
  { value: 303, label: "Digital Arts - Level 3", shortLabel: "Digital Arts L3", track: "Digital Arts", level: 3 },
  { value: 304, label: "Digital Arts - Level 4", shortLabel: "Digital Arts L4", track: "Digital Arts", level: 4 },
  { value: 305, label: "Digital Arts - Level 5", shortLabel: "Digital Arts L5", track: "Digital Arts", level: 5 },
  { value: 403, label: "Web Development - Level 3", shortLabel: "Web Development L3", track: "Web Development", level: 3 },
  { value: 404, label: "Web Development - Level 4", shortLabel: "Web Development L4", track: "Web Development", level: 4 },
  { value: 405, label: "Web Development - Level 5", shortLabel: "Web Development L5", track: "Web Development", level: 5 },
  { value: 503, label: "Data Science - Level 3", shortLabel: "Data Science L3", track: "Data Science", level: 3 },
  { value: 504, label: "Data Science - Level 4", shortLabel: "Data Science L4", track: "Data Science", level: 4 },
  { value: 505, label: "Data Science - Level 5", shortLabel: "Data Science L5", track: "Data Science", level: 5 },
  { value: 603, label: "Embedded Systems - Level 3", shortLabel: "Embedded Systems L3", track: "Embedded Systems", level: 3 },
  { value: 604, label: "Embedded Systems - Level 4", shortLabel: "Embedded Systems L4", track: "Embedded Systems", level: 4 },
  { value: 605, label: "Embedded Systems - Level 5", shortLabel: "Embedded Systems L5", track: "Embedded Systems", level: 5 },
];

const ALL_OPTIONS = [...DEMI_GRADE_OPTIONS, ...DECI_GRADE_LEVEL_OPTIONS];
const OPTION_BY_VALUE = new Map(ALL_OPTIONS.map((option) => [option.value, option]));

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const OPTION_BY_ALIAS = new Map<string, GradeLevelOption>();
for (const option of DECI_GRADE_LEVEL_OPTIONS) {
  const aliases = [option.label, option.shortLabel, `${option.track} level ${option.level}`];
  for (const alias of aliases) OPTION_BY_ALIAS.set(normalize(alias), option);
}
for (const option of DEMI_GRADE_OPTIONS) {
  for (const alias of [option.label, option.shortLabel, `Grade ${option.level}`]) {
    OPTION_BY_ALIAS.set(normalize(alias), option);
  }
}

export function normalizeProjectProgram(program: unknown): ProjectProgram {
  return String(program ?? "").trim().toUpperCase() === "DEMI" ? "DEMI" : "DECI";
}

export function getGradeLevelOptions(program: unknown): readonly GradeLevelOption[] {
  return normalizeProjectProgram(program) === "DEMI" ? DEMI_GRADE_OPTIONS : DECI_GRADE_LEVEL_OPTIONS;
}

export function getDefaultGradeLevel(program: unknown): number {
  return getGradeLevelOptions(program)[0].value;
}

export function parseGradeLevel(value: unknown, program?: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const directNumber = Number(raw);
  if (Number.isFinite(directNumber)) return directNumber;

  const normalized = normalize(raw);
  const exact = OPTION_BY_ALIAS.get(normalized);
  if (exact) return exact.value;

  const programType = program == null ? null : normalizeProjectProgram(program);
  const gradeMatch = normalized.match(/^(?:g|grade)\s*([0-9]+)$/);
  if (gradeMatch) return Number(gradeMatch[1]);

  const levelMatch = normalized.match(/^(?:l|level)\s*([0-9]+)$/);
  if (levelMatch && programType === "DEMI") return Number(levelMatch[1]);
  return null;
}

export function parseAcademicClassification(value: unknown, program?: unknown, trackHint?: unknown): number | null {
  const programType = normalizeProjectProgram(program);
  const parsed = parseGradeLevel(value, program);
  if (programType !== "DECI") return parsed;

  const track = String(trackHint ?? "").trim();
  if (track) {
    const normalizedTrack = normalize(track);
    const level = (() => {
      const option = parsed == null ? undefined : OPTION_BY_VALUE.get(parsed);
      if (option?.level) return option.level;
      const raw = String(value ?? "");
      const match = raw.match(/(?:level|l|grade|g)?\s*([1-5])\b/i);
      if (match) return Number(match[1]);
      return parsed && parsed >= 1 && parsed <= 5 ? parsed : null;
    })();
    if (level != null) {
      const option = DECI_GRADE_LEVEL_OPTIONS.find((candidate) => candidate.level === level && normalize(candidate.track) === normalizedTrack);
      if (option) return option.value;
    }
  }

  return parsed;
}

export function formatGradeLevel(value: unknown, program?: unknown, compact = false): string {
  const parsed = parseGradeLevel(value, program);
  const option = parsed == null ? undefined : OPTION_BY_VALUE.get(parsed);
  if (option) return compact ? option.shortLabel : option.label;

  const raw = String(value ?? "").trim();
  if (!raw) return "Unknown grade / level";
  if (/^g?\d+$/i.test(raw)) return compact ? `G${Number(raw.replace(/\D/g, ""))}` : `Grade ${Number(raw.replace(/\D/g, ""))}`;
  return raw;
}

export function getGradeLevelOption(value: unknown): GradeLevelOption | undefined {
  const parsed = parseGradeLevel(value);
  return parsed == null ? undefined : OPTION_BY_VALUE.get(parsed);
}

export function getAcademicTrack(value: unknown, program?: unknown): string | undefined {
  const parsed = parseGradeLevel(value, program);
  const option = parsed == null ? undefined : OPTION_BY_VALUE.get(parsed);
  return normalizeProjectProgram(program) === "DECI" ? option?.track : undefined;
}

export function getAcademicLevel(value: unknown, program?: unknown): string {
  const parsed = parseGradeLevel(value, program);
  const option = parsed == null ? undefined : OPTION_BY_VALUE.get(parsed);
  const level = option?.level ?? parsed;
  if (level == null) return "";
  return normalizeProjectProgram(program) === "DEMI" ? `G${level}` : `L${level}`;
}

export function getAcademicIdentityKey(value: unknown, program?: unknown): string {
  const parsed = parseGradeLevel(value, program);
  const option = parsed == null ? undefined : OPTION_BY_VALUE.get(parsed);
  if (normalizeProjectProgram(program) === "DEMI") return `G${option?.level ?? parsed ?? value}`;
  if (option?.track) return `${option.track}::L${option.level}`;
  return `Unspecified track::L${parsed ?? value}`;
}

export function mergeGradeLevelOptions(program: unknown, existingValues: Iterable<unknown>): GradeLevelOption[] {
  const configured = [...getGradeLevelOptions(program)];
  const seen = new Set(configured.map((option) => option.value));
  for (const raw of existingValues) {
    const value = parseGradeLevel(raw, program);
    if (value == null || seen.has(value)) continue;
    configured.push({ value, label: formatGradeLevel(value, program), shortLabel: formatGradeLevel(value, program, true), level: value });
    seen.add(value);
  }
  return configured;
}

export function sortGradeLevels(values: Iterable<number>): number[] {
  const order = new Map(ALL_OPTIONS.map((option, index) => [option.value, index]));
  return Array.from(new Set(values)).sort((a, b) => (order.get(a) ?? 10_000 + a) - (order.get(b) ?? 10_000 + b));
}
