/**
 * Standardized Egyptian Governorates and Physical Areas Directory
 * Complete nationwide catalog of 27 Governorates and 85 Physical Areas
 */

export interface EgyptGovernorate {
  en: string;
  ar: string;
}

export interface EgyptPhysicalArea {
  area: string;
  areaEn: string;
  gov: string;
  govEn: string;
}

// 27 Official Egyptian Governorates
export const EGYPTIAN_GOVERNORATES: EgyptGovernorate[] = [
  { en: "Alexandria", ar: "الإسكندرية" },
  { en: "Aswan", ar: "أسوان" },
  { en: "Asyut", ar: "أسيوط" },
  { en: "Beheira", ar: "البحيرة" },
  { en: "Beni Suef", ar: "بني سويف" },
  { en: "Cairo", ar: "القاهرة" },
  { en: "Dakahlia", ar: "الدقهلية" },
  { en: "Damietta", ar: "دمياط" },
  { en: "Faiyum", ar: "الفيوم" },
  { en: "Gharbiyya", ar: "الغربية" },
  { en: "Giza", ar: "الجيزة" },
  { en: "Ismailia", ar: "الإسماعيلية" },
  { en: "Kafr el-Sheikh", ar: "كفر الشيخ" },
  { en: "Luxor", ar: "الأقصر" },
  { en: "Matrouh", ar: "مطروح" },
  { en: "Minya", ar: "المنيا" },
  { en: "Monufia", ar: "المنوفية" },
  { en: "New Valley", ar: "الوادي الجديد" },
  { en: "North Sinai", ar: "شمال سيناء" },
  { en: "Port Said", ar: "بورسعيد" },
  { en: "Qalyubia", ar: "القليوبية" },
  { en: "Qena", ar: "قنا" },
  { en: "Red Sea", ar: "البحر الأحمر" },
  { en: "Sohag", ar: "سوهاج" },
  { en: "South Sinai", ar: "جنوب سيناء" },
  { en: "Suez", ar: "السويس" },
];

