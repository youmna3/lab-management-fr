import { cleanArabicString, normalizeArabic } from "../../../lib/arabic";

interface NearbyLabDistance {
  rank: number;
  nearbyLabId: string;
  nearbyLabName?: string;
  nearbyArea?: string;
  nearbyLocationUrl?: string;
  distanceKm: number;
  distanceMethod?: string;
  distanceStatus?: string;
}

interface MockLab {
  id: string;
  lab_code?: string;
  name: string;
  area: string;
  gov: string;
  capacity: number;
  notes?: string;
  nearby_labs?: NearbyLabDistance[];
}

/**
 * Strict, accurate pairwise distance resolver between shortfall origin lab(s) and candidate lab.
 * Prevents area-level collision where all labs in the same area falsely adopt the same distance.
 */
export function resolveDistanceForModalStrict(
  shortfallArea: string,
  candidateLab: MockLab,
  shortfallLabs: MockLab[]
): { distanceKm: number | null; distanceRank: number | null; distanceMethod: string | null } {
  let resolvedDist: number | null = null;
  let resolvedRank: number | null = null;
  let resolvedMethod: string | null = null;

  const candIdLower = String(candidateLab.id || "").trim().toLowerCase();
  const candCodeLower = String(candidateLab.lab_code || "").trim().toLowerCase();
  const candNameNorm = normalizeArabic(cleanArabicString(String(candidateLab.name || "")));

  const getNearbyList = (l: MockLab): NearbyLabDistance[] => {
    if (Array.isArray(l.nearby_labs) && l.nearby_labs.length > 0) return l.nearby_labs;
    if (l.notes && l.notes.includes("[NEARBY_LABS_JSON]:")) {
      try {
        const jsonStr = l.notes.split("[NEARBY_LABS_JSON]:")[1]?.trim();
        if (jsonStr) return JSON.parse(jsonStr);
      } catch {}
    }
    return [];
  };

  let exactIdMatch: { dist: number; rank: number | null; method: string | null } | null = null;
  let nameFallbackMatch: { dist: number; rank: number | null; method: string | null } | null = null;

  // 1. PRIMARY: Check if shortfall origin lab lists this specific candidate lab
  for (const sfLab of shortfallLabs) {
    const nearbyList = getNearbyList(sfLab);
    for (const n of nearbyList) {
      const nId = String(n.nearbyLabId || "").trim().toLowerCase();
      const nNameNorm = normalizeArabic(cleanArabicString(String(n.nearbyLabName || "")));

      const dKm = typeof n.distanceKm === "number" ? n.distanceKm : parseFloat(String(n.distanceKm ?? "").replace(/[^\d.]/g, ""));
      if (!Number.isFinite(dKm)) continue;

      // Strict Tier 1: Lab ID/Code Match
      const idMatch = Boolean(nId && (nId === candIdLower || nId === candCodeLower));
      // Fallback Tier 2: Lab Name Match ONLY if nearbyLabId is empty/not specified
      const nameMatch = Boolean(!nId && nNameNorm && candNameNorm && nNameNorm === candNameNorm);

      if (idMatch) {
        if (!exactIdMatch || dKm < exactIdMatch.dist) {
          exactIdMatch = {
            dist: dKm,
            rank: Number.isFinite(n.rank) ? Number(n.rank) : null,
            method: n.distanceMethod || null,
          };
        }
      } else if (nameMatch) {
        if (!nameFallbackMatch || dKm < nameFallbackMatch.dist) {
          nameFallbackMatch = {
            dist: dKm,
            rank: Number.isFinite(n.rank) ? Number(n.rank) : null,
            method: n.distanceMethod || null,
          };
        }
      }
    }
  }

  if (exactIdMatch) {
    resolvedDist = exactIdMatch.dist;
    resolvedRank = exactIdMatch.rank;
    resolvedMethod = exactIdMatch.method;
  } else if (nameFallbackMatch) {
    resolvedDist = nameFallbackMatch.dist;
    resolvedRank = nameFallbackMatch.rank;
    resolvedMethod = nameFallbackMatch.method;
  }

  // 2. FALLBACK: If no direct match in origin lab, check reverse direction
  if (resolvedDist === null) {
    const destNearbyList = getNearbyList(candidateLab);
    let reverseIdMatch: { dist: number; rank: number | null; method: string | null } | null = null;
    let reverseNameMatch: { dist: number; rank: number | null; method: string | null } | null = null;

    for (const n of destNearbyList) {
      const nId = String(n.nearbyLabId || "").trim().toLowerCase();
      const nNameNorm = normalizeArabic(cleanArabicString(String(n.nearbyLabName || "")));

      const dKm = typeof n.distanceKm === "number" ? n.distanceKm : parseFloat(String(n.distanceKm ?? "").replace(/[^\d.]/g, ""));
      if (!Number.isFinite(dKm)) continue;

      for (const sf of shortfallLabs) {
        const sfId = String(sf.id || "").trim().toLowerCase();
        const sfCode = String(sf.lab_code || "").trim().toLowerCase();
        const sfNameNorm = normalizeArabic(cleanArabicString(String(sf.name || "")));

        const idMatch = Boolean(nId && (nId === sfId || nId === sfCode));
        const nameMatch = Boolean(!nId && nNameNorm && sfNameNorm && nNameNorm === sfNameNorm);

        if (idMatch) {
          if (!reverseIdMatch || dKm < reverseIdMatch.dist) {
            reverseIdMatch = {
              dist: dKm,
              rank: Number.isFinite(n.rank) ? Number(n.rank) : null,
              method: n.distanceMethod || null,
            };
          }
        } else if (nameMatch) {
          if (!reverseNameMatch || dKm < reverseNameMatch.dist) {
            reverseNameMatch = {
              dist: dKm,
              rank: Number.isFinite(n.rank) ? Number(n.rank) : null,
              method: n.distanceMethod || null,
            };
          }
        }
      }
    }

    if (reverseIdMatch) {
      resolvedDist = reverseIdMatch.dist;
      resolvedRank = reverseIdMatch.rank;
      resolvedMethod = reverseIdMatch.method;
    } else if (reverseNameMatch) {
      resolvedDist = reverseNameMatch.dist;
      resolvedRank = reverseNameMatch.rank;
      resolvedMethod = reverseNameMatch.method;
    }
  }

  return {
    distanceKm: resolvedDist,
    distanceRank: resolvedRank,
    distanceMethod: resolvedMethod,
  };
}

