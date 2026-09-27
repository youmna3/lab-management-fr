import { strict as assert } from "node:assert";
import { calculateReplacementAvailability } from "../../allocation-lab-needs.js";
import { cleanArabicString, normalizeArabic } from "../../arabic.js";

console.log("=== RUNNING QUALITY, DISTANCE & REPLACEMENT VERIFICATION SUITE ===\n");

// -------------------------------------------------------------
// Test 1: Area Normalization & Arabic Coordinate Lookup
// -------------------------------------------------------------
console.log("--- Test 1: Area Normalization & Arabic Coordinates ---");

function normalizeAreaForComparison(area?: string | null): string {
  if (!area) return "";
  const cleaned = cleanArabicString(area)
    .trim()
    .replace(/^(مدينة|مركز|حي|قسم|منطقة|محافظة)\s+/i, "");
  return normalizeArabic(cleaned)
    .toLowerCase()
    .replace(/^(مدينه|مدينة|مركز|حي|قسم|منطقه|منطقة|محافظه|محافظة)/, "")
    .trim();
}

const AREA_COORDS: Record<string, { lat: number; lng: number }> = {
  "nasr city": { lat: 30.0561, lng: 31.3301 },
  "مدينة نصر": { lat: 30.0561, lng: 31.3301 },
  heliopolis: { lat: 30.0911, lng: 31.3236 },
  "مصر الجديدة": { lat: 30.0911, lng: 31.3236 },
  maadi: { lat: 29.9602, lng: 31.2569 },
  "المعادي": { lat: 29.9602, lng: 31.2569 },
  dokki: { lat: 30.0384, lng: 31.2118 },
  "الدقي": { lat: 30.0384, lng: 31.2118 },
  tanta: { lat: 30.7865, lng: 31.0004 },
  "طنطا": { lat: 30.7865, lng: 31.0004 },
  mansoura: { lat: 31.0409, lng: 31.3785 },
  "المنصورة": { lat: 31.0409, lng: 31.3785 },
};

function getCoords(
  areaName?: string | null,
  lab?: { lat?: number | null; lng?: number | null } | null,
): { lat: number; lng: number } | null {
  if (lab?.lat && lab?.lng) return { lat: lab.lat, lng: lab.lng };
  if (!areaName) return null;
  const rawLower = areaName.toLowerCase().trim();
  const normalized = normalizeAreaForComparison(areaName);
  
  for (const [k, coords] of Object.entries(AREA_COORDS)) {
    const kRaw = k.toLowerCase().trim();
    const kNorm = normalizeAreaForComparison(k);
    if (
      rawLower === kRaw ||
      (normalized && kNorm && normalized === kNorm) ||
      (normalized.length > 2 && kNorm.length > 2 && (normalized.includes(kNorm) || kNorm.includes(normalized))) ||
      (rawLower.length > 2 && (rawLower.includes(kRaw) || kRaw.includes(rawLower)))
    ) {
      return coords;
    }
  }
  return null;
}

// Check same area normalization
assert.equal(
  normalizeAreaForComparison("مدينة نصر"),
  normalizeAreaForComparison("نصر"),
  "مدينة prefix stripped for comparison",
);
assert.equal(
  normalizeAreaForComparison("المعادي"),
  normalizeAreaForComparison("معادي"),
  "ال prefix stripped for comparison",
);

// Check coordinate lookup for Arabic and English names
const nasrCoords = getCoords("مدينة نصر");
assert.ok(nasrCoords, "Coords found for مدينة نصر");
assert.equal(nasrCoords?.lat, 30.0561);

const maadiCoords = getCoords("المعادي");
assert.ok(maadiCoords, "Coords found for المعادي");
assert.equal(maadiCoords?.lat, 29.9602);

const dokkiCoords = getCoords("الدقي");
assert.ok(dokkiCoords, "Coords found for الدقي");
assert.equal(dokkiCoords?.lat, 30.0384);

console.log("✓ Test 1 Passed: Arabic area coordinates & normalization work accurately.\n");

