import React, { useState, useMemo, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  MapPin,
  Building2,
  Users,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Sun,
  Moon,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  Crosshair,
  Maximize2,
  Globe,
  Layers,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { normalizeArabic } from "@/lib/arabic";
import { RealEgyptLeafletMap } from "./RealEgyptLeafletMap";

type Lab = Tables<"labs">;

interface EgyptMapProps {
  labs: Lab[];
  selectedGov?: string;
  onSelectGov: (gov: string) => void;
  selectedLabId?: string | null;
  onSelectLab?: (lab: Lab) => void;
  hideMetrics?: boolean;
  className?: string;
  compact?: boolean;
}

interface AreaCoord {
  nameAr: string;
  nameEn: string;
  dx: number;
  dy: number;
}

interface GovernorateDef {
  id: string;
  nameEn: string;
  nameAr: string;
  x: number;
  y: number;
  areas: AreaCoord[];
}

// 27 Governorates of Egypt with high-accuracy SVG viewBox projection coordinates (800x750)
const EGYPT_GOVERNORATES: GovernorateDef[] = [
  {
    id: "cairo",
    nameEn: "Cairo",
    nameAr: "القاهرة",
    x: 490,
    y: 260,
    areas: [
      { nameAr: "مدينة نصر", nameEn: "Nasr City", dx: 18, dy: -12 },
      { nameAr: "المعادي", nameEn: "Maadi", dx: 12, dy: 18 },
      { nameAr: "شبرا", nameEn: "Shobra", dx: -15, dy: -15 },
      { nameAr: "حدائق القبة", nameEn: "Hadaeq El Qobbah", dx: -6, dy: -22 },
      { nameAr: "حلوان", nameEn: "Helwan", dx: 15, dy: 32 },
      { nameAr: "15 مايو", nameEn: "15th of May", dx: 25, dy: 38 },
      { nameAr: "مصر الجديدة", nameEn: "Heliopolis", dx: 10, dy: -24 },
      { nameAr: "التجمع الخامس", nameEn: "New Cairo", dx: 32, dy: 6 },
      { nameAr: "الزيتون", nameEn: "El Zaytoun", dx: -10, dy: -14 },
      { nameAr: "المقطم", nameEn: "El Mokattam", dx: 20, dy: 10 },
      { nameAr: "عين شمس", nameEn: "Ain Shams", dx: 14, dy: -20 },
      { nameAr: "النزهة", nameEn: "El Nozha", dx: 26, dy: -16 },
    ],
  },
  {
    id: "giza",
    nameEn: "Giza",
    nameAr: "الجيزة",
    x: 440,
    y: 310,
    areas: [
      { nameAr: "6 أكتوبر", nameEn: "6th of October", dx: -38, dy: -15 },
      { nameAr: "الدقي", nameEn: "Dokki", dx: 16, dy: -25 },
      { nameAr: "العمرانية", nameEn: "Omraneya", dx: 12, dy: -10 },
      { nameAr: "حدائق الأهرام", nameEn: "Hadayek El Ahram", dx: -18, dy: 6 },
      { nameAr: "المنيب", nameEn: "El Mounib", dx: 14, dy: 6 },
      { nameAr: "المهندسين", nameEn: "Mohandessin", dx: 20, dy: -30 },
      { nameAr: "الشيخ زايد", nameEn: "Sheikh Zayed", dx: -32, dy: -25 },
      { nameAr: "الهرم", nameEn: "Haram", dx: -6, dy: -5 },
      { nameAr: "فيصل", nameEn: "Faisal", dx: 3, dy: -15 },
    ],
  },
  {
    id: "alexandria",
    nameEn: "Alexandria",
    nameAr: "الإسكندرية",
    x: 340,
    y: 140,
    areas: [
      { nameAr: "أول المنتزة", nameEn: "Montazah 1", dx: 22, dy: -10 },
      { nameAr: "المنتزة ثان", nameEn: "Montazah 2", dx: 32, dy: -12 },
      { nameAr: "حي شرق", nameEn: "Hay Sharq (Smouha)", dx: 12, dy: 6 },
      { nameAr: "العامريات", nameEn: "El Amriya", dx: -28, dy: 16 },
      { nameAr: "برج العرب", nameEn: "Borg El Arab", dx: -48, dy: 28 },
      { nameAr: "العجمي", nameEn: "Agami", dx: -18, dy: 6 },
      { nameAr: "وسط الإسكندرية", nameEn: "Central Alex", dx: 0, dy: 0 },
    ],
  },
  {
    id: "qalyubia",
    nameEn: "Qalyubia",
    nameAr: "القليوبية",
    x: 475,
    y: 235,
    areas: [
      { nameAr: "العبور", nameEn: "El Obour", dx: 22, dy: 10 },
      { nameAr: "بنها", nameEn: "Banha", dx: -16, dy: -16 },
      { nameAr: "شبرا الخيمة", nameEn: "Shobra El Kheima", dx: 6, dy: 16 },
      { nameAr: "شبين القناطر", nameEn: "Shebin El Qanater", dx: 12, dy: -10 },
      { nameAr: "قليوب", nameEn: "Qalyub", dx: -6, dy: 6 },
    ],
  },
  {
    id: "monufia",
    nameEn: "Monufia",
    nameAr: "المنوفية",
    x: 445,
    y: 220,
    areas: [
      { nameAr: "شبين الكوم", nameEn: "Shebin El Kom", dx: 0, dy: 0 },
      { nameAr: "أشمون", nameEn: "Ashmoun", dx: 12, dy: 20 },
      { nameAr: "السادات", nameEn: "Sadat City", dx: -38, dy: -10 },
      { nameAr: "الشهداء", nameEn: "El Shohada", dx: -16, dy: -14 },
      { nameAr: "بركة السبع", nameEn: "Berket El Sab", dx: 14, dy: -16 },
      { nameAr: "منوف", nameEn: "Menouf", dx: -12, dy: 6 },
    ],
  },
  {
    id: "gharbia",
    nameEn: "Gharbia",
    nameAr: "الغربية",
    x: 440,
    y: 190,
    areas: [
      { nameAr: "طنطا", nameEn: "Tanta", dx: 0, dy: 6 },
      { nameAr: "المحلة الكبرى", nameEn: "El Mahalla", dx: 16, dy: -16 },
      { nameAr: "سمنود", nameEn: "Samannoud", dx: 24, dy: -22 },
      { nameAr: "زفتى", nameEn: "Zefta", dx: 22, dy: 12 },
    ],
  },
  {
    id: "dakahlia",
    nameEn: "Dakahlia",
    nameAr: "الدقهلية",
    x: 475,
    y: 175,
    areas: [
      { nameAr: "المنصورة", nameEn: "Mansoura", dx: 0, dy: 0 },
      { nameAr: "طلخا", nameEn: "Talkha", dx: -6, dy: -12 },
      { nameAr: "ميت غمر", nameEn: "Mit Ghamr", dx: -16, dy: 22 },
      { nameAr: "دكرنس", nameEn: "Dekernes", dx: 20, dy: -14 },
      { nameAr: "السنبلاوين", nameEn: "Sinbillawin", dx: 12, dy: 16 },
    ],
  },
  {
    id: "kafr_el_sheikh",
    nameEn: "Kafr El Sheikh",
    nameAr: "كفر الشيخ",
    x: 425,
    y: 155,
    areas: [
      { nameAr: "كفر الشيخ", nameEn: "Kafr El Sheikh City", dx: 0, dy: 0 },
      { nameAr: "دسوق", nameEn: "Desouk", dx: -22, dy: 6 },
      { nameAr: "بيلا", nameEn: "Biala", dx: 22, dy: -6 },
    ],
  },
  {
    id: "beheira",
    nameEn: "Beheira",
    nameAr: "البحيرة",
    x: 375,
    y: 185,
    areas: [
      { nameAr: "دمنهور", nameEn: "Damanhour", dx: 0, dy: 0 },
      { nameAr: "شبراخيت", nameEn: "Shoubrakhit", dx: 20, dy: 6 },
      { nameAr: "كفر الدوار", nameEn: "Kafr El Dawwar", dx: -22, dy: -22 },
      { nameAr: "إيتاي البارود", nameEn: "Itay El Baroud", dx: 14, dy: 20 },
    ],
  },
  {
    id: "sharqia",
    nameEn: "Sharqia",
    nameAr: "الشرقية",
    x: 515,
    y: 210,
    areas: [
      { nameAr: "الزقازيق", nameEn: "Zagazig", dx: -12, dy: 0 },
      { nameAr: "العاشر من رمضان", nameEn: "10th of Ramadan", dx: 28, dy: 20 },
      { nameAr: "بلبيس", nameEn: "Belbeis", dx: 6, dy: 16 },
      { nameAr: "فاقوس", nameEn: "Faqous", dx: 16, dy: -22 },
      { nameAr: "أبو حماد", nameEn: "Abu Hammad", dx: 12, dy: -6 },
    ],
  },
  {
    id: "damietta",
    nameEn: "Damietta",
    nameAr: "دمياط",
    x: 510,
    y: 150,
    areas: [
      { nameAr: "دمياط", nameEn: "Damietta City", dx: 0, dy: 0 },
      { nameAr: "فارسكور", nameEn: "Faraskour", dx: -14, dy: 12 },
      { nameAr: "رأس البر", nameEn: "Ras El Bar", dx: 6, dy: -12 },
    ],
  },
  {
    id: "port_said",
    nameEn: "Port Said",
    nameAr: "بورسعيد",
    x: 555,
    y: 160,
    areas: [
      { nameAr: "بورسعيد", nameEn: "Port Said City", dx: 0, dy: 0 },
      { nameAr: "بورفؤاد", nameEn: "Port Fouad", dx: 14, dy: 6 },
    ],
  },
  {
    id: "ismailia",
    nameEn: "Ismailia",
    nameAr: "الإسماعيلية",
    x: 555,
    y: 215,
    areas: [
      { nameAr: "الإسماعيلية", nameEn: "Ismailia City", dx: 0, dy: 0 },
      { nameAr: "فايد", nameEn: "Fayed", dx: 6, dy: 22 },
      { nameAr: "القنطرة", nameEn: "Qantara", dx: 3, dy: -22 },
    ],
  },
  {
    id: "suez",
    nameEn: "Suez",
    nameAr: "السويس",
    x: 550,
    y: 275,
    areas: [
      { nameAr: "السويس", nameEn: "Suez City", dx: 0, dy: 0 },
      { nameAr: "العين السخنة", nameEn: "Ain Sokhna", dx: 12, dy: 32 },
    ],
  },
  {
    id: "fayoum",
    nameEn: "Fayoum",
    nameAr: "الفيوم",
    x: 420,
    y: 340,
    areas: [
      { nameAr: "الفيوم", nameEn: "Fayoum City", dx: 0, dy: 0 },
      { nameAr: "سنورس", nameEn: "Sinnuris", dx: 6, dy: -16 },
      { nameAr: "إطسا", nameEn: "Itsa", dx: -12, dy: 16 },
    ],
  },
  {
    id: "beni_suef",
    nameEn: "Beni Suef",
    nameAr: "بني سويف",
    x: 445,
    y: 380,
    areas: [
      { nameAr: "بنى سويف", nameEn: "Beni Suef City", dx: 0, dy: 0 },
      { nameAr: "بوش", nameEn: "Boush", dx: 3, dy: -16 },
      { nameAr: "الواسطى", nameEn: "Wasta", dx: -3, dy: -32 },
    ],
  },
  {
    id: "minya",
    nameEn: "Minya",
    nameAr: "المنيا",
    x: 435,
    y: 440,
    areas: [
      { nameAr: "المنيا", nameEn: "Minya City", dx: 0, dy: 0 },
      { nameAr: "ملوي", nameEn: "Mallawi", dx: 6, dy: 28 },
      { nameAr: "بني مزار", nameEn: "Beni Mazar", dx: -6, dy: -28 },
      { nameAr: "سمالوط", nameEn: "Samalut", dx: -3, dy: -14 },
    ],
  },
  {
    id: "asyut",
    nameEn: "Asyut",
    nameAr: "أسيوط",
    x: 460,
    y: 500,
    areas: [
      { nameAr: "أسيوط", nameEn: "Asyut City", dx: 0, dy: 0 },
      { nameAr: "ابنوب", nameEn: "Abnoub", dx: 16, dy: -12 },
      { nameAr: "ابوتيج", nameEn: "Abou Tig", dx: -12, dy: 20 },
      { nameAr: "ديروط", nameEn: "Dairut", dx: -16, dy: -32 },
      { nameAr: "منفلوط", nameEn: "Manfalut", dx: -14, dy: -16 },
      { nameAr: "القوصية", nameEn: "Qusiya", dx: -16, dy: -24 },
    ],
  },
  {
    id: "sohag",
    nameEn: "Sohag",
    nameAr: "سوهاج",
    x: 500,
    y: 555,
    areas: [
      { nameAr: "سوهاج", nameEn: "Sohag City", dx: 0, dy: 0 },
      { nameAr: "طهطا", nameEn: "Tahta", dx: -16, dy: -22 },
      { nameAr: "جرجا", nameEn: "Girga", dx: 16, dy: 22 },
      { nameAr: "أخميم", nameEn: "Akhmim", dx: 14, dy: 3 },
    ],
  },
  {
    id: "qena",
    nameEn: "Qena",
    nameAr: "قنا",
    x: 550,
    y: 595,
    areas: [
      { nameAr: "قنا", nameEn: "Qena City", dx: 0, dy: 0 },
      { nameAr: "قوص", nameEn: "Qous", dx: 12, dy: 20 },
      { nameAr: "نجع حمادي", nameEn: "Nag Hammadi", dx: -24, dy: -16 },
      { nameAr: "دشنا", nameEn: "Deshna", dx: -10, dy: -10 },
    ],
  },
  {
    id: "luxor",
    nameEn: "Luxor",
    nameAr: "الأقصر",
    x: 560,
    y: 630,
    areas: [
      { nameAr: "الأقصر", nameEn: "Luxor City", dx: 0, dy: 0 },
      { nameAr: "إسنا", nameEn: "Esna", dx: -14, dy: 22 },
      { nameAr: "أرمنت", nameEn: "Armant", dx: -16, dy: 10 },
    ],
  },
  {
    id: "aswan",
    nameEn: "Aswan",
    nameAr: "أسوان",
    x: 575,
    y: 680,
    areas: [
      { nameAr: "أسوان", nameEn: "Aswan City", dx: 0, dy: 0 },
      { nameAr: "إدفو", nameEn: "Edfu", dx: -16, dy: -38 },
      { nameAr: "كوم أمبو", nameEn: "Kom Ombo", dx: -10, dy: -20 },
    ],
  },
  {
    id: "matrouh",
    nameEn: "Matrouh",
    nameAr: "مرسى مطروح",
    x: 200,
    y: 200,
    areas: [
      { nameAr: "مرسى مطروح", nameEn: "Matrouh City", dx: 0, dy: 0 },
      { nameAr: "العلمين", nameEn: "El Alamein", dx: 50, dy: 16 },
      { nameAr: "سيوة", nameEn: "Siwa Oasis", dx: -25, dy: 90 },
      { nameAr: "الضبعة", nameEn: "Dabaa", dx: 28, dy: 12 },
    ],
  },
  {
    id: "new_valley",
    nameEn: "New Valley",
    nameAr: "الوادي الجديد",
    x: 280,
    y: 560,
    areas: [
      { nameAr: "الخارجة", nameEn: "Kharga Oasis", dx: 32, dy: -22 },
      { nameAr: "الداخلة", nameEn: "Dakhla Oasis", dx: -32, dy: 12 },
      { nameAr: "الفرافرة", nameEn: "Farafra", dx: -48, dy: -85 },
    ],
  },
  {
    id: "red_sea",
    nameEn: "Red Sea",
    nameAr: "البحر الأحمر",
    x: 670,
    y: 480,
    areas: [
      { nameAr: "الغردقة", nameEn: "Hurghada", dx: 0, dy: -65 },
      { nameAr: "سفاجا", nameEn: "Safaga", dx: -6, dy: -22 },
      { nameAr: "القصير", nameEn: "Quseir", dx: -12, dy: 16 },
      { nameAr: "مرسى علم", nameEn: "Marsa Alam", dx: -16, dy: 65 },
    ],
  },
  {
    id: "north_sinai",
    nameEn: "North Sinai",
    nameAr: "شمال سيناء",
    x: 640,
    y: 190,
    areas: [
      { nameAr: "العريش", nameEn: "Arish", dx: 0, dy: 0 },
      { nameAr: "رفح", nameEn: "Rafah", dx: 28, dy: -12 },
      { nameAr: "الشيخ زويد", nameEn: "Sheikh Zuweid", dx: 16, dy: -6 },
      { nameAr: "بئر العبد", nameEn: "Bir al-Abed", dx: -32, dy: 12 },
    ],
  },
  {
    id: "south_sinai",
    nameEn: "South Sinai",
    nameAr: "جنوب سيناء",
    x: 655,
    y: 300,
    areas: [
      { nameAr: "شرم الشيخ", nameEn: "Sharm El Sheikh", dx: 16, dy: 55 },
      { nameAr: "الطور", nameEn: "El Tor", dx: -22, dy: 32 },
      { nameAr: "دهب", nameEn: "Dahab", dx: 28, dy: 28 },
      { nameAr: "نويبع", nameEn: "Nuweiba", dx: 32, dy: 0 },
      { nameAr: "طابا", nameEn: "Taba", dx: 38, dy: -32 },
      { nameAr: "سانت كاترين", nameEn: "Saint Catherine", dx: 0, dy: 16 },
    ],
  },
];

export function EgyptLabCoverageMap({
  labs,
  selectedGov = "all",
  onSelectGov,
  selectedLabId,
  onSelectLab,
  hideMetrics = false,
  className,
  compact = false,
}: EgyptMapProps) {
  const [hoveredGovId, setHoveredGovId] = useState<string | null>(null);
  const [hoveredAreaName, setHoveredAreaName] = useState<string | null>(null);

  // Map View Mode State ("real" Street Map vs "projection" SVG Grid)
  const [mapMode, setMapMode] = useState<"real" | "projection">("real");

  // Map Theme State (Default to Light / White mode)
  const [mapTheme, setMapTheme] = useState<"light" | "dark">("light");

  // Zoom & Pan Engine State
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Map Search Query
  const [searchQuery, setSearchQuery] = useState<string>("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Group labs by Governorate & Area
  const { govStats, areaStats } = useMemo(() => {
    const gStats: Record<string, {
      count: number;
      capacity: number;
      vendors: Set<string>;
      valid: number;
      issues: number;
      verified: number;
      labs: Lab[];
    }> = {};

    const aStats: Record<string, {
      count: number;
      capacity: number;
      centers: Set<string>;
      govNameAr: string;
      govNameEn: string;
      labs: Lab[];
    }> = {};

    EGYPT_GOVERNORATES.forEach(g => {
      gStats[g.id] = { count: 0, capacity: 0, vendors: new Set(), valid: 0, issues: 0, verified: 0, labs: [] };
    });

    (labs || []).forEach(lab => {
      if (!lab || !lab.gov) return;
      const rawGov = lab.gov.trim();
      const normGov = normalizeArabic(rawGov);
      const rawArea = (lab.area || "").trim();

      const matchedGov = EGYPT_GOVERNORATES.find(g => {
        const normDefEn = g.nameEn.toLowerCase();
        const normDefAr = normalizeArabic(g.nameAr);
        return normGov.includes(normDefAr) || normDefAr.includes(normGov) || rawGov.toLowerCase().includes(normDefEn);
      });

      const govId = matchedGov ? matchedGov.id : "cairo";
      if (!gStats[govId]) {
        gStats[govId] = { count: 0, capacity: 0, vendors: new Set(), valid: 0, issues: 0, verified: 0, labs: [] };
      }

      gStats[govId].count += 1;
      gStats[govId].capacity += (lab.capacity || 0);
      if (lab.vendor_name) gStats[govId].vendors.add(lab.vendor_name);
      if (lab.validation_status === "issues") gStats[govId].issues += 1;
      else gStats[govId].valid += 1;
      if (lab.maps_verified) gStats[govId].verified += 1;
      gStats[govId].labs.push(lab);

      if (rawArea) {
        const areaKey = `${matchedGov ? matchedGov.nameAr : rawGov}__${rawArea}`;
        if (!aStats[areaKey]) {
          aStats[areaKey] = {
            count: 0,
            capacity: 0,
            centers: new Set(),
            govNameAr: matchedGov ? matchedGov.nameAr : rawGov,
            govNameEn: matchedGov ? matchedGov.nameEn : rawGov,
            labs: [],
          };
        }
        aStats[areaKey].count += 1;
        aStats[areaKey].capacity += (lab.capacity || 0);
        if (lab.center_name) aStats[areaKey].centers.add(lab.center_name);
        aStats[areaKey].labs.push(lab);
      }
    });

    return { govStats: gStats, areaStats: aStats };
  }, [labs]);

  const totalCoveredGovs = useMemo(() => {
    return Object.values(govStats).filter(s => s.count > 0).length;
  }, [govStats]);

  const maxLabCountInAnyGov = useMemo(() => {
    const counts = Object.values(govStats).map(s => s.count);
    return Math.max(...counts, 1);
  }, [govStats]);

  const activeGovObj = useMemo(() => {
    if (!selectedGov || selectedGov === "all") return null;
    const norm = normalizeArabic(selectedGov);
    return EGYPT_GOVERNORATES.find(g => normalizeArabic(g.nameAr) === norm || g.nameEn.toLowerCase() === String(selectedGov).toLowerCase());
  }, [selectedGov]);

  const hoveredGovObj = useMemo(() => {
    if (!hoveredGovId) return null;
    return EGYPT_GOVERNORATES.find(g => g.id === hoveredGovId);
  }, [hoveredGovId]);

  // Handle Zoom & Bounded Pan
  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.4, 3.5));
  const handleZoomOut = () => {
    setZoom(prev => {
      const next = Math.max(prev - 0.4, 1);
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    onSelectGov("all");
    setSearchQuery("");
  };

  const focusOnGov = (gov: GovernorateDef) => {
    onSelectGov(gov.nameAr);
    setZoom(2.2);
    const targetX = (400 - gov.x) * 1.4;
    const targetY = (375 - gov.y) * 1.4;
    setPan({ x: targetX, y: targetY });
  };

  // Mouse Drag / Pan Handling
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoom <= 1) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Wheel Zoom Event Handling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        setZoom(z => Math.min(z + 0.2, 3.5));
      } else {
        setZoom(z => {
          const next = Math.max(z - 0.2, 1);
          if (next === 1) setPan({ x: 0, y: 0 });
          return next;
        });
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Search locator matching
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return { govs: [], areas: [] };
    const norm = normalizeArabic(searchQuery.trim());

    const matchedGovs = EGYPT_GOVERNORATES.filter(g =>
      normalizeArabic(g.nameAr).includes(norm) || g.nameEn.toLowerCase().includes(norm.toLowerCase())
    );

    const matchedAreas: { gov: GovernorateDef; area: AreaCoord; count: number }[] = [];
    EGYPT_GOVERNORATES.forEach(g => {
      g.areas.forEach(a => {
        if (normalizeArabic(a.nameAr).includes(norm) || a.nameEn.toLowerCase().includes(norm.toLowerCase())) {
          const areaKey = `${g.nameAr}__${a.nameAr}`;
          const count = areaStats[areaKey] ? areaStats[areaKey].count : 0;
          matchedAreas.push({ gov: g, area: a, count });
        }
      });
    });

    return { govs: matchedGovs, areas: matchedAreas };
  }, [searchQuery, areaStats]);

  const getDensityColor = (count: number) => {
    if (count === 0) return mapTheme === "light" ? "#85A5B9" : "#1F2A55";
    const ratio = count / maxLabCountInAnyGov;
    if (ratio > 0.6) return "#056FEC"; // Brand Blue
    if (ratio > 0.3) return "#05ACFF"; // Sky Blue
    return "#FF7F1C"; // Brand Orange
  };

  const isLight = mapTheme === "light";

  return (
    <Card className={`shadow-xs bg-card overflow-hidden ${className || ""}`}>
      <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge className="bg-[#056FEC] text-white font-semibold shadow-xs">Egypt Coverage Map</Badge>
            <span className="text-xs text-muted-foreground font-medium">
              {totalCoveredGovs} of 27 Governorates Active
            </span>
          </div>
          <CardTitle className="text-lg font-bold tracking-tight mt-1 flex items-center gap-2">
            <MapPin className="h-5 w-5 text-[#056FEC]" />
            National Lab Network Across Egypt
          </CardTitle>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Map View Mode Switcher */}
          <div className="flex items-center gap-1 rounded-lg border bg-muted p-1 text-xs">
            <Button
              variant={mapMode === "real" ? "default" : "ghost"}
              size="sm"
              onClick={() => setMapMode("real")}
              className="h-7 text-xs gap-1.5 font-semibold"
            >
              <Globe className="h-3.5 w-3.5" />
              Real Street Map
            </Button>
            <Button
              variant={mapMode === "projection" ? "default" : "ghost"}
              size="sm"
              onClick={() => setMapMode("projection")}
              className="h-7 text-xs gap-1.5 font-semibold"
            >
              <Layers className="h-3.5 w-3.5" />
              SVG Grid View
            </Button>
          </div>

          {mapMode === "projection" && (
            <>
              {/* Zoom Level Indicator & Controls */}
              <div className="flex items-center gap-1 rounded-lg border bg-background px-2 py-1 shadow-xs text-xs font-semibold">
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleZoomOut} disabled={zoom <= 1} title="Zoom Out">
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="w-10 text-center text-[11px] text-muted-foreground font-mono">{Math.round(zoom * 100)}%</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleZoomIn} disabled={zoom >= 3.5} title="Zoom In">
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleResetZoom} title="Reset View">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Theme Toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMapTheme(isLight ? "dark" : "light")}
                className="text-xs h-8 gap-1.5 border-border"
              >
                {isLight ? (
                  <>
                    <Moon className="h-3.5 w-3.5 text-slate-700" />
                    <span>Dark Map</span>
                  </>
                ) : (
                  <>
                    <Sun className="h-3.5 w-3.5 text-amber-400" />
                    <span>White Map</span>
                  </>
                )}
              </Button>
            </>
          )}

          {selectedGov !== "all" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetZoom}
              className="text-xs h-8 border-[#056FEC]/30 text-[#056FEC] dark:text-[#05ACFF] hover:bg-[#F7FAFF] dark:hover:bg-[#182245]"
            >
              Show All ({labs.length} Labs)
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className={compact ? "p-3 sm:p-4" : "p-4 sm:p-6"}>
        {/* City & Governorate Search Bar */}
        <div className="relative mb-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search city or governorate (e.g., Nasr City, Tanta, Mansoura, Dokki, October…)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 text-xs h-9 bg-background border-border"
            />
          </div>

          {searchQuery.trim().length > 0 && (searchResults.govs?.length > 0 || searchResults.areas?.length > 0) && (
            <div className="absolute top-10 left-0 right-0 z-30 max-h-60 overflow-y-auto rounded-lg border bg-popover text-popover-foreground p-2 shadow-lg space-y-1 text-xs">
              {searchResults.govs?.map(g => (
                <div
                  key={g.id}
                  className="flex items-center justify-between p-2 rounded hover:bg-accent cursor-pointer"
                  onClick={() => {
                    focusOnGov(g);
                    setSearchQuery("");
                  }}
                >
                  <span className="font-bold flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-[#056FEC]" />
                    {g.nameEn} ({g.nameAr})
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {govStats[g.id]?.count || 0} Labs
                  </Badge>
                </div>
              ))}

              {searchResults.areas?.map((item, idx) => (
                <div
                  key={`${item.gov.id}_${item.area.nameEn}_${idx}`}
                  className="flex items-center justify-between p-2 rounded hover:bg-accent cursor-pointer"
                  onClick={() => {
                    focusOnGov(item.gov);
                    setSearchQuery("");
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-sky-600" />
                    <span className="font-semibold">{item.area.nameEn} ({item.area.nameAr})</span>
                    <span className="text-[10px] text-muted-foreground">in {item.gov.nameEn}</span>
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {item.count} Labs
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Coverage Highlights Banner */}
        {!hideMetrics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="rounded-xl border border-[#056FEC]/20 bg-gradient-to-br from-[#056FEC]/10 to-[#056FEC]/5 p-3.5 shadow-xs">
              <div className="text-xs font-bold uppercase tracking-wider text-[#056FEC] dark:text-[#05ACFF]">Gov Coverage</div>
              <div className="text-2xl font-black mt-0.5 text-foreground">{totalCoveredGovs} / 27</div>
              <div className="text-[11px] text-muted-foreground">100% Regional Reach</div>
            </div>
            <div className="rounded-xl border border-[#FF7F1C]/20 bg-gradient-to-br from-[#FF7F1C]/10 to-[#FF7F1C]/5 p-3.5 shadow-xs">
              <div className="text-xs font-bold uppercase tracking-wider text-[#FF7F1C]">Total Labs</div>
              <div className="text-2xl font-black mt-0.5 text-foreground">{labs.length}</div>
              <div className="text-[11px] text-muted-foreground">Verified Facilities</div>
            </div>
            <div className="rounded-xl border border-[#05ACFF]/20 bg-gradient-to-br from-[#05ACFF]/10 to-[#05ACFF]/5 p-3.5 shadow-xs">
              <div className="text-xs font-bold uppercase tracking-wider text-[#05ACFF]">Total Capacity</div>
              <div className="text-2xl font-black mt-0.5 text-foreground">
                {Object.values(govStats).reduce((a, b) => a + b.capacity, 0).toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">Seats / Workstations</div>
            </div>
            <div className="rounded-xl border border-[#0EAA3A]/20 bg-gradient-to-br from-[#0EAA3A]/10 to-[#0EAA3A]/5 p-3.5 shadow-xs">
              <div className="text-xs font-bold uppercase tracking-wider text-[#0EAA3A]">Avg Labs / Gov</div>
              <div className="text-2xl font-black mt-0.5 text-foreground">
                {(labs.length / Math.max(totalCoveredGovs, 1)).toFixed(1)}
              </div>
              <div className="text-[11px] text-muted-foreground">Facilities per Region</div>
            </div>
          </div>
        )}

        {/* Interactive Bounded Map Canvas */}
        {mapMode === "real" ? (
          <RealEgyptLeafletMap
            labs={labs}
            selectedGov={selectedGov}
            onSelectGov={onSelectGov}
            selectedLabId={selectedLabId}
            onSelectLab={onSelectLab}
            className={compact ? "w-full h-[460px] rounded-xl overflow-hidden border border-border/70 shadow-inner" : undefined}
          />
        ) : (
          <div
            ref={containerRef}
            className={`relative w-full rounded-xl border p-4 shadow-inner overflow-hidden select-none transition-colors ${
              isDragging ? "cursor-grabbing" : zoom > 1 ? "cursor-grab" : "cursor-default"
            } ${isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950 border-slate-800"}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
          {/* Legend */}
          <div className={`absolute top-4 left-4 z-10 flex flex-col gap-1.5 rounded-lg backdrop-blur p-2.5 text-xs border shadow-sm ${
            isLight ? "bg-white/95 text-slate-800 border-slate-200 shadow-slate-200/50" : "bg-slate-900/90 text-white border-slate-800"
          }`}>
            <div className={`font-semibold text-[11px] uppercase tracking-wider mb-0.5 ${isLight ? "text-slate-500" : "text-slate-400"}`}>
              Lab Density
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#056FEC] shadow-xs"></span>
              <span>High (&gt; 25 Labs)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#05ACFF] shadow-xs"></span>
              <span>Medium (10–25 Labs)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#FF7F1C] shadow-xs"></span>
              <span>Active (&lt; 10 Labs)</span>
            </div>
            {zoom > 1.4 && (
              <div className="pt-1.5 border-t border-[#E6EDF1] dark:border-[#1F2A55] text-[10px] text-[#056FEC] dark:text-[#05ACFF] font-semibold flex items-center gap-1">
                <Crosshair className="h-3 w-3" />
                City / Area Level View
              </div>
            )}
          </div>

          {/* SVG Canvas Projection */}
          <div className="relative w-full aspect-[4/3] max-h-[550px] flex items-center justify-center overflow-hidden">
            <svg
              viewBox="0 0 800 750"
              className="w-full h-full filter drop-shadow-xs transition-transform duration-100 ease-out"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
              }}
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <radialGradient id="egyptMapBgLight" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#f1f5f9" />
                </radialGradient>
                <radialGradient id="egyptMapBgDark" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#0f172a" />
                  <stop offset="100%" stopColor="#020617" />
                </radialGradient>
                <filter id="glowPin" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              <rect
                width="800"
                height="750"
                fill={isLight ? "url(#egyptMapBgLight)" : "url(#egyptMapBgDark)"}
                rx="16"
              />

              {/* Sea Water Labels */}
              <text
                x="380"
                y="80"
                fill={isLight ? "#64748b" : "#475569"}
                fontSize="14"
                fontWeight="600"
                letterSpacing="3"
                opacity={isLight ? "0.75" : "0.6"}
              >
                MEDITERRANEAN SEA
              </text>
              <text
                x="700"
                y="420"
                fill={isLight ? "#64748b" : "#475569"}
                fontSize="13"
                fontWeight="600"
                letterSpacing="2"
                opacity={isLight ? "0.75" : "0.6"}
                transform="rotate(65, 700, 420)"
              >
                RED SEA
              </text>

              {/* Nile River Curve */}
              <g stroke={isLight ? "#cbd5e1" : "#334155"} strokeWidth="1.5" fill="none" opacity={isLight ? "0.7" : "0.4"}>
                <path d="M575,680 Q560,630 550,595 T500,555 T460,500 T435,440 T445,380 T420,340 T440,310 T490,260 L475,175" stroke="#0284c7" strokeWidth="3.5" opacity="0.85" />
                <path d="M490,260 L340,140" stroke="#0284c7" strokeWidth="2.5" opacity="0.65" />
                <path d="M490,260 L555,160" stroke="#0284c7" strokeWidth="2.5" opacity="0.65" />
              </g>

              {/* Governorates & Sub-City Pins */}
              {EGYPT_GOVERNORATES.map(gov => {
                const stat = govStats[gov.id] || { count: 0, capacity: 0, vendors: new Set() };
                const isSelected = activeGovObj?.id === gov.id;
                const isHovered = hoveredGovId === gov.id;
                const color = getDensityColor(stat.count);

                return (
                  <g key={gov.id}>
                    {/* Primary Governorate Pin */}
                    <g
                      className="cursor-pointer transition-all duration-200"
                      onMouseEnter={() => setHoveredGovId(gov.id)}
                      onMouseLeave={() => setHoveredGovId(null)}
                      onClick={() => focusOnGov(gov)}
                    >
                      {(isSelected || (stat.count > 15 && isHovered)) && (
                        <circle
                          cx={gov.x}
                          cy={gov.y}
                          r="22"
                          fill="none"
                          stroke={color}
                          strokeWidth="2"
                          className="animate-ping opacity-75"
                        />
                      )}

                      <circle
                        cx={gov.x}
                        cy={gov.y}
                        r={isSelected ? "18" : isHovered ? "16" : "14"}
                        fill={color}
                        fillOpacity={isSelected ? "0.95" : isLight ? "0.9" : "0.85"}
                        stroke={isSelected ? (isLight ? "#0f172a" : "#ffffff") : isHovered ? "#38bdf8" : (isLight ? "#ffffff" : "#1e293b")}
                        strokeWidth={isSelected ? "3" : "1.5"}
                        filter="url(#glowPin)"
                      />

                      <text
                        x={gov.x}
                        y={gov.y + 4}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="11"
                        fontWeight="bold"
                        className="pointer-events-none select-none"
                      >
                        {stat.count}
                      </text>

                      <text
                        x={gov.x}
                        y={gov.y + 26}
                        textAnchor="middle"
                        fill={isSelected ? (isLight ? "#0284c7" : "#38bdf8") : isHovered ? (isLight ? "#0f172a" : "#ffffff") : (isLight ? "#334155" : "#94a3b8")}
                        fontSize="10"
                        fontWeight={isSelected || isHovered ? "700" : "600"}
                        className="pointer-events-none transition-colors"
                      >
                        {gov.nameEn}
                      </text>
                    </g>

                    {/* City/Area Sub-Pins - Only render for selected or hovered governorate to prevent clutter */}
                    {(isSelected || isHovered) && (
                      <g className="animate-in fade-in duration-300">
                        {gov.areas.map(area => {
                          const areaKey = `${gov.nameAr}__${area.nameAr}`;
                          const aStat = areaStats[areaKey];
                          const labCount = aStat ? aStat.count : 0;
                          const ax = gov.x + area.dx;
                          const ay = gov.y + area.dy;
                          const isAreaHovered = hoveredAreaName === area.nameAr;

                          return (
                            <g
                              key={`${gov.id}_area_${area.nameEn}`}
                              className="cursor-pointer transition-all hover:scale-110"
                              onMouseEnter={() => setHoveredAreaName(area.nameAr)}
                              onMouseLeave={() => setHoveredAreaName(null)}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectGov(gov.nameAr);
                              }}
                            >
                              <line
                                x1={gov.x}
                                y1={gov.y}
                                x2={ax}
                                y2={ay}
                                stroke={isLight ? "#0284c7" : "#38bdf8"}
                                strokeWidth="1"
                                strokeDasharray="2 2"
                                opacity="0.6"
                              />

                              <circle
                                cx={ax}
                                cy={ay}
                                r={isAreaHovered ? "9" : "7"}
                                fill={labCount > 0 ? "#0284c7" : (isLight ? "#cbd5e1" : "#475569")}
                                stroke="#ffffff"
                                strokeWidth="1.5"
                              />

                              <text
                                x={ax}
                                y={ay - 10}
                                textAnchor="middle"
                                fill={isAreaHovered ? (isLight ? "#0284c7" : "#38bdf8") : (isLight ? "#1e293b" : "#cbd5e1")}
                                fontSize="8.5"
                                fontWeight="700"
                                className="pointer-events-none"
                              >
                                {area.nameEn}
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Active Detail Tooltip Drawer */}
          {(hoveredGovObj || activeGovObj) && (
            <div className={`absolute bottom-4 right-4 z-20 w-80 rounded-xl border p-4 shadow-xl animate-in fade-in slide-in-from-bottom-3 duration-200 ${
              isLight ? "bg-white/95 text-slate-900 border-[#E6EDF1] backdrop-blur shadow-slate-300/50" : "bg-[#1F2A55]/95 text-white border-[#056FEC]/30 backdrop-blur"
            }`}>
              {(() => {
                const target = hoveredGovObj || activeGovObj;
                if (!target) return null;
                const stat = govStats[target.id] || { count: 0, capacity: 0, vendors: new Set(), valid: 0, issues: 0, verified: 0, labs: [] };
                return (
                  <div className="space-y-3">
                    <div className={`flex items-center justify-between border-b pb-2 ${isLight ? "border-[#E6EDF1]" : "border-[#182245]"}`}>
                      <div>
                        <div className={`text-base font-bold ${isLight ? "text-[#056FEC]" : "text-[#05ACFF]"}`}>
                          {target.nameEn} ({target.nameAr})
                        </div>
                        <div className={`text-[11px] ${isLight ? "text-[#597587]" : "text-[#85A5B9]"}`}>
                          Governorate & City Breakdown
                        </div>
                      </div>
                      <Badge className="bg-[#056FEC] text-white font-semibold">
                        {stat.count} Labs
                      </Badge>
                    </div>

                    <div className="space-y-1">
                      <span className={`text-[10px] font-bold uppercase tracking-wider block ${isLight ? "text-[#597587]" : "text-[#85A5B9]"}`}>
                        Districts & Cities ({target.areas.length})
                      </span>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                        {target.areas.map(a => {
                          const areaKey = `${target.nameAr}__${a.nameAr}`;
                          const aStat = areaStats[areaKey];
                          return (
                            <Badge
                              key={a.nameEn}
                              variant="outline"
                              className={`text-[10.5px] py-0.5 px-2 cursor-pointer transition-colors ${
                                aStat ? "border-[#056FEC]/50 text-[#056FEC] dark:text-[#05ACFF] bg-[#056FEC]/10" : "opacity-60"
                              }`}
                              onClick={() => onSelectGov(target.nameAr)}
                            >
                              {a.nameEn}: {aStat ? aStat.count : 0} labs
                            </Badge>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className={`rounded p-2 ${isLight ? "bg-[#F7FAFF]" : "bg-[#182245]"}`}>
                        <span className={`block text-[10px] ${isLight ? "text-[#597587]" : "text-[#85A5B9]"}`}>Total Capacity</span>
                        <span className="font-bold text-sm">{stat.capacity.toLocaleString()} Seats</span>
                      </div>
                      <div className={`rounded p-2 ${isLight ? "bg-[#F7FAFF]" : "bg-[#182245]"}`}>
                        <span className={`block text-[10px] ${isLight ? "text-[#597587]" : "text-[#85A5B9]"}`}>Active Vendors</span>
                        <span className="font-bold text-sm">{stat.vendors.size} Vendors</span>
                      </div>
                    </div>

                    <div className={`flex items-center justify-between text-xs pt-1 border-t ${isLight ? "border-[#E6EDF1]" : "border-[#182245]"}`}>
                      <span className={isLight ? "text-[#597587]" : "text-[#85A5B9]"}>Location Verification:</span>
                      <span className="font-semibold text-[#0EAA3A] flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {stat.verified} / {stat.count} Verified
                      </span>
                    </div>

                    <Button
                      size="sm"
                      className="w-full bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold text-xs mt-1"
                      onClick={() => onSelectGov(target.nameAr)}
                    >
                      Filter Labs for {target.nameEn}
                      <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
        )}
      </CardContent>
    </Card>
  );
}