async function testShoubrakeitDamanhourFix() {
  console.log("=========================================================================");
  console.log("TESTING SHORTFALL DISTANCE RESOLUTION: شبراخيت (Shortfall) -> دمنهور Labs");
  console.log("=========================================================================\n");

  // Shortfall origin lab in Shoubrakeit (L244) with real multi-lab distance entries
  const originLabShoubrakeit: MockLab = {
    id: "L244",
    lab_code: "L244",
    name: "معمل شبراخيت المركزي",
    area: "شبراخيت",
    gov: "البحيرة",
    capacity: 20,
    nearby_labs: [
      {
        rank: 1,
        nearbyLabId: "L242",
        nearbyLabName: "معمل دمنهور - كلية الهندسة",
        nearbyArea: "دمنهور",
        distanceKm: 1.91,
        distanceMethod: "driving",
      },
      {
        rank: 2,
        nearbyLabId: "L243",
        nearbyLabName: "معمل دمنهور - المجمع العلمي",
        nearbyArea: "دمنهور",
        distanceKm: 3.48,
        distanceMethod: "driving",
      },
      {
        rank: 3,
        nearbyLabId: "L247",
        nearbyLabName: "معمل ايتاي البارود",
        nearbyArea: "ايتاي البارود",
        distanceKm: 22.0,
        distanceMethod: "driving",
      },
      {
        rank: 4,
        nearbyLabId: "L581",
        nearbyLabName: "معمل دمنهور المركزي 3",
        nearbyArea: "دمنهور",
        distanceKm: 31.04,
        distanceMethod: "driving",
      },
    ],
  };

  // Candidate destination labs in Damanhour:
  const candL242: MockLab = {
    id: "L242",
    lab_code: "L242",
    name: "معمل دمنهور - كلية الهندسة",
    area: "دمنهور",
    gov: "البحيرة",
    capacity: 20,
  };

  const candL243: MockLab = {
    id: "L243",
    lab_code: "L243",
    name: "معمل دمنهور - المجمع العلمي",
    area: "دمنهور",
    gov: "البحيرة",
    capacity: 20,
  };

  const candL581: MockLab = {
    id: "L581",
    lab_code: "L581",
    name: "معمل دمنهور المركزي 3",
    area: "دمنهور",
    gov: "البحيرة",
    capacity: 30,
  };

  const candL999: MockLab = {
    id: "L999",
    lab_code: "L999",
    name: "معمل دمنهور الخاص الجديد",
    area: "دمنهور",
    gov: "البحيرة",
    capacity: 20,
    nearby_labs: [],
  };

  const candidateLabs = [candL581, candL243, candL242, candL999];
  const shortfallLabs = [originLabShoubrakeit];

  const results = candidateLabs.map((c) => ({
    ...c,
    ...resolveDistanceForModalStrict("شبراخيت", c, shortfallLabs),
  }));

  // Sort ascending by distance
  results.sort((a, b) => {
    const hasA = typeof a.distanceKm === "number" && Number.isFinite(a.distanceKm);
    const hasB = typeof b.distanceKm === "number" && Number.isFinite(b.distanceKm);
    if (hasA && hasB) {
      if (Math.abs(a.distanceKm! - b.distanceKm!) > 0.001) return a.distanceKm! - b.distanceKm!;
      if (a.distanceRank && b.distanceRank) return a.distanceRank - b.distanceRank;
      return b.capacity - a.capacity;
    }
    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;
    return b.capacity - a.capacity;
  });

  results.forEach((r, idx) => {
    console.log(`Card ${idx + 1}:`);
    console.log(`  Lab: ${r.name} (${r.lab_code})`);
    console.log(`  Area: ${r.area}`);
    if (r.distanceKm !== null) {
      console.log(`  Distance Badge: 📍 ${r.distanceKm.toFixed(2)} km #${r.distanceRank}`);
    } else {
      console.log(`  Distance Badge: [OMITTED - No distance pair data]`);
    }
  });

  // Verify distinct numbers
  if (results[0].distanceKm === 1.91 && results[1].distanceKm === 3.48 && results[2].distanceKm === 31.04 && results[3].distanceKm === null) {
    console.log("\n✅ VERIFICATION SUCCESSFUL: Each lab has its own distinct distance (1.91km, 3.48km, 31.04km) and unlinked lab has no badge!");
  } else {
    throw new Error("Verification failed: values did not match expected distinct distances!");
  }
}

testShoubrakeitDamanhourFix().catch(console.error);
