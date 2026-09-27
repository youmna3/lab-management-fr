import React from "react";

interface ISchoolLogoProps {
  variant?: "full" | "mark" | "white" | "white-mark" | "image";
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showText?: boolean;
  tagText?: string;
}

export function ISchoolLogo({
  variant = "full",
  size = "md",
  className = "",
  showText = true,
  tagText = "Labs B2G",
}: ISchoolLogoProps) {
  const heightPxMap = {
    sm: 26,
    md: 34,
    lg: 44,
    xl: 56,
  };

  const heightPx = heightPxMap[size] || 34;

  // Use official vector SVG logos from public folder
  let logoSrc = "/ischool-logo.svg";
  if (variant === "mark") {
    logoSrc = "/ischool-mark.svg";
  } else if (variant === "white") {
    logoSrc = "/ischool-logo-white.svg";
  } else if (variant === "white-mark") {
    logoSrc = "/ischool-mark-white.svg";
  }

  const isDarkVariant = variant === "white" || variant === "white-mark";

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      <img
        src={logoSrc}
        alt="iSchool Brand Logo"
        style={{ height: `${heightPx}px`, width: "auto" }}
        className="object-contain transition-transform duration-200 hover:scale-[1.02]"
        onError={(e) => {
          // Fallback to png if svg fails
          e.currentTarget.src = "/ischool-logo.png";
        }}
      />
      {(variant === "full" || variant === "white") && showText && tagText && (
        <span
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
            isDarkVariant
              ? "bg-white/15 text-white border border-white/20"
              : "bg-[#056FEC]/10 text-[#056FEC] dark:bg-[#05ACFF]/15 dark:text-[#05ACFF] border border-[#056FEC]/25"
          }`}
        >
          {tagText}
        </span>
      )}
    </div>
  );
}
