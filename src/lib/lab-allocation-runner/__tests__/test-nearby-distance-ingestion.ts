import * as XLSX from "xlsx";
import { loadLabCapacity, type LabRow, type NearbyLabDistance } from "../parse";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log("===============================================================");
  console.log("Running Nearby Lab Distance Ingestion & Resolution Tests");
  console.log("===============================================================\n");

  // ---------------------------------------------------------------------------
  // Case 1 & 2 & 3: Multi-row Lab File with Ranked Nearby Labs + Column Preservation
  // ---------------------------------------------------------------------------
  console.log("Case 1-3: Testing Multi-row Ingestion, Column Preservation & Aggregation...");
  const multiRowLabData = [
    {
      "Lab ID": "LAB_NASR_01",
      "Lab Name": "Nasr City Hub",
      Area: "مدينة نصر",
      Governorate: "Cairo",
      "Lab Capacity": 25,
      "Vendor Name": "TechVentures",
      "Center Name": "Al-Ahram Center",
      Address: "10 Abbas El Akkad",
      "Nearby Rank": 1,
      "Nearby Lab ID": "LAB_HELIOPOLIS_01",
      "Nearby Lab Name": "Heliopolis Central Lab",
      "Nearby Area": "مصر الجديدة",
      "Nearby Location (Google Maps)": "https://maps.google.com/?q=heliopolis",
      "Distance (km)": 3.8,
      "Distance Method": "driving",
    },
    {
      "Lab ID": "LAB_NASR_01",
      "Lab Name": "Nasr City Hub",
      Area: "مدينة نصر",
      Governorate: "Cairo",
      "Lab Capacity": 25,
      "Nearby Rank": 2,
      "Nearby Lab ID": "LAB_MAADI_01",
      "Nearby Lab Name": "Maadi Tech Center",
      "Nearby Area": "المعادي",
      "Distance (km)": 12.4,
      "Distance Method": "driving",
    },
    {
      "Lab ID": "LAB_HELIOPOLIS_01",
      "Lab Name": "Heliopolis Central Lab",
      Area: "مصر الجديدة",
      Governorate: "Cairo",
      "Lab Capacity": 30,
      "Nearby Rank": 1,
      "Nearby Lab ID": "LAB_NASR_01",
      "Nearby Lab Name": "Nasr City Hub",
      "Nearby Area": "مدينة نصر",
      "Distance (km)": 3.8,
      "Distance Method": "driving",
    },
    {
      "Lab ID": "LAB_MAADI_01",
      "Lab Name": "Maadi Tech Center",
      Area: "المعادي",
      Governorate: "Cairo",
      "Lab Capacity": 20,
    },
  ];

  const ws1 = XLSX.utils.json_to_sheet(multiRowLabData);
  const wb1 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb1, ws1, "Labs");
  const buf1 = XLSX.write(wb1, { type: "buffer", bookType: "xlsx" });
  const file1 = new File([buf1], "multi_row_labs.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const parsedLabs = await loadLabCapacity(file1);

  // Assertions for Case 1, 2, 3
  assert(parsedLabs.length === 3, `Expected 3 distinct primary labs, got ${parsedLabs.length}`);

  const nasrLab = parsedLabs.find((l) => l["Lab ID"] === "LAB_NASR_01");
  assert(Boolean(nasrLab), "Primary lab LAB_NASR_01 should exist");
  assert(nasrLab!.Area === "مدينة نصر", `Expected Area 'مدينة نصر', got '${nasrLab!.Area}'`);
  assert(nasrLab!["Lab Capacity"] === 25, `Expected Lab Capacity 25, got ${nasrLab!["Lab Capacity"]}`);
  assert(nasrLab!["Lab Name"] === "Nasr City Hub", `Expected Lab Name 'Nasr City Hub', got '${nasrLab!["Lab Name"]}'`);
  assert(nasrLab!.Governorate === "Cairo", `Expected Governorate 'Cairo', got '${nasrLab!.Governorate}'`);

  assert(Boolean(nasrLab!.nearby_labs), "LAB_NASR_01 must have nearby_labs array");
  assert(nasrLab!.nearby_labs!.length === 2, `Expected 2 nearby labs for LAB_NASR_01, got ${nasrLab!.nearby_labs!.length}`);

  const nearby1 = nasrLab!.nearby_labs![0];
  assert(nearby1.rank === 1, `Expected rank 1, got ${nearby1.rank}`);
  assert(nearby1.nearbyLabId === "LAB_HELIOPOLIS_01", `Expected nearbyLabId LAB_HELIOPOLIS_01, got ${nearby1.nearbyLabId}`);
  assert(nearby1.nearbyLabName === "Heliopolis Central Lab", `Expected nearbyLabName 'Heliopolis Central Lab', got '${nearby1.nearbyLabName}'`);
  assert(nearby1.nearbyArea === "مصر الجديدة", `Expected nearbyArea 'مصر الجديدة', got '${nearby1.nearbyArea}'`);
  assert(nearby1.distanceKm === 3.8, `Expected distanceKm 3.8, got ${nearby1.distanceKm}`);
  assert(nearby1.distanceMethod === "driving", `Expected distanceMethod 'driving', got '${nearby1.distanceMethod}'`);

  const nearby2 = nasrLab!.nearby_labs![1];
  assert(nearby2.rank === 2, `Expected rank 2, got ${nearby2.rank}`);
  assert(nearby2.nearbyLabId === "LAB_MAADI_01", `Expected nearbyLabId LAB_MAADI_01, got ${nearby2.nearbyLabId}`);
  assert(nearby2.distanceKm === 12.4, `Expected distanceKm 12.4, got ${nearby2.distanceKm}`);

  console.log("  ✓ Case 1-3 Passed: Multi-row parsed, columns preserved, 2 nearby labs aggregated.\n");

  // ---------------------------------------------------------------------------
  // Case 4: Graceful Handling of Legacy Lab Files without Distance Columns
  // ---------------------------------------------------------------------------
  console.log("Case 4: Testing Legacy Lab Files (no distance columns)...");
  const legacyLabData = [
    { "Lab ID": "LAB_DOKKI_01", Area: "الدقي", "Lab Capacity": 20, "Lab Name": "Dokki Lab" },
    { "Lab ID": "LAB_GIZA_01", Area: "الجيزة", "Lab Capacity": 15, "Lab Name": "Giza Center" },
  ];

  const ws2 = XLSX.utils.json_to_sheet(legacyLabData);
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, ws2, "Labs");
  const buf2 = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" });
  const file2 = new File([buf2], "legacy_labs.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const parsedLegacy = await loadLabCapacity(file2);
  assert(parsedLegacy.length === 2, `Expected 2 legacy labs, got ${parsedLegacy.length}`);
  assert(parsedLegacy[0]["Lab ID"] === "LAB_DOKKI_01", "Expected LAB_DOKKI_01");
  assert(parsedLegacy[0].nearby_labs?.length === 0, "Expected empty nearby_labs for legacy lab");

  console.log("  ✓ Case 4 Passed: Legacy lab files parsed cleanly without throwing.\n");

  // ---------------------------------------------------------------------------
  // Case 5: Proximity Distance Sorting Simulation for Shortfall Resolution
  // ---------------------------------------------------------------------------
  console.log("Case 5: Testing Proximity Distance Sorting Logic...");

  // Candidate destination labs with varying distances from the shortfall area
  const candidateLabs = [
    {
      id: "LAB_MAADI_01",
      name: "Maadi Tech Center",
      area: "المعادي",
      distanceKm: 12.4,
      distanceRank: 2,
      active_free_capacity: 50,
    },
    {
      id: "LAB_HELIOPOLIS_01",
      name: "Heliopolis Central Lab",
      area: "مصر الجديدة",
      distanceKm: 3.8,
      distanceRank: 1,
      active_free_capacity: 10,
    },
    {
      id: "LAB_SHOUBRA_01",
      name: "Shoubra Center",
      area: "شبرا",
      distanceKm: null,
      distanceRank: null,
      active_free_capacity: 40,
    },
    {
      id: "LAB_TAGAMOA_01",
      name: "Tagamoa Venue",
      area: "التجمع",
      distanceKm: 8.5,
      distanceRank: 3,
      active_free_capacity: 15,
    },
  ];

  // Sorting function matching GovFreeLabsModal
  const sortedCandidates = [...candidateLabs].sort((a, b) => {
    const hasDistA = typeof a.distanceKm === "number" && Number.isFinite(a.distanceKm);
    const hasDistB = typeof b.distanceKm === "number" && Number.isFinite(b.distanceKm);

    if (hasDistA && hasDistB) {
      if (Math.abs(a.distanceKm! - b.distanceKm!) > 0.001) {
        return a.distanceKm! - b.distanceKm!;
      }
      if (a.distanceRank && b.distanceRank && a.distanceRank !== b.distanceRank) {
        return a.distanceRank - b.distanceRank;
      }
      return b.active_free_capacity - a.active_free_capacity;
    }

    if (hasDistA && !hasDistB) return -1;
    if (!hasDistA && hasDistB) return 1;

    return b.active_free_capacity - a.active_free_capacity;
  });

  // Verify that labs are sorted by distance ascending (closest first), followed by labs with no distance data
  assert(sortedCandidates[0].id === "LAB_HELIOPOLIS_01", `Expected closest lab Heliopolis (3.8 km) first, got ${sortedCandidates[0].id}`);
  assert(sortedCandidates[1].id === "LAB_TAGAMOA_01", `Expected second closest Tagamoa (8.5 km), got ${sortedCandidates[1].id}`);
  assert(sortedCandidates[2].id === "LAB_MAADI_01", `Expected third closest Maadi (12.4 km), got ${sortedCandidates[2].id}`);
  assert(sortedCandidates[3].id === "LAB_SHOUBRA_01", `Expected missing distance lab Shoubra last, got ${sortedCandidates[3].id}`);

  console.log("  ✓ Case 5 Passed: Proximity sorting places closest labs first (3.8km -> 8.5km -> 12.4km -> null).\n");

  console.log("===============================================================");
  console.log("All 5 Nearby Distance Ingestion & Resolution Tests Passed (100%)");
  console.log("===============================================================");
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
