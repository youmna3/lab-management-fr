import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Tables } from "@/integrations/supabase/types";
import { formatEGP } from "@/lib/format";
import { fixMojibake } from "@/lib/sheet";
import { detectLabLocationAnomaly } from "@/lib/location-anomaly";

type Lab = Tables<"labs">;

interface RealEgyptLeafletMapProps {
  labs: Lab[];
  selectedGov?: string;
  onSelectGov: (govName: string) => void;
  anomaliesOnly?: boolean;
  selectedLabId?: string | null;
  onSelectLab?: (lab: Lab) => void;
  className?: string;
}

// Approximate lat/lng center coordinates for Egypt's 27 governorates
const GOV_LAT_LNG: Record<string, [number, number]> = {
  القاهرة: [30.0444, 31.2357],
  الجيزة: [30.0131, 31.2089],
  الإسكندرية: [31.2001, 29.9187],
  الاسكندرية: [31.2001, 29.9187],
  القليوبية: [30.4167, 31.2167],
  الغربية: [30.7885, 31.0019],
  الشرقية: [30.5877, 31.502],
  الدقهلية: [31.0409, 31.3785],
  المنوفية: [30.5972, 30.9876],
  البحيرة: [31.0364, 30.4688],
  "كفر الشيخ": [31.1107, 30.9388],
  دمياط: [31.4175, 31.8144],
  "بور سعيد": [31.2653, 32.3019],
  بورسعيد: [31.2653, 32.3019],
  الإسماعيلية: [30.5965, 32.2715],
  الاسماعيلية: [30.5965, 32.2715],
  السويس: [29.9668, 32.5498],
  الفيوم: [29.3084, 30.8428],
  "بني سويف": [29.0661, 31.0994],
  المنيا: [28.1099, 30.7503],
  أسيوط: [27.1783, 31.1859],
  اسيوط: [27.1783, 31.1859],
  سوهاج: [26.559, 31.6957],
  قنا: [26.1551, 32.716],
  الأقصر: [25.6872, 32.6396],
  الاقصر: [25.6872, 32.6396],
  أسوان: [24.0889, 32.8998],
  اسوان: [24.0889, 32.8998],
  "البحر الأحمر": [27.2579, 33.8116],
  "البحر الاحمر": [27.2579, 33.8116],
  "الوادي الجديد": [25.4514, 30.5464],
  مطروح: [31.3543, 27.2373],
  "شمال سيناء": [31.1316, 33.7984],
  "جنوب سيناء": [27.9158, 34.3299],
};

