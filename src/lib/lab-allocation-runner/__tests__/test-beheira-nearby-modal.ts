import { getGovForArea, cleanArabicString, normalizeArabic } from "../../../lib/arabic";

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

function resolveDistanceForModal(
  shortfallArea: string,
  candidateLab: MockLab,
  shortfallLabs: MockLab[]
): { distanceKm: number | null; distanceRank: number | null; distanceMethod: string | null } {
  let resolvedDist: number | null = null;
  let resolvedRank: number | null = null;
  let resolvedMethod: string | null = null;

  const labIdLower = String(candidateLab.id || "").trim().toLowerCase();
  const labCodeLower = String(candidateLab.lab_code || "").trim().toLowerCase();
  const labNameNorm = normalizeArabic(cleanArabicString(String(candidateLab.name || "")));
  const labAreaNorm = normalizeArabic(cleanArabicString(String(candidateLab.area || "")));

  // Helper to extract nearby list from lab (supports array or encoded in notes)
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

  // 1. Primary Check: Check if any lab in the shortfall area lists this destination lab in its nearby_labs
  for (const sfLab of shortfallLabs) {
    const nearbyList = getNearbyList(sfLab);
    for (const n of nearbyList) {
      const nId = String(n.nearbyLabId || "").trim().toLowerCase();
      const nNameNorm = normalizeArabic(cleanArabicString(String(n.nearbyLabName || "")));

      const dKm = typeof n.distanceKm === "number" ? n.distanceKm : parseFloat(String(n.distanceKm ?? "").replace(/[^\d.]/g, ""));
      if (!Number.isFinite(dKm)) continue;

      const idMatch = Boolean(nId && (nId === labIdLower || nId === labCodeLower));
      const nameMatch = Boolean(!nId && nNameNorm && labNameNorm && nNameNorm === labNameNorm);

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

  // 2. Fallback Check: Check if destination lab lists any shortfall lab in its nearby_labs
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

async function runBeheiraTest() {
  console.log("=== SIMULATING BEHEIRA (البحيرة) SHORTFALL MODAL RESOLUTION ===");

  // Shortfall origin lab: L239 located in Damanhour (دمنهور), Beheira
  const originLabDamanhour: MockLab = {
    id: "L239",
    lab_code: "L239",
    name: "معمل دمنهور المركزي",
    area: "دمنهور",
    gov: "البحيرة",
    capacity: 20,
    nearby_labs: [
      {
        rank: 1,
        nearbyLabId: "L247",
        nearbyLabName: "معمل ايتاي البارود",
        nearbyArea: "ايتاي البارود",
        distanceKm: 18.5,
        distanceMethod: "driving",
      },
      {
        rank: 2,
        nearbyLabId: "L581",
        nearbyLabName: "معمل كفر الدوار",
        nearbyArea: "كفر الدوار",
        distanceKm: 27.3,
        distanceMethod: "driving",
      },
    ],
  };

  // Candidate destination lab 1: L247 (in origin lab's nearby list - primary lookup)
  const candidateL247: MockLab = {
    id: "L247",
    lab_code: "L247",
    name: "معمل ايتاي البارود",
    area: "ايتاي البارود",
    gov: "البحيرة",
    capacity: 25,
  };

  // Candidate destination lab 2: L581 (in origin lab's nearby list - primary lookup)
  const candidateL581: MockLab = {
    id: "L581",
    lab_code: "L581",
    name: "معمل كفر الدوار",
    area: "كفر الدوار",
    gov: "البحيرة",
    capacity: 30,
  };

  // Candidate destination lab 3: L244 (lists origin lab in ITS own nearby list - fallback lookup)
  const candidateL244: MockLab = {
    id: "L244",
    lab_code: "L244",
    name: "معمل شبراخيت",
    area: "شبراخيت",
    gov: "البحيرة",
    capacity: 20,
    nearby_labs: [
      {
        rank: 1,
        nearbyLabId: "L239",
        nearbyLabName: "معمل دمنهور المركزي",
        nearbyArea: "دمنهور",
        distanceKm: 22.0,
        distanceMethod: "driving",
      },
    ],
  };

  // Candidate destination lab 4: L999 (has NO distance entry in either direction)
  const candidateL999: MockLab = {
    id: "L999",
    lab_code: "L999",
    name: "معمل وادي النطرون",
    area: "وادي النطرون",
    gov: "البحيرة",
    capacity: 20,
    nearby_labs: [],
  };

  const candidateLabs = [candidateL581, candidateL244, candidateL247, candidateL999];
  const shortfallLabs = [originLabDamanhour];

  const resolvedCandidates = candidateLabs.map((cand) => {
    const distInfo = resolveDistanceForModal("دمنهور", cand, shortfallLabs);
    return {
      ...cand,
      ...distInfo,
    };
  });

  // Sort by distance ascending
  resolvedCandidates.sort((a, b) => {
    const hasDistA = typeof a.distanceKm === "number" && Number.isFinite(a.distanceKm);
    const hasDistB = typeof b.distanceKm === "number" && Number.isFinite(b.distanceKm);

    if (hasDistA && hasDistB) {
      if (Math.abs(a.distanceKm! - b.distanceKm!) > 0.001) {
        return a.distanceKm! - b.distanceKm!;
      }
      if (a.distanceRank && b.distanceRank && a.distanceRank !== b.distanceRank) {
        return a.distanceRank - b.distanceRank;
      }
      return b.capacity - a.capacity;
    }

    if (hasDistA && !hasDistB) return -1;
    if (!hasDistA && hasDistB) return 1;

    return b.capacity - a.capacity;
  });

  console.log("Sorted Candidates in Shortfall Modal for Beheira (دمنهور):");
  resolvedCandidates.forEach((c, idx) => {
    console.log(`\nCard ${idx + 1}:`);
    console.log(`  Lab: ${c.name} (${c.lab_code})`);
    console.log(`  Area: ${c.area} • Governorate: ${c.gov}`);
    if (c.distanceKm !== null) {
      console.log(`  Distance Badge: 📍 ${c.distanceKm.toFixed(1)} km #${c.distanceRank || 1}`);
    } else {
      console.log(`  Distance Badge: (Omitted - no distance data for pair)`);
    }
    console.log(`  Capacity: ${c.capacity} seats`);
  });
}

runBeheiraTest().catch(console.error);
