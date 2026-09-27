// Weighted lab quality score (§6.3 / §14.6).
// Each criterion is normalized to 0..1, multiplied by its weight, summed -> 0..100.
// Weights live here in ONE place so Ops/Finance can retune without a schema change.

export type AcQuality = "yes" | "no" | "partial";
export type LabSize = "small" | "medium" | "large";
export type BathroomType = "separate" | "mixed" | "boys_only" | "girls_only" | "none";

export type QualityInput = {
  pc_count?: number | null;
  pc_quality: number | null;
  lab_size?: LabSize | null;
  seated_capacity?: number | null;
  internet_quality: number | null;
  internet_speed_mbps?: number | null;
  bathroom_type?: BathroomType | null;
  bathroom_boys: boolean;
  bathroom_girls: boolean;
  chairs_quality: number | null;
  street_view: number | null;
  cleanliness: number | null;
  ac: AcQuality;
  ac_count?: number | null;
  projector: boolean;
  has_instructor_pc?: boolean | null;
  has_printer?: boolean | null;
  security: boolean;
  extra_activities: number;
  parent_waiting_area?: boolean | null;
  floor_number?: number | null;
  has_elevator?: boolean | null;
  video_url?: string | null;
  image_urls?: string[] | null;
};

export const QUALITY_WEIGHTS = {
  pc_quality: 16,
  pc_count: 5,
  internet_quality: 15,
  ac: 10,
  lab_size: 5,
  cleanliness: 10,
  chairs_quality: 8,
  security: 6,
  projector: 4,
  has_instructor_pc: 4,
  has_printer: 3,
  bathrooms: 6,
  parent_waiting_area: 4,
  street_view: 2,
  extra_activities: 2,
} as const;

const rating = (v: number | null | undefined): number =>
  v ? Math.max(0, Math.min(5, v)) / 5 : 0;
const flag = (v: boolean | null | undefined): number => (v ? 1 : 0);

/** Determine lab size category automatically based on seated capacity / PCs count */
export function deriveLabSize(seatedCapacity?: number | null, pcCount?: number | null): LabSize {
  const seats = seatedCapacity || pcCount || 0;
  if (seats > 25) return "large";
  if (seats >= 15) return "medium";
  return "small";
}

/** Compute the 0..100 weighted quality score for a lab. */
export function computeQualityScore(q: QualityInput): number {
  const acScore = q.ac === "yes" ? 1 : q.ac === "partial" ? 0.5 : 0;
  const activities = Math.min(Math.max(q.extra_activities ?? 0, 0), 5) / 5;

  const derivedSize = q.lab_size || deriveLabSize(q.seated_capacity, q.pc_count);
  const sizeScore = derivedSize === "large" ? 1 : derivedSize === "medium" ? 0.75 : 0.5;

  const pcCountVal = q.pc_count ?? q.seated_capacity ?? 0;
  const pcCountScore = pcCountVal >= 25 ? 1 : pcCountVal >= 15 ? 0.7 : pcCountVal > 0 ? 0.4 : 0;

  let bathroomScore = 0;
  if (q.bathroom_type === "separate" || (q.bathroom_boys && q.bathroom_girls)) {
    bathroomScore = 1;
  } else if (q.bathroom_type === "mixed") {
    bathroomScore = 0.8;
  } else if (q.bathroom_type === "boys_only" || q.bathroom_type === "girls_only" || q.bathroom_boys || q.bathroom_girls) {
    bathroomScore = 0.6;
  }

  const score =
    rating(q.pc_quality) * QUALITY_WEIGHTS.pc_quality +
    pcCountScore * QUALITY_WEIGHTS.pc_count +
    rating(q.internet_quality) * QUALITY_WEIGHTS.internet_quality +
    acScore * QUALITY_WEIGHTS.ac +
    sizeScore * QUALITY_WEIGHTS.lab_size +
    rating(q.cleanliness) * QUALITY_WEIGHTS.cleanliness +
    rating(q.chairs_quality) * QUALITY_WEIGHTS.chairs_quality +
    flag(q.security) * QUALITY_WEIGHTS.security +
    flag(q.projector) * QUALITY_WEIGHTS.projector +
    flag(q.has_instructor_pc) * QUALITY_WEIGHTS.has_instructor_pc +
    flag(q.has_printer) * QUALITY_WEIGHTS.has_printer +
    bathroomScore * QUALITY_WEIGHTS.bathrooms +
    flag(q.parent_waiting_area) * QUALITY_WEIGHTS.parent_waiting_area +
    rating(q.street_view) * QUALITY_WEIGHTS.street_view +
    activities * QUALITY_WEIGHTS.extra_activities;

  return Math.round(score * 100) / 100;
}

/** Coarse band for badges. */
export function qualityBand(score: number): "high" | "medium" | "low" {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}
