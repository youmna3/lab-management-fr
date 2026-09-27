"""
SUPERSEDED — kept only for reference. Nothing in the app calls this script
anymore.

This script was invoked by src/server/allocation-vite-plugin.ts, a Vite
dev-server-only plugin (`vite dev` only — never part of the production
build) that spawned `python3` as a subprocess. The app deploys to Cloudflare
Workers, which cannot spawn subprocesses, touch the filesystem, or run
Python, so this pipeline never actually ran in production; the "Run Lab
Allocation Pipeline" button just got the SPA shell back instead of JSON.

The full algorithm below (schedule resolution, per-area ILP, balanced
distribution, master allocation, summaries, Excel export) has been ported to
TypeScript in src/lib/lab-allocation-runner/ and now runs entirely
client-side, in the browser, with no server or Python dependency. See
src/lib/allocation-client.ts for the new entry point.

Lab Allocation Pipeline — script version (v4) with Dynamic Batch Time Slots & Optional Overfill Layer

Features:
- Dynamically accepts 1, 2, 3, 4 (or any) batch time slots from Project Batch configuration.
- Falls back to the standard 7-slot (4 Thursday + 3 Friday) schedule when no custom slots are provided.
- Preserves 100% of the exact mathematical optimization logic, multi-sheet scanner, and output generation.
- Fully supports optional overfill (+2 max per lab) and preferred lab requests.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

try:
    import pulp
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pulp", "--break-system-packages", "-q"])
    import pulp


# ------------------------------------------------------------------------
# Constants & Default Schedule
# ------------------------------------------------------------------------

GROUP_ID_PREFIX = "Physical-DS-G"

DEFAULT_SLOT_INFO: List[Tuple[str, str, str, int]] = [
    ("Thu 9 AM", "Thursday", "Morning", 1),
    ("Thu 12 PM", "Thursday", "Afternoon", 2),
    ("Thu 3 PM", "Thursday", "Afternoon", 3),
    ("Thu 6 PM", "Thursday", "Evening", 4),
    ("Fri 9 AM", "Friday", "Morning", 5),
    ("Fri 3 PM", "Friday", "Afternoon", 6),
    ("Fri 6 PM", "Friday", "Evening", 7),
]


def format_custom_time_label(raw_time: str) -> str:
    """Formats 24h or arbitrary string into a readable label, e.g. '10:00' -> '10:00 AM'."""
    raw = str(raw_time).strip()
    if not raw:
        return "Slot"
    if "AM" in raw.upper() or "PM" in raw.upper():
        return raw

    import re
    m = re.match(r"^(\d{1,2}):(\d{2})$", raw)
    if m:
        hh = int(m.group(1))
        mm = int(m.group(2))
        period = "PM" if hh >= 12 else "AM"
        display_h = hh % 12 or 12
        return f"{display_h}:{mm:02d} {period}"
    return raw


def infer_session_shift(raw_time: str) -> Tuple[str, str]:
    """Infers Day ('Thursday' / 'Friday') and Shift ('Morning', 'Afternoon', 'Evening', 'Night')."""
    raw_lower = str(raw_time).lower()
    day = "Thursday"
    if "fri" in raw_lower or "friday" in raw_lower:
        day = "Friday"
    elif "sat" in raw_lower or "saturday" in raw_lower:
        day = "Saturday"
    elif "sun" in raw_lower or "sunday" in raw_lower:
        day = "Sunday"
    elif "wed" in raw_lower or "wednesday" in raw_lower:
        day = "Wednesday"

    import re
    m = re.search(r"(\d{1,2})(?::(\d{2}))?", raw_lower)
    if m:
        hh = int(m.group(1))
        if "pm" in raw_lower and hh < 12:
            hh += 12
        elif "am" in raw_lower and hh == 12:
            hh = 0
        if hh < 12:
            shift = "Morning"
        elif hh < 16:
            shift = "Afternoon"
        elif hh < 19:
            shift = "Evening"
        else:
            shift = "Night"
        return day, shift
    return day, "Session"


def resolve_slot_schedule(custom_slots: Optional[List[Any]] = None) -> List[Tuple[str, str, str, int]]:
    """
    Returns dynamic slot info: List of (label, day, shift, slot_num).
    - If custom_slots is provided and non-empty (1 to 4 slots, or any list),
      builds dynamic slots corresponding to those exact slots.
    - If custom_slots is None or empty, falls back to DEFAULT_SLOT_INFO (7-slot Thursday/Friday split).
    """
    if not custom_slots:
        return list(DEFAULT_SLOT_INFO)

    slots: List[Tuple[str, str, str, int]] = []
    slot_num = 1
    for item in custom_slots:
        if isinstance(item, dict):
            label = str(item.get("label") or item.get("time") or f"Slot {slot_num}")
            day = str(item.get("day") or "Thursday")
            shift = str(item.get("session") or item.get("shift") or "Morning")
            num = int(item.get("num", slot_num))
            slots.append((label, day, shift, num))
            slot_num += 1
        elif isinstance(item, (str, int)):
            raw_str = str(item).strip()
            if not raw_str:
                continue
            label = format_custom_time_label(raw_str)
            day, shift = infer_session_shift(raw_str)
            slots.append((label, day, shift, slot_num))
            slot_num += 1

    if not slots:
        return list(DEFAULT_SLOT_INFO)
    return slots


# ------------------------------------------------------------------------
# File loading -- content-based, scans all sheets in Excel
# ------------------------------------------------------------------------

def normalize_header(h: Any) -> str:
    """Strips all special characters, brackets, curly braces, spaces, hyphens, and lowercases."""
    import re
    return re.sub(r"[^a-zA-Z0-9]", "", str(h)).lower()


def find_sheet_with_columns(path: Path | str, required_cols: List[str], aliases: Optional[Dict[str, str]] = None) -> pd.DataFrame:
    aliases = aliases or {}
    path = Path(path)
    if path.suffix.lower() == ".csv":
        df = pd.read_csv(path)
        df = df.loc[:, ~df.columns.duplicated(keep="first")].copy()
        df = df.rename(columns=aliases)
        missing = [c for c in required_cols if c not in df.columns]
        if missing:
            raise ValueError(f"{path.name}: missing required column(s) {missing}. Found: {list(df.columns)}")
        return df

    xl = pd.ExcelFile(path)
    tried = []
    for sheet in xl.sheet_names:
        df = xl.parse(sheet)
        df = df.loc[:, ~df.columns.duplicated(keep="first")].copy()
        df = df.rename(columns=aliases)
        if all(c in df.columns for c in required_cols):
            return df
        tried.append((sheet, list(df.columns)))

    for sheet in xl.sheet_names:
        df = xl.parse(sheet)
        df = df.loc[:, ~df.columns.duplicated(keep="first")].copy()
        fuzzy_map = {}
        for c in df.columns:
            c_str = str(c).strip()
            c_norm = normalize_header(c_str)
            c_lower = c_str.lower()
            if "S_ID" in required_cols and "S_ID" not in fuzzy_map.values():
                if c_norm in ("sid", "studentid", "stuid", "studentno", "studentcode", "stdid", "id") or \
                   "s_id" in c_lower or "student_id" in c_lower or "student id" in c_lower:
                    fuzzy_map[c] = "S_ID"
            if "Grade" in required_cols and "Grade" not in fuzzy_map.values():
                if "grade" in c_norm or "class" in c_norm or "cohort" in c_norm or "level" in c_norm:
                    fuzzy_map[c] = "Grade"
            if "Physical Area" in required_cols and "Physical Area" not in fuzzy_map.values():
                if "physical" in c_lower and "area" in c_lower:
                    fuzzy_map[c] = "Physical Area"
                elif c_norm == "area" or c_lower in ("area", "location", "governorate", "gov"):
                    fuzzy_map[c] = "Physical Area"
            if "Lab ID" in required_cols and "Lab ID" not in fuzzy_map.values():
                if ("lab" in c_norm and ("id" in c_norm or "code" in c_norm or "name" in c_norm or c_norm == "lab")) or c_norm in ("labid", "lab", "labcode", "id"):
                    fuzzy_map[c] = "Lab ID"
            if "Area" in required_cols and "Area" not in fuzzy_map.values():
                if "physical" in c_lower and "area" in c_lower:
                    fuzzy_map[c] = "Area"
                elif c_norm == "area" or c_lower in ("area", "location", "governorate", "gov"):
                    fuzzy_map[c] = "Area"
            if "Lab Capacity" in required_cols and "Lab Capacity" not in fuzzy_map.values():
                if "cap" in c_norm or "seat" in c_norm or "size" in c_norm or "max" in c_norm or "limit" in c_norm:
                    fuzzy_map[c] = "Lab Capacity"

        df_fuzzy = df.rename(columns=fuzzy_map)
        df_fuzzy = df_fuzzy.loc[:, ~df_fuzzy.columns.duplicated(keep="first")].copy()
        if all(c in df_fuzzy.columns for c in required_cols):
            return df_fuzzy

    detail = "\n".join(f"  - sheet '{s}': columns {c}" for s, c in tried)
    raise ValueError(f"No sheet in {path.name} contains all required columns {required_cols}.\nSheets checked:\n{detail}")


def load_students(path: Path | str) -> pd.DataFrame:
    aliases = {
        "{{S_ID}}": "S_ID",
        "Grade(25-26)": "Grade",
        "Student ID": "S_ID",
        "Student_ID": "S_ID",
        "SID": "S_ID",
        "Physical_Area": "Physical Area",
        "Area": "Physical Area",
    }
    df = find_sheet_with_columns(path, required_cols=["S_ID", "Grade", "Physical Area"], aliases=aliases)

    sid_s = df["S_ID"]
    if isinstance(sid_s, pd.DataFrame):
        sid_s = sid_s.iloc[:, 0]

    grade_s = df["Grade"]
    if isinstance(grade_s, pd.DataFrame):
        grade_s = grade_s.iloc[:, 0]

    area_s = df["Physical Area"]
    if isinstance(area_s, pd.DataFrame):
        area_s = area_s.iloc[:, 0]

    def clean_grade(g: Any) -> int | None:
        import re
        g_str = str(g).strip().upper()
        m = re.search(r'(?:GRADE|G|CLASS|LEVEL)?\s*([1-9]|1[0-2])(?![0-9])', g_str)
        if m:
            return int(m.group(1))
        digits = "".join([ch for ch in g_str if ch.isdigit()])
        if digits:
            return int(digits)
        return None

    clean_df = pd.DataFrame({
        "S_ID": sid_s.astype(str).str.strip(),
        "Grade": grade_s.apply(clean_grade),
        "Physical Area": area_s.astype(str).str.strip(),
    })

    clean_df = clean_df.dropna(subset=["S_ID", "Grade", "Physical Area"]).reset_index(drop=True)
    clean_df["Grade"] = clean_df["Grade"].astype(int)
    return clean_df


def load_lab_capacity(path: Path | str, log=print) -> pd.DataFrame:
    aliases = {
        "Lab_ID": "Lab ID",
        "LAB ID": "Lab ID",
        "Physical Area": "Area",
        "Physical_Area": "Area",
        "Lab_Capacity": "Lab Capacity",
        "Capacity": "Lab Capacity",
        "Seats": "Lab Capacity",
    }
    df = find_sheet_with_columns(path, required_cols=["Lab ID", "Area", "Lab Capacity"], aliases=aliases)

    lab_s = df["Lab ID"]
    if isinstance(lab_s, pd.DataFrame):
        lab_s = lab_s.iloc[:, 0]

    area_s = df["Area"]
    if isinstance(area_s, pd.DataFrame):
        area_s = area_s.iloc[:, 0]

    cap_s = df["Lab Capacity"]
    if isinstance(cap_s, pd.DataFrame):
        cap_s = cap_s.iloc[:, 0]

    clean_df = pd.DataFrame({
        "Lab ID": lab_s.astype(str).str.strip(),
        "Area": area_s.astype(str).str.strip(),
        "Lab Capacity": pd.to_numeric(cap_s, errors="coerce"),
    })

    clean_df = clean_df.dropna(subset=["Lab ID", "Area", "Lab Capacity"]).copy()
    clean_df["Lab Capacity"] = clean_df["Lab Capacity"].astype(int)

    n_before = len(clean_df)
    clean_df = clean_df.drop_duplicates(subset=["Lab ID"]).reset_index(drop=True)
    if len(clean_df) < n_before:
        log(f"WARNING: {n_before - len(clean_df)} duplicate Lab ID row(s) in the lab file -- kept the first occurrence of each.")
    return clean_df


def parse_preferences(preferences_input: Any) -> Dict[str, Any]:
    """Parses preferences dictionary or JSON file path."""
    if not preferences_input:
        return {"overfillRules": [], "preferredLabRules": [], "extraLabs": [], "customSlots": []}
    if isinstance(preferences_input, dict):
        return {
            "overfillRules": preferences_input.get("overfillRules", []),
            "preferredLabRules": preferences_input.get("preferredLabRules", []),
            "extraLabs": preferences_input.get("extraLabs", []),
            "customSlots": preferences_input.get("customSlots") or preferences_input.get("slots") or preferences_input.get("timeSlots") or [],
        }
    if isinstance(preferences_input, (str, Path)):
        p = Path(preferences_input)
        if p.exists() and p.is_file():
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
                return parse_preferences(data)
        try:
            data = json.loads(str(preferences_input))
            return parse_preferences(data)
        except Exception:
            return {"overfillRules": [], "preferredLabRules": [], "extraLabs": [], "customSlots": []}
    return {"overfillRules": [], "preferredLabRules": [], "extraLabs": [], "customSlots": []}


def build_full_session_grid(
    lab_df: pd.DataFrame,
    extra_labs: Optional[List[Dict[str, Any]]] = None,
    slot_info: Optional[List[Tuple[str, str, str, int]]] = None,
) -> pd.DataFrame:
    """Expands each physical lab into sessions according to slot_info."""
    slots = slot_info if slot_info else DEFAULT_SLOT_INFO
    all_labs = lab_df.copy()
    if extra_labs:
        extra_rows = []
        for extra in extra_labs:
            lab_id = str(extra.get("labId", "")).strip()
            area = str(extra.get("area", "")).strip()
            capacity = int(extra.get("capacity", 25))
            if lab_id and area and lab_id not in all_labs["Lab ID"].values:
                extra_rows.append({"Lab ID": lab_id, "Area": area, "Lab Capacity": capacity})
        if extra_rows:
            all_labs = pd.concat([all_labs, pd.DataFrame(extra_rows)], ignore_index=True)

    rows = []
    for _, r in all_labs.iterrows():
        for label, day, shift, num in slots:
            rows.append({
                "Lab ID": r["Lab ID"],
                "Area": r["Area"],
                "True_Capacity": int(r["Lab Capacity"]),
                "Day": day,
                "Session": shift,
                "Slot_Num": num,
                "Slot_Label": label,
            })
    df = pd.DataFrame(rows)
    df["Slot_Key"] = df["Lab ID"] + "_" + df["Slot_Num"].astype(str)
    return df


# ------------------------------------------------------------------------
# Per-Area ILP Optimizer (Exact Original Logic + Optional Overfill/Preferences)
# ------------------------------------------------------------------------

def ilp_allocate_area(
    area_sessions: pd.DataFrame,
    grade_counts: Dict[int, int],
    preferences: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, int], Dict[int, int]]:
    """Exact optimizer, one grade per session, minimizes total unseated students."""
    slot_keys = area_sessions["Slot_Key"].tolist()
    cap = dict(zip(area_sessions["Slot_Key"], area_sessions["True_Capacity"]))
    lab_ids_by_slot = dict(zip(area_sessions["Slot_Key"], area_sessions["Lab ID"]))
    slot_nums_by_slot = dict(zip(area_sessions["Slot_Key"], area_sessions["Slot_Num"]))
    grades = list(grade_counts.keys())
    area_name = area_sessions["Area"].iloc[0]

    overfill_rules = preferences.get("overfillRules", []) if preferences else []
    preferred_rules = preferences.get("preferredLabRules", []) if preferences else []

    slot_overfill_cap = {}
    if overfill_rules:
        for s in slot_keys:
            lab_id = lab_ids_by_slot[s]
            allowance = 0
            for rule in overfill_rules:
                r_area = str(rule.get("area", "")).strip()
                if r_area == "ALL" or r_area.lower() == area_name.lower():
                    r_labs = [str(x).strip().lower() for x in rule.get("labIds", [])]
                    if "all" in r_labs or lab_id.lower() in r_labs or not r_labs:
                        allowance = max(allowance, min(2, int(rule.get("maxOverfillPerLab", 2))))
            slot_overfill_cap[s] = allowance

    has_overfill = any(v > 0 for v in slot_overfill_cap.values())
    has_preferred = len(preferred_rules) > 0

    # PURE ORIGINAL ILP FORMULATION (When no preferences active)
    if not has_overfill and not has_preferred:
        prob = pulp.LpProblem("slot_allocation", pulp.LpMinimize)
        x = {(s, g): pulp.LpVariable(f"x_{s}_{g}", cat="Binary") for s in slot_keys for g in grades}
        shortfall = {g: pulp.LpVariable(f"short_{g}", lowBound=0) for g in grades}

        for s in slot_keys:
            prob += pulp.lpSum(x[(s, g)] for g in grades) <= 1
        for g in grades:
            assigned_capacity = pulp.lpSum(x[(s, g)] * cap[s] for s in slot_keys)
            prob += assigned_capacity + shortfall[g] >= grade_counts[g]
        prob += pulp.lpSum(shortfall[g] for g in grades) + pulp.lpSum(0.0001 * x[(s, g)] for s in slot_keys for g in grades)
        solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=15, gapRel=0.01, threads=4)
        prob.solve(solver)

        slot_assignment = {}
        for s in slot_keys:
            for g in grades:
                if pulp.value(x[(s, g)]) and pulp.value(x[(s, g)]) > 0.5:
                    slot_assignment[s] = g
        per_grade_shortfall = {g: max(0, round(pulp.value(shortfall[g]))) for g in grades}
        return slot_assignment, per_grade_shortfall

    # PREFERENCE / OVERFILL EXTENDED FORMULATION
    prob = pulp.LpProblem(f"slot_allocation_{area_name}", pulp.LpMinimize)
    x = {(s, g): pulp.LpVariable(f"x_{s}_{g}", cat="Binary") for s in slot_keys for g in grades}
    shortfall = {g: pulp.LpVariable(f"short_{g}", lowBound=0) for g in grades}
    overfill = {}

    for s in slot_keys:
        for g in grades:
            max_of = slot_overfill_cap.get(s, 0)
            if max_of > 0:
                overfill[(s, g)] = pulp.LpVariable(f"of_{s}_{g}", lowBound=0, upBound=max_of)
                prob += overfill[(s, g)] <= x[(s, g)] * max_of

    for s in slot_keys:
        prob += pulp.lpSum(x[(s, g)] for g in grades) <= 1

    for g in grades:
        assigned_capacity = pulp.lpSum(
            x[(s, g)] * cap[s] + (overfill[(s, g)] if (s, g) in overfill else 0)
            for s in slot_keys
        )
        prob += assigned_capacity + shortfall[g] >= grade_counts[g]

    obj_terms = [100000 * pulp.lpSum(shortfall[g] for g in grades)]
    if overfill:
        obj_terms.append(100 * pulp.lpSum(overfill[(s, g)] for (s, g) in overfill))

    # Tie-breaker to prevent symmetry plateaus
    obj_terms.append(0.001 * pulp.lpSum(x[(s, g)] for s in slot_keys for g in grades))

    for pref in preferred_rules:
        p_area = str(pref.get("area", "")).strip()
        if p_area == "ALL" or p_area.lower() == area_name.lower():
            p_lab = str(pref.get("labId", "")).strip().lower()
            p_grades = pref.get("grades", [])
            p_slot = pref.get("slotNum")
            for s in slot_keys:
                if lab_ids_by_slot[s].lower() == p_lab:
                    if p_slot is None or slot_nums_by_slot[s] == int(p_slot):
                        for g in grades:
                            if not p_grades or g in p_grades or str(g) in [str(item) for item in p_grades]:
                                obj_terms.append(-500 * x[(s, g)])

    prob += pulp.lpSum(obj_terms)
    solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=15, gapRel=0.01, threads=4)
    prob.solve(solver)

    slot_assignment = {}
    for s in slot_keys:
        for g in grades:
            if pulp.value(x[(s, g)]) and pulp.value(x[(s, g)]) > 0.5:
                slot_assignment[s] = g
    per_grade_shortfall = {g: max(0, round(pulp.value(shortfall[g]))) for g in grades}
    return slot_assignment, per_grade_shortfall


def run_ilp_all_areas(
    sessions_df: pd.DataFrame,
    students_df: pd.DataFrame,
    log,
    preferences: Optional[Dict[str, Any]] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, List[Dict[str, Any]], int]:
    allocated_rows = []
    total_true_shortfall = 0
    shortfall_report = []
    shortfall_math_rows = []

    log(f"Running per-area ILP across {sessions_df['Area'].nunique()} area(s), {len(sessions_df)} session(s) total...")

    for area, area_sessions in sessions_df.groupby("Area"):
        counts = students_df[students_df["Physical Area"] == area].groupby("Grade").size().to_dict()
        if not counts:
            continue
        slot_assignment, per_grade_shortfall = ilp_allocate_area(area_sessions, counts, preferences)
        for slot_key, grade in slot_assignment.items():
            row = area_sessions[area_sessions["Slot_Key"] == slot_key].iloc[0].to_dict()
            row["Grade"] = grade
            allocated_rows.append({
                k: row[k] for k in ["Lab ID", "Area", "Grade", "Day", "Session", "True_Capacity", "Slot_Key", "Slot_Num", "Slot_Label"]
                if k in row
            })

        cap_by_slot = dict(zip(area_sessions["Slot_Key"], area_sessions["True_Capacity"]))
        for g, demand in counts.items():
            slots_g = [s for s, gg in slot_assignment.items() if gg == g]
            sessions_given = len(slots_g)
            capacity_given = sum(cap_by_slot[s] for s in slots_g)
            short = per_grade_shortfall.get(g, 0)
            shortfall_math_rows.append({
                "Area": area, "Grade": g, "Demand": int(demand),
                "Sessions_Assigned": sessions_given, "Capacity_Assigned": capacity_given,
                "Students_Short": short
            })
            if short > 0:
                total_true_shortfall += short
                shortfall_report.append({
                    "Area": area, "Grade": g, "Students_Short": short,
                    "Reason": "Not enough true session capacity in this area to fit all grades"
                })

    sessions_df_augmented = pd.DataFrame(allocated_rows).rename(
        columns={"Lab ID": "Lab_ID", "True_Capacity": "Lab_Capacity"}
    )
    shortfall_math_df = pd.DataFrame(shortfall_math_rows)

    log(f"Sessions assigned a grade: {len(sessions_df_augmented)} / {len(sessions_df)}")
    if shortfall_report:
        log(f"TRUE mathematically-unavoidable shortfall: {total_true_shortfall} students")
    else:
        log("No shortfall -- every student fits given true capacity.")

    return sessions_df_augmented, shortfall_math_df, shortfall_report, total_true_shortfall


# ------------------------------------------------------------------------
# Balanced Distribution within each Grade's Assigned Sessions
# ------------------------------------------------------------------------

def balanced_distribute(
    total_students: int,
    slots_group: pd.DataFrame,
    slot_overfill_caps: Optional[Dict[str, int]] = None,
) -> Tuple[Dict[str, int], int]:
    slots_group = slots_group.drop_duplicates(subset="Slot_Key").copy()
    num_slots = len(slots_group)
    if num_slots == 0:
        return {}, total_students

    slots_group = slots_group.sort_values("Lab_Capacity", ascending=False).reset_index(drop=True)
    base_size = total_students // num_slots
    remainder = total_students % num_slots

    target = {}
    for i, row in slots_group.iterrows():
        target[row["Slot_Key"]] = base_size + (1 if i < remainder else 0)

    capacity = dict(zip(slots_group["Slot_Key"], slots_group["Lab_Capacity"]))
    effective_cap = {}
    for k in target:
        c = capacity[k]
        if slot_overfill_caps and k in slot_overfill_caps:
            c += slot_overfill_caps[k]
        effective_cap[k] = c

    assigned = {k: 0 for k in target}
    surplus = 0
    for key in assigned:
        want, cap_val = target[key], effective_cap[key]
        give = min(want, cap_val)
        assigned[key] = give
        surplus += (want - give)

    if surplus > 0:
        changed = True
        while surplus > 0 and changed:
            changed = False
            room = {k: effective_cap[k] - assigned[k] for k in assigned if effective_cap[k] - assigned[k] > 0}
            if not room:
                break
            for key in sorted(room, key=lambda k: assigned[k]):
                if surplus <= 0:
                    break
                if effective_cap[key] - assigned[key] > 0:
                    assigned[key] += 1
                    surplus -= 1
                    changed = True
    return assigned, surplus


def run_group_optimization(
    students_df: pd.DataFrame,
    sessions_df_augmented: pd.DataFrame,
    preferences: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[Tuple[str, int], Dict[str, int]], List[Dict[str, Any]]]:
    overfill_rules = preferences.get("overfillRules", []) if preferences else []

    assignment_plan = {}
    unassigned_log = []

    for (area, grade), students_sub in students_df.groupby(["Physical Area", "Grade"]):
        total_students = len(students_sub)
        slots_group = sessions_df_augmented[
            (sessions_df_augmented["Area"] == area) & (sessions_df_augmented["Grade"] == grade)
        ]

        slot_overfill_caps = {}
        if overfill_rules:
            for _, r in slots_group.iterrows():
                s_key = r["Slot_Key"]
                lab_id = r["Lab_ID"]
                allowance = 0
                for rule in overfill_rules:
                    r_area = str(rule.get("area", "")).strip()
                    if r_area == "ALL" or r_area.lower() == str(area).lower():
                        r_labs = [str(x).strip().lower() for x in rule.get("labIds", [])]
                        if "all" in r_labs or lab_id.lower() in r_labs or not r_labs:
                            allowance = max(allowance, min(2, int(rule.get("maxOverfillPerLab", 2))))
                slot_overfill_caps[s_key] = allowance

        assigned, leftover = balanced_distribute(total_students, slots_group, slot_overfill_caps)
        assignment_plan[(area, grade)] = assigned
        if leftover > 0:
            unassigned_log.append({
                "Area": area, "Grade": grade, "Total_Students": total_students,
                "Total_Capacity": int(slots_group["Lab_Capacity"].sum()), "Unassigned_Count": leftover
            })

    return assignment_plan, unassigned_log


# ------------------------------------------------------------------------
# Master Allocation + Unassigned Generation
# ------------------------------------------------------------------------

def generate_master_allocation(
    students_df: pd.DataFrame,
    sessions_df_augmented: pd.DataFrame,
    assignment_plan: Dict[Tuple[str, int], Dict[str, int]],
    group_id_prefix: str = GROUP_ID_PREFIX,
    slot_info: Optional[List[Tuple[str, str, str, int]]] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    master_rows, unassigned_rows = [], []
    slot_id_counter = 1
    slot_lookup = sessions_df_augmented.drop_duplicates(subset="Slot_Key").set_index("Slot_Key")
    slot_group_id = {}

    slot_labels = {num: label for label, day, shift, num in (slot_info or DEFAULT_SLOT_INFO)}

    for (area, grade), students_sub in students_df.groupby(["Physical Area", "Grade"]):
        students_sub = students_sub.sort_values("S_ID").reset_index(drop=True)
        slot_counts = assignment_plan.get((area, grade), {})

        slot_queue = []
        for slot_key, count in slot_counts.items():
            if count <= 0:
                continue
            if slot_key not in slot_group_id:
                slot_group_id[slot_key] = f"{group_id_prefix}{slot_id_counter}"
                slot_id_counter += 1
            slot_queue.extend([slot_key] * count)

        total_planned, total_students = len(slot_queue), len(students_sub)
        slot_fill_counter = {}

        for i in range(min(total_students, total_planned)):
            student = students_sub.iloc[i]
            slot_key = slot_queue[i]
            slot_row = slot_lookup.loc[slot_key]
            cap_limit = int(slot_row["Lab_Capacity"])

            curr_idx = slot_fill_counter.get(slot_key, 0) + 1
            slot_fill_counter[slot_key] = curr_idx
            is_overfill = curr_idx > cap_limit

            slot_num = slot_row.get("Slot_Num", pd.NA) if hasattr(slot_row, "get") else slot_row["Slot_Num"]
            time_slot = slot_row.get("Slot_Label") if hasattr(slot_row, "get") and pd.notna(slot_row.get("Slot_Label")) else slot_labels.get(slot_num, f"Slot {slot_num}")

            master_rows.append({
                "Group_ID": slot_group_id[slot_key],
                "S_ID": student["S_ID"],
                "Grade": grade,
                "Physical Area": area,
                "Lab_ID": slot_row["Lab_ID"],
                "Day": slot_row["Day"],
                "Session": slot_row["Session"],
                "Time_Slot": time_slot,
                "Slot_Key": slot_key,
                "Lab_Capacity": cap_limit,
                "Slot_Num": slot_num,
                "Is_Overfill": is_overfill,
            })

        if total_students > total_planned:
            for i in range(total_planned, total_students):
                student = students_sub.iloc[i]
                unassigned_rows.append({
                    "S_ID": student["S_ID"],
                    "Grade": grade,
                    "Physical Area": area,
                    "Reason": "No remaining true-capacity seat in this Area+Grade",
                })

    master_df = pd.DataFrame(master_rows)
    unassigned_df = pd.DataFrame(unassigned_rows)
    if not master_df.empty:
        master_df["Assigned_Count_Per_Lab"] = master_df.groupby("Slot_Key")["S_ID"].transform("count")
    return master_df, unassigned_df


# ------------------------------------------------------------------------
# Readable Exports & Summaries
# ------------------------------------------------------------------------

def build_dashboard_style_summary(master_allocation: pd.DataFrame, unassigned_students: pd.DataFrame) -> pd.DataFrame:
    if master_allocation.empty:
        return pd.DataFrame()
    grades = sorted(master_allocation["Grade"].dropna().unique())
    students = master_allocation.pivot_table(index="Physical Area", columns="Grade", values="S_ID", aggfunc="count", fill_value=0)
    students.columns = [f"G{g}" for g in students.columns]
    students = students.reindex(columns=[f"G{g}" for g in grades], fill_value=0)
    students["Grand Total"] = students.sum(axis=1)
    groups = master_allocation.pivot_table(index="Physical Area", columns="Grade", values="Group_ID", aggfunc="nunique", fill_value=0)
    groups.columns = [f"Grade{g} Groups" for g in groups.columns]
    groups = groups.reindex(columns=[f"Grade{g} Groups" for g in grades], fill_value=0)
    groups["Total Groups"] = groups.sum(axis=1)
    out = students.join(groups).reset_index()
    if not unassigned_students.empty:
        un = unassigned_students.groupby("Physical Area").size().rename("Unassigned").reset_index()
        out = out.merge(un, on="Physical Area", how="left")
    out["Unassigned"] = out.get("Unassigned", 0)
    out["Unassigned"] = out["Unassigned"].fillna(0).astype(int)
    for c in out.columns:
        if c != "Physical Area":
            out[c] = out[c].astype(int)
    return out.sort_values("Physical Area").reset_index(drop=True)


def build_readable_master(master_allocation: pd.DataFrame, slot_info: Optional[List[Tuple[str, str, str, int]]] = None) -> pd.DataFrame:
    if master_allocation.empty:
        return pd.DataFrame()
    df = master_allocation.copy()
    slot_order_lookup = {num: idx for idx, (_, _, _, num) in enumerate(slot_info or DEFAULT_SLOT_INFO)}
    df["_slot_order"] = df["Slot_Num"].map(lambda n: slot_order_lookup.get(n, 99))
    df = df.sort_values(by=["Physical Area", "Grade", "_slot_order", "Lab_ID", "S_ID"]).drop(columns="_slot_order")
    col_order = ["Physical Area", "Grade", "Day", "Time_Slot", "Lab_ID", "Group_ID", "Slot_Key", "S_ID", "Lab_Capacity", "Assigned_Count_Per_Lab", "Is_Overfill"]
    return df[[c for c in col_order if c in df.columns]].reset_index(drop=True)


def build_area_time_pivot(master_allocation: pd.DataFrame, slot_info: Optional[List[Tuple[str, str, str, int]]] = None) -> pd.DataFrame:
    if master_allocation.empty:
        return pd.DataFrame()
    df = master_allocation.copy()
    slots = slot_info or DEFAULT_SLOT_INFO
    slot_order = [label for label, *_ in slots]

    rows = []
    for (area, grade, lab_id, time_slot), grp in df.groupby(["Physical Area", "Grade", "Lab_ID", "Time_Slot"]):
        rows.append({
            "Physical Area": area,
            "Grade": grade,
            "Lab_ID": lab_id,
            "Slot_Label": time_slot,
            "Students": len(grp),
            "Capacity": grp["Lab_Capacity"].iloc[0],
        })
    long_df = pd.DataFrame(rows)
    long_df["Cell"] = long_df["Students"].astype(str) + "/" + long_df["Capacity"].astype(str)
    pivot = long_df.pivot_table(index=["Physical Area", "Grade", "Lab_ID"], columns="Slot_Label", values="Cell", aggfunc="first")
    pivot = pivot.reindex(columns=[c for c in slot_order if c in pivot.columns]).reset_index()
    return pivot.sort_values(["Physical Area", "Grade", "Lab_ID"])


def build_group_count_summary(master_allocation: pd.DataFrame, unassigned_students: pd.DataFrame) -> pd.DataFrame:
    if master_allocation.empty:
        return pd.DataFrame()
    base = master_allocation.groupby(["Physical Area", "Grade"]).agg(
        Students_Assigned=("S_ID", "count"),
        Unique_Groups=("Group_ID", "nunique"),
        Labs_Used=("Lab_ID", "nunique"),
    ).reset_index()
    if not unassigned_students.empty:
        un = unassigned_students.groupby(["Physical Area", "Grade"]).size().rename("Unassigned").reset_index()
        base = base.merge(un, on=["Physical Area", "Grade"], how="outer")
    base["Unassigned"] = base.get("Unassigned", 0)
    base = base.fillna(0)
    for c in ["Students_Assigned", "Unique_Groups", "Labs_Used", "Unassigned"]:
        base[c] = base[c].astype(int)
    base["Total_Students"] = base["Students_Assigned"] + base["Unassigned"]
    return base.sort_values(["Physical Area", "Grade"])


def build_lab_allocation_table(sessions_df_augmented: pd.DataFrame) -> pd.DataFrame:
    if sessions_df_augmented.empty:
        return pd.DataFrame()
    df = sessions_df_augmented.copy()
    if "Slot_Label" in df.columns:
        df["Time_Slot"] = df["Slot_Label"]
    out = df[["Area", "Grade", "Lab_ID", "Time_Slot", "Lab_Capacity"]].rename(columns={"Lab_Capacity": "Capacity"})
    return out.sort_values(["Area", "Grade", "Lab_ID"]).reset_index(drop=True)


def export_per_slot_rosters(master_allocation: pd.DataFrame, out_dir: Path, log=print) -> None:
    if master_allocation.empty:
        log("No assignments to export as per-slot rosters.")
        return
    for slot_key, grp in master_allocation.groupby("Slot_Key"):
        row0 = grp.iloc[0]
        day_tag = str(row0.get("Day", "Day")).replace(" ", "_")
        time_tag = str(row0.get("Time_Slot", "Slot")).replace(" ", "_").replace(":", "-")
        fname = f"{row0['Physical Area']}_G{row0['Grade']}_{row0['Lab_ID']}_{day_tag}_{time_tag}.xlsx".replace("/", "-")
        grp[["S_ID", "Group_ID"]].to_excel(out_dir / fname, index=False)
    log(f"Exported {master_allocation['Slot_Key'].nunique()} per-slot roster files to {out_dir}")


def explain_shortfall(area: str, area_sessions: pd.DataFrame, grade_counts: Dict[int, int], per_grade_shortfall: Dict[int, int]) -> str:
    total_sessions = len(area_sessions)
    lab_caps = area_sessions.groupby("Lab_ID")["Lab_Capacity"].first().to_dict()
    lines = [f"AREA: {area}", f"  Labs: {len(lab_caps)}  |  True capacities: {lab_caps}",
             f"  Total sessions available: {total_sessions}", ""]
    total_needed = 0
    for grade, demand in grade_counts.items():
        max_cap = area_sessions["Lab_Capacity"].max()
        min_sessions = math.ceil(demand / max_cap)
        total_needed += min_sessions
        short = per_grade_shortfall.get(grade, 0)
        flag = "  <-- SHORT" if short > 0 else ""
        lines.append(f"  Grade {grade}: {demand} students / best-case {max_cap} cap -> needs >= {min_sessions} sessions{flag}")
    lines.append("")
    lines.append(f"  TOTAL sessions needed (best case): {total_needed}  |  available: {total_sessions}")
    gap = total_needed - total_sessions
    if gap > 0:
        lines.append(f"  GAP: short by {gap} session(s) area-wide -> {sum(per_grade_shortfall.values())} student(s) can't be seated")
    else:
        lines.append("  No structural session-count gap (ILP found a tighter combinatorial reason).")
    lines.append("-" * 70)
    return "\n".join(lines)


def build_shortfall_explanation(sessions_df: pd.DataFrame, students_df: pd.DataFrame, shortfall_report: List[Dict[str, Any]]) -> Optional[Tuple[pd.DataFrame, str]]:
    if not shortfall_report:
        return None
    shortfall_df = pd.DataFrame(shortfall_report)
    blocks = []
    for area in sorted(shortfall_df["Area"].unique()):
        area_sessions = sessions_df[sessions_df["Area"] == area].rename(columns={"Lab ID": "Lab_ID", "True_Capacity": "Lab_Capacity"})
        grade_counts = students_df[students_df["Physical Area"] == area].groupby("Grade").size().to_dict()
        per_grade_shortfall = dict(zip(shortfall_df[shortfall_df["Area"] == area]["Grade"], shortfall_df[shortfall_df["Area"] == area]["Students_Short"]))
        blocks.append(explain_shortfall(area, area_sessions, grade_counts, per_grade_shortfall))
    return shortfall_df, "\n\n".join(blocks)


def build_dashboard_output(
    master_allocation: pd.DataFrame,
    lab_df: pd.DataFrame,
    dashboard_path: Optional[Path | str],
    slot_info: Optional[List[Tuple[str, str, str, int]]] = None,
    log=print,
) -> pd.DataFrame:
    slots = slot_info or DEFAULT_SLOT_INFO
    slot_grade_cols = [f"{label} Grade" for label, *_ in slots]
    slot_id_cols = [label for label, *_ in slots]

    lab_slot_lookup = {}
    if not master_allocation.empty:
        slot_label_by_num = {num: label for label, day, shift, num in slots}
        for _, row in master_allocation.drop_duplicates(subset="Slot_Key").iterrows():
            label = slot_label_by_num.get(row["Slot_Num"])
            if label is None:
                continue
            lab_slot_lookup.setdefault(row["Lab_ID"], {})[label] = (row["Grade"], row["Group_ID"])

    sessions_used_per_lab = (
        master_allocation.drop_duplicates(subset="Slot_Key").groupby("Lab_ID").size().to_dict()
        if not master_allocation.empty else {}
    )

    def fill_dashboard_row(lab_id: str) -> Dict[str, Any]:
        slot_map = lab_slot_lookup.get(lab_id, {})
        out = {"Number of Sessions": sessions_used_per_lab.get(lab_id, 0)}
        for label, *_ in slots:
            grade, group_id = slot_map.get(label, (None, None))
            out[f"{label} Grade"] = f"G{grade}" if grade is not None else np.nan
            out[label] = group_id if group_id is not None else np.nan
        return out

    if dashboard_path:
        template_df = find_sheet_with_columns(dashboard_path, required_cols=["Lab ID"])
        template_df["Lab ID"] = template_df["Lab ID"].astype(str).str.strip()

        for col in ["Number of Sessions"] + slot_grade_cols + slot_id_cols:
            if col not in template_df.columns:
                template_df[col] = np.nan

        for idx, row in template_df.iterrows():
            if row["Lab ID"] in lab_df["Lab ID"].values:
                filled = fill_dashboard_row(row["Lab ID"])
                for col, val in filled.items():
                    template_df.at[idx, col] = val

        template_lab_ids = set(template_df["Lab ID"])
        missing_labs = lab_df[~lab_df["Lab ID"].isin(template_lab_ids)]
        if not missing_labs.empty:
            new_rows = []
            for _, r in missing_labs.iterrows():
                row = {c: np.nan for c in template_df.columns}
                row["Lab ID"], row["Area"], row["Lab Capacity"] = r["Lab ID"], r["Area"], r["Lab Capacity"]
                row.update(fill_dashboard_row(r["Lab ID"]))
                new_rows.append(row)
            template_df = pd.concat([template_df, pd.DataFrame(new_rows)], ignore_index=True)
            log(f"Appended {len(missing_labs)} lab(s) present in the Lab file but not in the Dashboard template.")

        log(f"Filled existing Dashboard template ({dashboard_path}) -- {len(template_df)} lab rows.")
        return template_df

    rows = []
    for _, r in lab_df.iterrows():
        row = {"Lab ID": r["Lab ID"], "Area": r["Area"], "Lab Capacity": r["Lab Capacity"]}
        row.update(fill_dashboard_row(r["Lab ID"]))
        rows.append(row)
    dashboard_output = pd.DataFrame(rows, columns=["Lab ID", "Area", "Lab Capacity", "Number of Sessions"] + slot_grade_cols + slot_id_cols)
    log(f"Constructed Dashboard output with {len(slots)} configured time slots across {len(dashboard_output)} labs.")
    return dashboard_output


# ------------------------------------------------------------------------
# Main Pipeline Runner
# ------------------------------------------------------------------------

def run_allocation(
    student_path: Path | str,
    lab_path: Path | str,
    dashboard_path: Optional[Path | str] = None,
    output_dir: Path | str = "./output",
    group_id_prefix: str = GROUP_ID_PREFIX,
    preferences: Any = None,
    custom_slots: Optional[List[Any]] = None,
    verbose: bool = True,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    logs = []
    def log(msg: Any) -> None:
        logs.append(str(msg))
        if verbose:
            print(msg)

    output_dir = Path(output_dir)
    per_slot_dir = output_dir / "per_slot_rosters"
    output_dir.mkdir(parents=True, exist_ok=True)
    per_slot_dir.mkdir(parents=True, exist_ok=True)

    result = {}
    prefs = parse_preferences(preferences)

    # Resolve active slot schedule (Custom Batch slots vs Default Thursday/Friday 7-slot split)
    active_custom_slots = custom_slots or prefs.get("customSlots")
    slot_info = resolve_slot_schedule(active_custom_slots)

    if active_custom_slots:
        log(f"Using batch-specific schedule: {len(slot_info)} slot(s) per lab ({', '.join([s[0] for s in slot_info])})")
    else:
        log("Using default schedule: 7 slots per lab (4 Thursday + 3 Friday)")

    # 1. Load inputs
    students_df = load_students(student_path)
    lab_df = load_lab_capacity(lab_path, log)
    sessions_df = build_full_session_grid(lab_df, extra_labs=prefs.get("extraLabs", []), slot_info=slot_info)

    log(f"Students loaded: {len(students_df)} rows")
    log(f"Labs loaded: {len(lab_df)} rows (with {len(prefs.get('extraLabs', []))} extra requested labs)")
    log(f"Full-grid sessions built: {len(sessions_df)} rows ({sessions_df['Lab ID'].nunique()} labs x {len(slot_info)} slots)")
    log(f"Total TRUE capacity available: {sessions_df['True_Capacity'].sum()} vs {len(students_df)} students")

    areas_with_labs = set(sessions_df["Area"])
    areas_with_students = set(students_df["Physical Area"])
    orphan_areas = areas_with_students - areas_with_labs
    if orphan_areas:
        n_orphan = students_df[students_df["Physical Area"].isin(orphan_areas)].shape[0]
        log(f"WARNING: {len(orphan_areas)} Physical Area(s) in the student file have NO labs at all: {sorted(orphan_areas)}")
        log(f"         -> {n_orphan} student(s) in those areas will be logged as unassigned (no labs exist there).")

    # 2. Per-area ILP
    sessions_df_augmented, shortfall_math_df, shortfall_report, total_true_shortfall = run_ilp_all_areas(
        sessions_df, students_df, log, preferences=prefs
    )

    # 3. Balanced distribution
    assignment_plan, unassigned_log = run_group_optimization(
        students_df, sessions_df_augmented, preferences=prefs
    )

    # 4. Master allocation + Unassigned
    master_allocation, unassigned_students = generate_master_allocation(
        students_df, sessions_df_augmented, assignment_plan, group_id_prefix=group_id_prefix, slot_info=slot_info
    )

    log(f"Master allocation rows: {len(master_allocation)}")
    log(f"Total unassigned students: {len(unassigned_students)}")
    total_check = len(master_allocation) + len(unassigned_students)
    if total_check != len(students_df):
        raise RuntimeError(f"Internal accounting mismatch: {total_check} != {len(students_df)} students.")

    # Overfill accounting
    overfill_count = int(master_allocation["Is_Overfill"].sum()) if not master_allocation.empty and "Is_Overfill" in master_allocation.columns else 0
    overfilled_slots = master_allocation[master_allocation["Is_Overfill"] == True]["Slot_Key"].nunique() if overfill_count > 0 else 0
    log(f"Total Overfill Students accommodated: {overfill_count} across {overfilled_slots} slot(s)")

    # 5. Readable exports
    dashboard_style_summary = build_dashboard_style_summary(master_allocation, unassigned_students)
    group_count_summary = build_group_count_summary(master_allocation, unassigned_students)
    master_allocation_sorted = build_readable_master(master_allocation, slot_info=slot_info)
    area_time_pivot = build_area_time_pivot(master_allocation, slot_info=slot_info)
    lab_allocation_table = build_lab_allocation_table(sessions_df_augmented)

    dashboard_style_summary_path = output_dir / "dashboard_style_summary.xlsx"
    dashboard_style_summary.to_excel(dashboard_style_summary_path, index=False)
    result["dashboard_style_summary"] = dashboard_style_summary_path

    group_count_summary_path = output_dir / "area_grade_group_summary.xlsx"
    group_count_summary.to_excel(group_count_summary_path, index=False)
    result["area_grade_group_summary"] = group_count_summary_path

    export_per_slot_rosters(master_allocation, per_slot_dir, log)
    result["per_slot_rosters_dir"] = per_slot_dir

    master_allocation_path = output_dir / "master_allocation.xlsx"
    with pd.ExcelWriter(master_allocation_path, engine="openpyxl") as writer:
        master_allocation_sorted.to_excel(writer, sheet_name="Master Allocation", index=False)
        if not area_time_pivot.empty:
            area_time_pivot.to_excel(writer, sheet_name="Pivot (by Lab)", index=False)
    result["master_allocation"] = master_allocation_path

    if not unassigned_students.empty:
        unassigned_path = output_dir / "unassigned_students.xlsx"
        unassigned_students.sort_values(["Physical Area", "Grade"]).to_excel(unassigned_path, index=False)
        result["unassigned_students"] = unassigned_path

    # Shortfall explanation
    explanation = build_shortfall_explanation(sessions_df, students_df, shortfall_report)
    shortfall_text = ""
    if explanation is not None:
        shortfall_df, shortfall_text = explanation
        log(shortfall_text)
        txt_path = output_dir / "shortfall_math_explanation.txt"
        xlsx_path = output_dir / "shortfall_math_explanation.xlsx"
        txt_path.write_text(shortfall_text, encoding="utf-8")
        shortfall_df.to_excel(xlsx_path, index=False)
        result["shortfall_explanation_txt"] = txt_path
        result["shortfall_explanation_xlsx"] = xlsx_path

    # Consolidated app data workbook
    app_data_path = output_dir / "app_data.xlsx"
    with pd.ExcelWriter(app_data_path, engine="openpyxl") as writer:
        dashboard_style_summary.to_excel(writer, sheet_name="Dashboard Summary", index=False)
        master_allocation_sorted.to_excel(writer, sheet_name="Master Allocation", index=False)
        if not area_time_pivot.empty:
            area_time_pivot.to_excel(writer, sheet_name="Pivot (by Lab)", index=False)
        group_count_summary.to_excel(writer, sheet_name="Area Grade Summary", index=False)
        if not unassigned_students.empty:
            unassigned_students.to_excel(writer, sheet_name="Unassigned", index=False)
        if not shortfall_math_df.empty:
            shortfall_math_df.to_excel(writer, sheet_name="Shortfall Math", index=False)
        if not lab_allocation_table.empty:
            lab_allocation_table.to_excel(writer, sheet_name="Lab Allocation", index=False)
    result["app_data"] = app_data_path
    log(f"Saved consolidated app data: {app_data_path}")

    # Final dashboard output
    dashboard_output = build_dashboard_output(master_allocation, lab_df, dashboard_path, slot_info=slot_info, log=log)
    dashboard_output_path = output_dir / "dashboard_output.xlsx"
    dashboard_output.to_excel(dashboard_output_path, index=False)
    result["dashboard_output"] = dashboard_output_path
    log(f"Saved: {dashboard_output_path}")

    # JSON Payload for Web API
    def df_to_records(d: pd.DataFrame) -> List[Dict[str, Any]]:
        if d is None or d.empty:
            return []
        cleaned = d.replace({np.nan: None})
        return cleaned.to_dict(orient="records")

    payload = {
        "summary": {
            "total_students": int(len(students_df)),
            "assigned_count": int(len(master_allocation)),
            "unassigned_count": int(len(unassigned_students)),
            "overfill_count": overfill_count,
            "overfilled_sessions_count": overfilled_slots,
            "total_labs": int(sessions_df["Lab ID"].nunique()),
            "total_sessions_available": int(len(sessions_df)),
            "total_sessions_assigned": int(len(sessions_df_augmented)),
            "areas_count": int(students_df["Physical Area"].nunique()),
            "slots_count": len(slot_info),
            "slots_labels": [s[0] for s in slot_info],
        },
        "logs": logs,
        "shortfall_text": shortfall_text,
        "preferences_applied": prefs,
        "dashboard_summary": df_to_records(dashboard_style_summary),
        "area_grade_summary": df_to_records(group_count_summary),
        "master_allocation": df_to_records(master_allocation_sorted),
        "lab_pivot": df_to_records(area_time_pivot),
        "lab_allocation": df_to_records(lab_allocation_table),
        "unassigned_students": df_to_records(unassigned_students) if not unassigned_students.empty else [],
        "shortfall_math": df_to_records(shortfall_math_df),
        "generated_files": {k: p.name for k, p in result.items() if isinstance(p, Path) and p.is_file()},
    }

    json_path = output_dir / "allocation_result.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, default=str)
    result["allocation_result"] = json_path

    result["summary"] = payload["summary"]
    result["log"] = logs
    return result, payload


def main():
    parser = argparse.ArgumentParser(description="Lab Allocation Pipeline")
    parser.add_argument("--student", required=True, help="Path to the student file (required)")
    parser.add_argument("--lab", required=True, help="Path to the lab file (required, needs Lab ID / Area / Lab Capacity)")
    parser.add_argument("--dashboard", default=None, help="Optional path to a Dashboard template file")
    parser.add_argument("--output-dir", default="./output", help="Directory to write output files to")
    parser.add_argument("--prefix", default=GROUP_ID_PREFIX, help="Group ID Prefix (e.g. Physical-DS-G or Physical-DEMI-G)")
    parser.add_argument("--preferences", default=None, help="JSON string or path to preferences.json")
    parser.add_argument("--slots", default=None, help="Comma-separated or JSON list of custom batch time slots")
    parser.add_argument("--json", action="store_true", help="Print JSON result payload to stdout")
    args = parser.parse_args()

    custom_slots = None
    if args.slots:
        try:
            custom_slots = json.loads(args.slots)
        except Exception:
            custom_slots = [s.strip() for s in args.slots.split(",") if s.strip()]

    result, payload = run_allocation(
        student_path=args.student,
        lab_path=args.lab,
        dashboard_path=args.dashboard,
        output_dir=args.output_dir,
        group_id_prefix=args.prefix,
        preferences=args.preferences,
        custom_slots=custom_slots,
        verbose=not args.json,
    )

    if args.json:
        print(json.dumps(payload, default=str))
    else:
        print("\nOutput files:")
        for name, path in result.items():
            if name in ("summary", "log"):
                continue
            print(f"  {name}: {path}")


if __name__ == "__main__":
    main()