export function RealEgyptLeafletMap({
  labs,
  selectedGov,
  onSelectGov,
  anomaliesOnly = false,
  selectedLabId,
  onSelectLab,
  className,
}: RealEgyptLeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Egypt Center coordinates [lat, lng], default zoom level 6
    const map = L.map(containerRef.current, {
      center: [27.0, 30.8],
      zoom: 6,
      zoomControl: true,
    });

    // CartoDB Voyager tiles (High contrast, modern, crisp street details)
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
        maxZoom: 19,
        subdomains: "abcd",
      }
    ).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);
    markersGroupRef.current = markersGroup;
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. Render Lab Markers & Anomaly Badges
  useEffect(() => {
    const map = mapRef.current;
    const markersGroup = markersGroupRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();

    const labsToRender = (labs || []).filter((l) => {
      if (anomaliesOnly) {
        const anomaly = detectLabLocationAnomaly(l);
        if (!anomaly) return false;
      }
      if (selectedGov && selectedGov !== "all") {
        return (l.gov || "").trim() === selectedGov.trim();
      }
      return true;
    });

    const bounds: [number, number][] = [];

    labsToRender.forEach((lab, idx) => {
      // Use lat/lng if available, or offset governorate center coordinates
      let lat = lab.lat;
      let lng = lab.lng;

      if (!lat || !lng) {
        const govName = (lab.gov || "").trim();
        const baseCoords = GOV_LAT_LNG[govName] || [30.0444, 31.2357];
        // Apply slight spiral offset so overlapping labs in the same city split apart nicely
        const angle = idx * 0.7;
        const radius = 0.012 * (1 + idx * 0.05);
        lat = baseCoords[0] + Math.sin(angle) * radius;
        lng = baseCoords[1] + Math.cos(angle) * radius;
      }

      bounds.push([lat, lng]);

      const anomaly = detectLabLocationAnomaly(lab);
      const isSelected = selectedLabId === lab.id;

      // Determine pin color: Red = Anomaly, iSchool Blue = Verified, iSchool Orange = Unverified
      const pinColor = anomaly
        ? anomaly.severity === "critical"
          ? "#DE1F1F"
          : "#FF7F1C"
        : lab.maps_verified
        ? "#056FEC"
        : "#FF7F1C";

      // Custom SVG Marker Icon
      const customIcon = L.divIcon({
        className: "custom-leaflet-marker",
        html: `
          <div style="
            background-color: ${isSelected ? "#056FEC" : pinColor};
            width: ${isSelected ? "34px" : "28px"};
            height: ${isSelected ? "34px" : "28px"};
            border-radius: 50%;
            border: ${isSelected ? "3px solid #FF7F1C" : "2.5px solid white"};
            box-shadow: ${isSelected ? "0 0 14px rgba(255, 127, 28, 0.8), 0 4px 10px rgba(0,0,0,0.3)" : "0 4px 10px rgba(0,0,0,0.3)"};
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: ${isSelected ? "13px" : "11px"};
            cursor: pointer;
            transition: all 0.2s ease;
          ">
            ${anomaly ? "!" : "📍"}
          </div>
        `,
        iconSize: isSelected ? [34, 34] : [28, 28],
        iconAnchor: isSelected ? [17, 17] : [14, 14],
      });

      const marker = L.marker([lat, lng], { icon: customIcon });

      marker.on("click", () => {
        if (onSelectLab) onSelectLab(lab);
      });

      const nameDecoded = fixMojibake(lab.name);
      const centerDecoded = fixMojibake(lab.center_name);
      const govDecoded = fixMojibake(lab.gov);
      const areaDecoded = fixMojibake(lab.area);

      const popupContent = `
        <div style="font-family: system-ui, sans-serif; padding: 4px; max-width: 240px; dir: auto;">
          <div style="font-size: 13px; font-weight: 700; color: #1F2A55; margin-bottom: 2px;">
            ${nameDecoded}
          </div>
          <div style="font-size: 11px; color: #597587; margin-bottom: 6px;">
            📍 ${govDecoded} — ${areaDecoded || "Main Area"}
          </div>

          ${
            centerDecoded
              ? `<div style="font-size: 11px; font-weight: 600; color: #056FEC; margin-bottom: 4px;">
                  🏢 Center: ${centerDecoded}
                </div>`
              : ""
          }

          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 6px; padding: 4px 6px; background: #F7FAFF; border: 1px solid #E6EDF1; border-radius: 6px;">
            <span>Seats: <strong>${lab.capacity || 0}</strong></span>
            <span>Price: <strong style="color: #056FEC;">${formatEGP(lab.session_price)}</strong></span>
          </div>

          ${
            anomaly
              ? `<div style="font-size: 10px; font-weight: 600; color: #AA1818; background: #FFD1D1; padding: 4px 6px; border-radius: 4px; border: 1px solid #DE1F1F; margin-bottom: 6px;">
                  ⚠️ ${anomaly.title}: ${anomaly.description}
                </div>`
              : ""
          }

          ${
            lab.maps_url
              ? `<a href="${lab.maps_url}" target="_blank" rel="noreferrer" style="
                  display: block;
                  text-align: center;
                  background-color: #056FEC;
                  color: white;
                  font-size: 11px;
                  font-weight: 600;
                  padding: 5px;
                  border-radius: 6px;
                  text-decoration: none;
                ">
                  🗺️ Open in Google Maps
                </a>`
              : `<div style="font-size: 10px; color: #DE1F1F; text-align: center;">No map URL provided</div>`
          }
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.addTo(markersGroup);
    });

    // Auto-fit camera bounds to rendered labs
    if (bounds.length > 0) {
      if (selectedGov && selectedGov !== "all") {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
      }
    }

    if (selectedLabId) {
      const target = labsToRender.find((l) => l.id === selectedLabId);
      if (target) {
        let tLat = target.lat;
        let tLng = target.lng;
        if (!tLat || !tLng) {
          const baseCoords = GOV_LAT_LNG[(target.gov || "").trim()] || [30.0444, 31.2357];
          tLat = baseCoords[0];
          tLng = baseCoords[1];
        }
        map.panTo([tLat, tLng], { animate: true, duration: 0.5 });
      }
    }
  }, [labs, selectedGov, anomaliesOnly, selectedLabId]);

  return (
    <div
      ref={containerRef}
      className={className || "w-full h-[520px] rounded-xl overflow-hidden border border-border/70 shadow-inner"}
      style={{ zIndex: 0 }}
    />
  );
}
