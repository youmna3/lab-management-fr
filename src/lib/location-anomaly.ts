import type { Tables } from "@/integrations/supabase/types";
import { normalizeArabic } from "@/lib/arabic";

type Lab = Tables<"labs">;

export type LocationAnomalyType =
  | "missing_url"
  | "invalid_url"
  | "gov_mismatch"
  | "unverified_pin";

export interface LocationAnomaly {
  labId: string;
  labCode: string | null;
  labName: string;
  gov: string | null;
  area: string | null;
  type: LocationAnomalyType;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
}

// List of all Egypt governorates in Arabic and English for cross-matching
const GOV_ALIASES: Record<string, string[]> = {
  cairo: ["القاهرة", "cairo", "el cairo"],
  giza: ["الجيزة", "giza", "el giza", "october", "أكتوبر", "zayed", "زايد"],
  alexandria: ["الإسكندرية", "الاسكندرية", "alexandria", "alex"],
  qalubiya: ["القليوبية", "qalubiya", "qalyubia", "banha", "بنها", "shubra", "شبرا"],
  gharbiya: ["الغربية", "gharbiya", "gharbiah", "tanta", "طنطا", "mahalla", "المحلة"],
  sharqiya: ["الشرقية", "sharqiya", "sharqia", "zagazig", "الزقازيق"],
  dakahliya: ["الدقهلية", "dakahliya", "dakahlia", "mansoura", "المنصورة"],
  monufiya: ["المنوفية", "monufiya", "menofia", "shebin", "شبين"],
  beheira: ["البحيرة", "beheira", "behira", "damanhour", "دمنهور"],
  kafr_el_sheikh: ["كفر الشيخ", "kafr", "kafr el sheikh"],
  damietta: ["دمياط", "damietta", "damiette"],
  port_said: ["بور سعيد", "بورسعيد", "port said"],
  ismailia: ["الإسماعيلية", "الاسماعيلية", "ismailia"],
  suez: ["السويس", "suez"],
  fayoum: ["الفيوم", "fayoum", "faiyum"],
  beni_suef: ["بني سويف", "beni suef", "benisuef"],
  minya: ["المنيا", "minya", "menia"],
  asyut: ["أسيوط", "اسيوط", "asyut", "assiut"],
  sohag: ["سوهاج", "sohag"],
  qena: ["قنا", "qena"],
  luxor: ["الأقصر", "الاقصر", "luxor"],
  aswan: ["أسوان", "اسوان", "aswan"],
  red_sea: ["البحر الأحمر", "البحر الاحمر", "red sea", "hurghada", "الغردقة"],
  new_valley: ["الوادي الجديد", "new valley", "kharga", "الخارجة"],
  matrouh: ["مطروح", "matrouh", "marsa matrouh"],
  north_sinai: ["شمال سيناء", "north sinai", "arish", "العريش"],
  south_sinai: ["جنوب سيناء", "south sinai", "sharm", "شرم"],
};

/**
 * Automatically inspects a lab record for location anomalies.
 */
export function detectLabLocationAnomaly(lab: Lab): LocationAnomaly | null {
  // 1. Missing Google Maps URL
  if (!lab.maps_url || !lab.maps_url.trim()) {
    return {
      labId: lab.id,
      labCode: lab.lab_code,
      labName: lab.name,
      gov: lab.gov,
      area: lab.area,
      type: "missing_url",
      severity: "critical",
      title: "Missing Map Link",
      description: "No Google Maps location URL provided for this lab.",
    };
  }

  const url = lab.maps_url.trim().toLowerCase();

  // 2. Invalid Map URL format
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      labId: lab.id,
      labCode: lab.lab_code,
      labName: lab.name,
      gov: lab.gov,
      area: lab.area,
      type: "invalid_url",
      severity: "critical",
      title: "Invalid Map URL",
      description: "Map URL is not a valid http/https link.",
    };
  }

  // 3. Governorate Mismatch Detection
  if (lab.gov) {
    const normGov = normalizeArabic(lab.gov);
    const textToCheck = normalizeArabic(`${lab.address || ""} ${lab.location_address || ""} ${lab.maps_url || ""}`);

    // Check if another governorate's distinct name appears in the address/URL while the assigned governorate does NOT match
    for (const [key, aliases] of Object.entries(GOV_ALIASES)) {
      const matchAlias = aliases.find((alias) => normalizeArabic(alias) === normGov);
      if (!matchAlias) {
        // This is a DIFFERENT governorate
        const conflictingAlias = aliases.find((alias) => {
          const normAlias = normalizeArabic(alias);
          return normAlias.length >= 4 && textToCheck.includes(normAlias);
        });

        if (conflictingAlias) {
          return {
            labId: lab.id,
            labCode: lab.lab_code,
            labName: lab.name,
            gov: lab.gov,
            area: lab.area,
            type: "gov_mismatch",
            severity: "warning",
            title: "Governorate Mismatch",
            description: `Assigned to ${lab.gov}, but location address mentions ${conflictingAlias}.`,
          };
        }
      }
    }
  }

  // 4. Unverified location pin
  if (lab.maps_verified === null || lab.maps_verified === undefined) {
    return {
      labId: lab.id,
      labCode: lab.lab_code,
      labName: lab.name,
      gov: lab.gov,
      area: lab.area,
      type: "unverified_pin",
      severity: "info",
      title: "Unverified Location Pin",
      description: "Map pin has not been verified by an operational manager yet.",
    };
  }

  // 5. Verified mismatch
  if (lab.maps_verified === false) {
    return {
      labId: lab.id,
      labCode: lab.lab_code,
      labName: lab.name,
      gov: lab.gov,
      area: lab.area,
      type: "gov_mismatch",
      severity: "critical",
      title: "Flagged Location Mismatch",
      description: lab.maps_verified_note || "Flagged as mismatched location during manual audit.",
    };
  }

  return null;
}

/**
 * Returns all anomalies detected across a list of labs.
 */
export function detectAllLocationAnomalies(labs: Lab[]): LocationAnomaly[] {
  const anomalies: LocationAnomaly[] = [];
  for (const lab of labs || []) {
    const anomaly = detectLabLocationAnomaly(lab);
    if (anomaly) anomalies.push(anomaly);
  }
  return anomalies;
}

/**
 * Evaluates whether a lab's location can be automatically verified.
 * Returns true if the lab has a valid HTTP/HTTPS Google Maps URL and NO governorate or link format anomalies.
 */
export function canAutoVerifyLab(lab: Lab): boolean {
  if (!lab.maps_url || !lab.maps_url.trim()) return false;
  const url = lab.maps_url.trim().toLowerCase();
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;

  // Check for critical/warning anomalies (missing link, invalid link, or governorate mismatch)
  const anomaly = detectLabLocationAnomaly(lab);
  if (anomaly && (anomaly.severity === "critical" || anomaly.severity === "warning")) {
    return false;
  }

  return true;
}