// -------------------------------------------------------------
// Test 2: Neutral Baseline Quality Ranking Rule
// -------------------------------------------------------------
console.log("--- Test 2: Neutral Baseline Quality Ranking Rule ---");

const candidates = [
  { id: "lab_poor", name: "Poor Lab", qualityScore: 20, session_price: 100, capacitySufficient: true, status: "available", distanceKm: 5 },
  { id: "lab_high", name: "High Lab", qualityScore: 90, session_price: 100, capacitySufficient: true, status: "available", distanceKm: 5 },
  { id: "lab_unassessed", name: "Unassessed Lab", qualityScore: null, session_price: 100, capacitySufficient: true, status: "available", distanceKm: 5 },
  { id: "lab_medium_high", name: "Medium High Lab", qualityScore: 70, session_price: 100, capacitySufficient: true, status: "available", distanceKm: 5 },
  { id: "lab_very_poor", name: "Very Poor Lab", qualityScore: 10, session_price: 100, capacitySufficient: true, status: "available", distanceKm: 5 },
];

const sorted = [...candidates].sort((a, b) => {
  const effectiveQualityA = a.qualityScore !== null && a.qualityScore !== undefined ? Number(a.qualityScore) : 50;
  const effectiveQualityB = b.qualityScore !== null && b.qualityScore !== undefined ? Number(b.qualityScore) : 50;
  return (effectiveQualityB - effectiveQualityA);
});

const sortedIds = sorted.map((c) => c.id);
console.log("Ranking order:", sorted.map((c) => `${c.name} (${c.qualityScore ?? "Not Assessed -> 50"})`).join(" > "));

assert.deepEqual(
  sortedIds,
  ["lab_high", "lab_medium_high", "lab_unassessed", "lab_poor", "lab_very_poor"],
  "Verified high quality ranks first (90 > 70), unassessed sits in middle (50), verified poor ranks last (20 > 10)",
);

console.log("✓ Test 2 Passed: Neutral baseline (50/100) correctly ranks verified high > unassessed > poor.\n");

// -------------------------------------------------------------
// Test 3: Schedule Availability Fallback (Eliminating 0/0)
// -------------------------------------------------------------
console.log("--- Test 3: Replacement Schedule Availability Fallback ---");

// Case A: Assignment sessions exist
const existingSessions = [
  { date: "2026-07-01", time: "10:00 - 12:00" },
  { date: "2026-07-01", time: "12:30 - 14:30" },
  { date: "2026-07-02", time: "10:00 - 12:00" },
  { date: "2026-07-02", time: "12:30 - 14:30" },
];
const occupiedSessions = [
  { date: "2026-07-01", time: "10:00 - 12:00" }, // 1 conflict
];

const resA = calculateReplacementAvailability(existingSessions, occupiedSessions);
assert.equal(resA.requiredSessions, 4);
assert.equal(resA.availableSessions, 3);
assert.equal(resA.status, "partially_conflicted");
assert.equal(resA.conflicts.length, 1);
console.log(`Case A (Sessions exist): ${resA.availableSessions}/${resA.requiredSessions} sessions available.`);

// Case B: Assignment sessions are empty (0 rows in db), fallback to batch dates & time slots
const batchDates = ["2026-07-01", "2026-07-02"];
const batchTimeSlots = ["10:00", "12:30", "16:00", "19:30"];
let fallbackSessions: Array<{ date: string; time: string }> = [];
const emptyDbSessions: Array<{ date: string; time: string }> = [];

if (emptyDbSessions.length === 0 && batchDates.length > 0) {
  fallbackSessions = batchDates.flatMap((date) => batchTimeSlots.map((time) => ({ date, time })));
}

assert.equal(fallbackSessions.length, 8, "8 sessions synthesized from 2 dates x 4 slots");
const resB = calculateReplacementAvailability(fallbackSessions, occupiedSessions);
assert.equal(resB.requiredSessions, 8);
assert.equal(resB.availableSessions, 7);
assert.equal(resB.status, "partially_conflicted");
console.log(`Case B (Fallback to batch schedule): ${resB.availableSessions}/${resB.requiredSessions} sessions available (No false 0/0).`);