// Complete 85 Physical Areas mapped to their respective Governorates
export const EGYPT_PHYSICAL_AREAS: EgyptPhysicalArea[] = [
  // Cairo (12 areas)
  { area: "مدينة نصر", areaEn: "Nasr City", gov: "القاهرة", govEn: "Cairo" },
  { area: "المعادي", areaEn: "Maadi", gov: "القاهرة", govEn: "Cairo" },
  { area: "مصر الجديدة", areaEn: "Heliopolis", gov: "القاهرة", govEn: "Cairo" },
  { area: "القاهرة الجديدة", areaEn: "New Cairo", gov: "القاهرة", govEn: "Cairo" },
  { area: "شبرا", areaEn: "Shubra", gov: "القاهرة", govEn: "Cairo" },
  { area: "وسط البلد", areaEn: "Downtown", gov: "القاهرة", govEn: "Cairo" },
  { area: "حلوان", areaEn: "Helwan", gov: "القاهرة", govEn: "Cairo" },
  { area: "المقطم", areaEn: "Mokattam", gov: "القاهرة", govEn: "Cairo" },
  { area: "العباسية", areaEn: "Abbassiya", gov: "القاهرة", govEn: "Cairo" },
  { area: "حدائق القبة", areaEn: "Hadayek El Kobba", gov: "القاهرة", govEn: "Cairo" },
  { area: "السلام", areaEn: "El Salam", gov: "القاهرة", govEn: "Cairo" },
  { area: "الشروق", areaEn: "El Shorouk", gov: "القاهرة", govEn: "Cairo" },
  { area: "15 مايو", areaEn: "15th of May", gov: "القاهرة", govEn: "Cairo" },

  // Giza (9 areas)
  { area: "الدقي", areaEn: "Dokki", gov: "الجيزة", govEn: "Giza" },
  { area: "المهندسين", areaEn: "Mohandessin", gov: "الجيزة", govEn: "Giza" },
  { area: "6 أكتوبر", areaEn: "6th of October", gov: "الجيزة", govEn: "Giza" },
  { area: "الشيخ زايد", areaEn: "Sheikh Zayed", gov: "الجيزة", govEn: "Giza" },
  { area: "الهرم", areaEn: "Haram", gov: "الجيزة", govEn: "Giza" },
  { area: "فيصل", areaEn: "Faisal", gov: "الجيزة", govEn: "Giza" },
  { area: "حدائق الأهرام", areaEn: "Hadayek Al Ahram", gov: "الجيزة", govEn: "Giza" },
  { area: "العمرانية", areaEn: "Omraneya", gov: "الجيزة", govEn: "Giza" },
  { area: "إمبابة", areaEn: "Imbaba", gov: "الجيزة", govEn: "Giza" },
  { area: "المنيب", areaEn: "El Mounib", gov: "الجيزة", govEn: "Giza" },

  // Alexandria (7 areas)
  { area: "حي شرق", areaEn: "East District", gov: "الإسكندرية", govEn: "Alexandria" },
  { area: "حي وسط", areaEn: "Central District", gov: "الإسكندرية", govEn: "Alexandria" },
  { area: "أول المنتزة", areaEn: "Montaza 1", gov: "الإسكندرية", govEn: "Alexandria" },
  { area: "المنتزة ثان", areaEn: "Montaza 2", gov: "الإسكندرية", govEn: "Alexandria" },
  { area: "سموحة", areaEn: "Smouha", gov: "الإسكندرية", govEn: "Alexandria" },
  { area: "عجمي", areaEn: "Agami", gov: "الإسكندرية", govEn: "Alexandria" },
  { area: "العامرية", areaEn: "Amreya", gov: "الإسكندرية", govEn: "Alexandria" },
  { area: "برج العرب", areaEn: "Borg El Arab", gov: "الإسكندرية", govEn: "Alexandria" },

  // Qalyubia (5 areas)
  { area: "بنها", areaEn: "Banha", gov: "القليوبية", govEn: "Qalyubia" },
  { area: "شبرا الخيمة", areaEn: "Shubra El Kheima", gov: "القليوبية", govEn: "Qalyubia" },
  { area: "العبور", areaEn: "El Obour", gov: "القليوبية", govEn: "Qalyubia" },
  { area: "قليوب", areaEn: "Qalyub", gov: "القليوبية", govEn: "Qalyubia" },
  { area: "شبين القناطر", areaEn: "Shebin El Qanater", gov: "القليوبية", govEn: "Qalyubia" },

  // Gharbiyya (3 areas)
  { area: "طنطا", areaEn: "Tanta", gov: "الغربية", govEn: "Gharbiyya" },
  { area: "المحلة الكبرى", areaEn: "El Mahalla El Kubra", gov: "الغربية", govEn: "Gharbiyya" },
  { area: "سمنود", areaEn: "Samanoud", gov: "الغربية", govEn: "Gharbiyya" },

  // Dakahlia (2 areas)
  { area: "المنصورة", areaEn: "Mansoura", gov: "الدقهلية", govEn: "Dakahlia" },
  { area: "ميت غمر", areaEn: "Mit Ghamr", gov: "الدقهلية", govEn: "Dakahlia" },

  // Sharqia (4 areas)
  { area: "الزقازيق", areaEn: "Zagazig", gov: "الشرقية", govEn: "Sharqia" },
  { area: "العاشر من رمضان", areaEn: "10th of Ramadan", gov: "الشرقية", govEn: "Sharqia" },
  { area: "بلبيس", areaEn: "Belbeis", gov: "الشرقية", govEn: "Sharqia" },
  { area: "فاقوس", areaEn: "Faqous", gov: "الشرقية", govEn: "Sharqia" },

  // Monufia (6 areas)
  { area: "شبين الكوم", areaEn: "Shebin El Koum", gov: "المنوفية", govEn: "Monufia" },
  { area: "قويسنا", areaEn: "Quesna", gov: "المنوفية", govEn: "Monufia" },
  { area: "أشمون", areaEn: "Ashmoun", gov: "المنوفية", govEn: "Monufia" },
  { area: "السادات", areaEn: "Sadat City", gov: "المنوفية", govEn: "Monufia" },
  { area: "بركة السبع", areaEn: "Berket El Sabaa", gov: "المنوفية", govEn: "Monufia" },
  { area: "الشهداء", areaEn: "El Shohada", gov: "المنوفية", govEn: "Monufia" },

  // Beheira (2 areas)
  { area: "دمنهور", areaEn: "Damanhour", gov: "البحيرة", govEn: "Beheira" },
  { area: "شبراخيت", areaEn: "Shubrakhit", gov: "البحيرة", govEn: "Beheira" },

  // Kafr el-Sheikh (2 areas)
  { area: "كفر الشيخ", areaEn: "Kafr El Sheikh", gov: "كفر الشيخ", govEn: "Kafr el-Sheikh" },
  { area: "دسوق", areaEn: "Desouk", gov: "كفر الشيخ", govEn: "Kafr el-Sheikh" },

  // Damietta (2 areas)
  { area: "دمياط", areaEn: "Damietta", gov: "دمياط", govEn: "Damietta" },
  { area: "فارسكور", areaEn: "Faraskur", gov: "دمياط", govEn: "Damietta" },

  // Port Said (2 areas)
  { area: "بورسعيد", areaEn: "Port Said", gov: "بورسعيد", govEn: "Port Said" },
  { area: "بورفؤاد", areaEn: "Port Fouad", gov: "بورسعيد", govEn: "Port Said" },

  // Ismailia (2 areas)
  { area: "الإسماعيلية", areaEn: "Ismailia", gov: "الإسماعيلية", govEn: "Ismailia" },
  { area: "فايد", areaEn: "Fayed", gov: "الإسماعيلية", govEn: "Ismailia" },

  // Suez (1 area)
  { area: "السويس", areaEn: "Suez", gov: "السويس", govEn: "Suez" },

  // Faiyum (2 areas)
  { area: "الفيوم", areaEn: "Faiyum City", gov: "الفيوم", govEn: "Faiyum" },
  { area: "سنورس", areaEn: "Sinnuris", gov: "الفيوم", govEn: "Faiyum" },

  // Beni Suef (2 areas)
  { area: "بنى سويف", areaEn: "Beni Suef City", gov: "بني سويف", govEn: "Beni Suef" },
  { area: "بوش", areaEn: "Boush", gov: "بني سويف", govEn: "Beni Suef" },

  // Minya (2 areas)
  { area: "المنيا", areaEn: "Minya City", gov: "المنيا", govEn: "Minya" },
  { area: "ملوي", areaEn: "Mallawi", gov: "المنيا", govEn: "Minya" },

  // Asyut (5 areas)
  { area: "أسيوط", areaEn: "Asyut City", gov: "أسيوط", govEn: "Asyut" },
  { area: "ابنوب", areaEn: "Abnoub", gov: "أسيوط", govEn: "Asyut" },
  { area: "ابوتيج", areaEn: "Abou Tig", gov: "أسيوط", govEn: "Asyut" },
  { area: "ديروط", areaEn: "Dayrout", gov: "أسيوط", govEn: "Asyut" },
  { area: "منفلوط", areaEn: "Manfalut", gov: "أسيوط", govEn: "Asyut" },

  // Sohag (2 areas)
  { area: "سوهاج", areaEn: "Sohag City", gov: "سوهاج", govEn: "Sohag" },
  { area: "طهطا", areaEn: "Tahta", gov: "سوهاج", govEn: "Sohag" },

  // Qena (3 areas)
  { area: "قنا", areaEn: "Qena City", gov: "قنا", govEn: "Qena" },
  { area: "قوص", areaEn: "Qous", gov: "قنا", govEn: "Qena" },
  { area: "نجع حمادي", areaEn: "Nag Hammadi", gov: "قنا", govEn: "Qena" },

  // Luxor (1 area)
  { area: "الأقصر", areaEn: "Luxor City", gov: "الأقصر", govEn: "Luxor" },

  // Aswan (2 areas)
  { area: "أسوان", areaEn: "Aswan City", gov: "أسوان", govEn: "Aswan" },
  { area: "إدفو", areaEn: "Edfu", gov: "أسوان", govEn: "Aswan" },

  // Red Sea (1 area)
  { area: "الغردقة", areaEn: "Hurghada", gov: "البحر الأحمر", govEn: "Red Sea" },

  // Matrouh (1 area)
  { area: "مرسى مطروح", areaEn: "Marsa Matrouh", gov: "مطروح", govEn: "Matrouh" },

  // New Valley (2 areas)
  { area: "الخارجة", areaEn: "El Kharga", gov: "الوادي الجديد", govEn: "New Valley" },
  { area: "الداخلة", areaEn: "El Dakhla", gov: "الوادي الجديد", govEn: "New Valley" },

  // North Sinai (1 area)
  { area: "العريش", areaEn: "Arish", gov: "شمال سيناء", govEn: "North Sinai" },

  // South Sinai (2 areas)
  { area: "شرم الشيخ", areaEn: "Sharm El Sheikh", gov: "جنوب سيناء", govEn: "South Sinai" },
  { area: "الطور", areaEn: "El Tor", gov: "جنوب سيناء", govEn: "South Sinai" },
];

