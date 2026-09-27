import React from "react";

export type BrandIconName =
  | "home"
  | "module"
  | "1_Module"
  | "alert"
  | "checkmark"
  | "flags"
  | "hr_requests"
  | "users"
  | "upload"
  | "image_upload"
  | "inprogress"
  | "meeting"
  | "timeline"
  | "not_finished"
  | "not_started"
  | "project"
  | "quiz"
  | "quality"
  | "process_on"
  | "allocation";

const ICON_MAP: Record<BrandIconName, string> = {
  home: "/icons/Home.svg",
  module: "/icons/1_Module.svg",
  "1_Module": "/icons/1_Module.svg",
  alert: "/icons/Alert.svg",
  checkmark: "/icons/Checkmark.svg",
  flags: "/icons/Flags.svg",
  hr_requests: "/icons/HR_Requests.svg",
  users: "/icons/HR_Requests.svg",
  upload: "/icons/Image_Upload_Icon.svg",
  image_upload: "/icons/Image_Upload_Icon.svg",
  inprogress: "/icons/Inprogress.svg",
  meeting: "/icons/Meeting.svg",
  timeline: "/icons/Meeting.svg",
  not_finished: "/icons/Not_Finished.svg",
  not_started: "/icons/Not_Started.svg",
  project: "/icons/Project.svg",
  quiz: "/icons/Quiz.svg",
  quality: "/icons/Quiz.svg",
  process_on: "/icons/process_on.svg",
  allocation: "/icons/process_on.svg",
};

interface BrandIconProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  name: BrandIconName;
  size?: number | string;
  className?: string;
  alt?: string;
}

export function BrandIcon({
  name,
  size = 20,
  className = "",
  alt,
  ...props
}: BrandIconProps) {
  const src = ICON_MAP[name] || `/icons/${name}.svg`;
  const dimension = typeof size === "number" ? `${size}px` : size;

  return (
    <img
      src={src}
      alt={alt || `${name} icon`}
      width={dimension}
      height={dimension}
      style={{ width: dimension, height: dimension, minWidth: dimension, minHeight: dimension }}
      className={`inline-block object-contain select-none shrink-0 ${className}`}
      loading="lazy"
      {...props}
    />
  );
}