console.log("✓ Test 3 Passed: Schedule availability fallback resolves real session counts.\n");

// -------------------------------------------------------------
// Test 4: Same-Area Auto Distance Resolution (0.0 km)
// -------------------------------------------------------------
console.log("--- Test 4: Same-Area Distance Auto-Resolution ---");

const deniedLab = { id: "lab_d1", lab_code: "L6", name: "Denied Lab", area: "مدينة نصر", gov: "القاهرة" };
const candidateSameArea = { id: "lab_c1", lab_code: "L196", name: "Candidate Lab 1", area: "مدينة نصر", gov: "القاهرة" };
const candidateDiffArea = { id: "lab_c2", lab_code: "L200", name: "Candidate Lab 2", area: "المعادي", gov: "القاهرة" };

const deniedAreaNorm = normalizeAreaForComparison(deniedLab.area);
const c1AreaNorm = normalizeAreaForComparison(candidateSameArea.area);
const c2AreaNorm = normalizeAreaForComparison(candidateDiffArea.area);

let distC1: number | null = null;
if (deniedAreaNorm && c1AreaNorm && deniedAreaNorm === c1AreaNorm) {
  distC1 = 0.0;
}

assert.equal(distC1, 0.0, "Same area auto-resolves to 0.0 km");

let distC2: number | null = null;
if (deniedAreaNorm && c2AreaNorm && deniedAreaNorm === c2AreaNorm) {
  distC2 = 0.0;
}
assert.equal(distC2, null, "Different area does not auto-resolve to 0.0 km");

console.log("✓ Test 4 Passed: Same-area distance auto-resolves to 0.0 km.\n");

// -------------------------------------------------------------
// Test 5: Quality History Data Mapping from Surveys
// -------------------------------------------------------------
console.log("--- Test 5: Quality Rating History by Batch Mapping ---");

const mockSurveys = [
  {
    id: "survey_1",
    overall_rating: 4,
    pc_rating: 4,
    internet_rating: 5,
    cleanliness_rating: 4,
    facilities_rating: 3,
    feedback: "Great internet speed, PCs well maintained.",
    created_at: "2026-08-15T10:00:00Z",
    batches: { name: "Cohort 2 (August)" },
    projects: { name: "DEMI Summer 2026" },
  },
  {
    id: "survey_2",
    overall_rating: 5,
    pc_rating: 5,
    internet_rating: 5,
    cleanliness_rating: 5,
    facilities_rating: 5,
    feedback: "Exceptional lab condition throughout the batch.",
    created_at: "2026-09-01T12:00:00Z",
    batches: { name: "Cohort 3 (September)" },
    projects: { name: "DEMI Summer 2026" },
  },
];

const mappedSurveys = mockSurveys
  .map((s) => ({
    id: s.id,
    overall_rating: Number(s.overall_rating) || 0,
    pc_rating: s.pc_rating != null ? Number(s.pc_rating) : null,
    internet_rating: s.internet_rating != null ? Number(s.internet_rating) : null,
    facilities_rating: s.facilities_rating != null ? Number(s.facilities_rating) : null,
    cleanliness_rating: s.cleanliness_rating != null ? Number(s.cleanliness_rating) : null,
    feedback: s.feedback,
    created_at: s.created_at,
    batch_name: s.batches?.name,
    project_name: s.projects?.name,
  }))
  .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

assert.equal(mappedSurveys.length, 2);
assert.equal(mappedSurveys[0].batch_name, "Cohort 3 (September)", "Most recent survey is first");
assert.equal(mappedSurveys[0].overall_rating, 5);
assert.equal(mappedSurveys[0].pc_rating, 5);
assert.equal(mappedSurveys[0].internet_rating, 5);
assert.equal(mappedSurveys[0].feedback, "Exceptional lab condition throughout the batch.");

console.log("✓ Test 5 Passed: Quality rating history by batch mapped and sorted correctly.\n");

console.log("=== ALL 5 ITEMS VERIFIED SUCCESSFULLY ===");