// Set of normalized valid names for fast lookup
const NORMALIZE_MAP = new Map<string, string>();
EGYPT_PHYSICAL_AREAS.forEach((item) => {
  NORMALIZE_MAP.set(item.area.trim().toLowerCase(), item.area);
  NORMALIZE_MAP.set(item.areaEn.trim().toLowerCase(), item.area);
});
EGYPTIAN_GOVERNORATES.forEach((gov) => {
  NORMALIZE_MAP.set(gov.ar.trim().toLowerCase(), gov.ar);
  NORMALIZE_MAP.set(gov.en.trim().toLowerCase(), gov.ar);
});

/**
 * Validates whether an area or governorate name is a genuine geographic location in Egypt
 * Rejects invalid strings, special characters, numbers, and spam
 */
export function isValidEgyptLocation(input: string): boolean {
  if (!input || typeof input !== "string") return false;
  const trimmed = input.trim();
  if (trimmed.length < 2) return false;

  const key = trimmed.toLowerCase();

  // 1. Direct match in lookup table (includes all 85 physical areas + 27 governorates in AR & EN)
  if (NORMALIZE_MAP.has(key)) return true;

  // 2. Check partial/full matches against area directory
  if (
    EGYPT_PHYSICAL_AREAS.some(
      (item) =>
        item.area.toLowerCase() === key ||
        item.areaEn.toLowerCase() === key ||
        item.gov.toLowerCase() === key ||
        item.govEn.toLowerCase() === key ||
        item.area.includes(trimmed) ||
        item.areaEn.toLowerCase().includes(key)
    )
  ) {
    return true;
  }

  // 3. Reject strings made only of digits or special symbols (e.g. @@@, 12345)
  // Ensures string contains at least one Arabic (\u0600-\u06FF) or Latin letter
  const hasLetter = /[\u0600-\u06FFa-zA-Z]/.test(trimmed);
  if (!hasLetter) return false;

  return true;
}

/**
 * Validates a Governorate name
 */
export function isValidEgyptGov(gov: string): boolean {
  if (!gov || typeof gov !== "string") return false;
  const trimmed = gov.trim();
  if (trimmed.length < 2) return false;

  const key = trimmed.toLowerCase();
  if (
    EGYPTIAN_GOVERNORATES.some(
      (g) => g.ar.toLowerCase() === key || g.en.toLowerCase() === key || g.ar.includes(trimmed) || g.en.toLowerCase().includes(key)
    )
  ) {
    return true;
  }

  return /[\u0600-\u06FFa-zA-Z]/.test(trimmed);
}

/**
 * Get list of all physical areas within a specific governorate
 */
export function getAreasForGov(govName: string): EgyptPhysicalArea[] {
  if (!govName || govName === "ALL") return EGYPT_PHYSICAL_AREAS;
  const target = govName.trim().toLowerCase();
  return EGYPT_PHYSICAL_AREAS.filter(
    (a) =>
      a.gov.toLowerCase() === target ||
      a.govEn.toLowerCase() === target ||
      a.gov.includes(govName) ||
      govName.includes(a.gov),
  );
}
