-- Reconcile the two SQL bodies that previously shared migration version
-- 20260917120000. This migration is intentionally idempotent so an existing
-- database converges whether it recorded the nearby-lab body, the roster body,
-- both bodies, or neither body under that version.

ALTER TABLE public.batch_student_uploads
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS checksum text,
  ADD COLUMN IF NOT EXISTS roster_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS uploaded_by text,
  ADD COLUMN IF NOT EXISTS roster_summary jsonb,
  ADD COLUMN IF NOT EXISTS roster_grades jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS roster_areas jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS roster_preview jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-student-rosters', 'project-student-rosters', false)
ON CONFLICT (id) DO UPDATE SET public = false;

ALTER TABLE public.batch_resolution_requests
  ADD COLUMN IF NOT EXISTS nearby_lab_metadata jsonb;

ALTER TABLE public.batch_resolution_requests
  DROP CONSTRAINT IF EXISTS batch_resolution_requests_type_check;
ALTER TABLE public.batch_resolution_requests
  ADD CONSTRAINT batch_resolution_requests_type_check
  CHECK (type IN ('overfill', 'nearby_lab', 'new_lab', 'cs_outreach', 'cs_reallocation'));

CREATE INDEX IF NOT EXISTS batch_resolution_requests_nearby_active_idx
  ON public.batch_resolution_requests (status, lab_id)
  WHERE type = 'nearby_lab' AND status IN ('pending', 'approved');

CREATE OR REPLACE FUNCTION public.get_project_roster_page(
  p_project_id uuid,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50,
  p_search text DEFAULT NULL,
  p_grade integer DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_area text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  b public.batch_student_uploads%ROWTYPE;
  source jsonb;
  filtered jsonb;
  result_rows jsonb;
BEGIN
  SELECT * INTO b
  FROM public.batch_student_uploads
  WHERE project_id = p_project_id
    AND batch_id = ('00000000-' || substring(p_project_id::text from 10))::uuid
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'rows', '[]'::jsonb,
      'total', 0,
      'summary', jsonb_build_object('total', 0, 'active', 0, 'revoked', 0, 'physical_areas', 0),
      'grades', '[]'::jsonb,
      'areas', '[]'::jsonb,
      'metadata', NULL
    );
  END IF;

  source := CASE
    WHEN b.storage_path IS NOT NULL THEN COALESCE(b.roster_preview, '[]'::jsonb)
    ELSE COALESCE(b.students, '[]'::jsonb)
  END;

  SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
  INTO filtered
  FROM jsonb_array_elements(source)
  WHERE (p_search IS NULL OR value->>'S_ID' ILIKE '%' || p_search || '%'
         OR COALESCE(value->>'Name', value->>'Student Name', '') ILIKE '%' || p_search || '%')
    AND (p_grade IS NULL OR NULLIF(regexp_replace(COALESCE(value->>'Grade', ''), '\D', '', 'g'), '')::integer = p_grade)
    AND (p_status IS NULL OR COALESCE(NULLIF(value->>'Status', ''), NULLIF(value->>'status', ''), 'Enrolled') = p_status)
    AND (p_area IS NULL OR COALESCE(NULLIF(value->>'Physical Area', ''), 'Unspecified Area') = p_area);

  SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
  INTO result_rows
  FROM (
    SELECT value
    FROM jsonb_array_elements(filtered) WITH ORDINALITY x(value, n)
    WHERE n > GREATEST(p_offset, 0)
    ORDER BY n
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ) q;

  RETURN jsonb_build_object(
    'rows', result_rows,
    'total', CASE
      WHEN b.storage_path IS NOT NULL AND p_search IS NULL AND p_grade IS NULL
        AND p_status IS NULL AND p_area IS NULL THEN b.student_count
      ELSE jsonb_array_length(filtered)
    END,
    'summary', COALESCE(b.roster_summary, jsonb_build_object(
      'total', b.student_count, 'active', b.student_count, 'revoked', 0, 'physical_areas', 0
    )),
    'grades', COALESCE(b.roster_grades, '[]'::jsonb),
    'areas', COALESCE(b.roster_areas, '[]'::jsonb),
    'metadata', jsonb_build_object(
      'batch_id', b.batch_id,
      'project_id', b.project_id,
      'file_name', b.file_name,
      'file_size', b.file_size,
      'student_count', b.student_count,
      'updated_at', b.updated_at,
      'storage_path', b.storage_path,
      'checksum', b.checksum
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_project_roster_page(uuid, integer, integer, text, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_project_roster_page(uuid, integer, integer, text, integer, text, text)
  TO authenticated;
