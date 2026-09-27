-- Paginate/filter the canonical JSONB project roster without sending the full array to clients.
CREATE OR REPLACE FUNCTION public.get_project_roster_page(
  p_project_id uuid,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50,
  p_search text DEFAULT NULL,
  p_grade integer DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_area text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH roster AS (
  SELECT b.*, student.value AS student, student.ordinality
  FROM public.batch_student_uploads b
  CROSS JOIN LATERAL jsonb_array_elements(b.students) WITH ORDINALITY AS student(value, ordinality)
  WHERE b.project_id = p_project_id
    AND b.batch_id = ('00000000-' || substring(p_project_id::text from 10))::uuid
), normalized AS (
  SELECT *,
    COALESCE(NULLIF(student->>'Status', ''), NULLIF(student->>'status', ''), 'Enrolled') AS student_status,
    COALESCE(NULLIF(student->>'Physical Area', ''), 'Unspecified Area') AS physical_area,
    NULLIF(regexp_replace(COALESCE(student->>'Grade', ''), '\D', '', 'g'), '')::integer AS grade
  FROM roster
), filtered AS (
  SELECT * FROM normalized
  WHERE (p_search IS NULL OR student->>'S_ID' ILIKE '%' || p_search || '%'
         OR COALESCE(student->>'Name', student->>'Student Name', '') ILIKE '%' || p_search || '%')
    AND (p_grade IS NULL OR grade = p_grade)
    AND (p_status IS NULL OR student_status = p_status)
    AND (p_area IS NULL OR physical_area = p_area)
), page_rows AS (
  SELECT student FROM filtered ORDER BY ordinality LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0)
), aggregate_values AS (
  SELECT
    count(*)::integer AS total,
    count(*) FILTER (WHERE lower(student_status) !~ '(drop|revok|fail|inactive|withdrawn|cancel)')::integer AS active,
    count(*) FILTER (WHERE lower(student_status) ~ '(drop|revok|fail|inactive|withdrawn|cancel)')::integer AS revoked,
    count(DISTINCT physical_area)::integer AS physical_areas,
    COALESCE(jsonb_agg(DISTINCT grade) FILTER (WHERE grade IS NOT NULL), '[]'::jsonb) AS grades,
    COALESCE(jsonb_agg(DISTINCT physical_area), '[]'::jsonb) AS areas
  FROM normalized
), filtered_count AS (SELECT count(*)::integer AS total FROM filtered), metadata AS (
  SELECT jsonb_build_object('batch_id', batch_id, 'project_id', project_id, 'file_name', file_name,
    'file_size', file_size, 'student_count', student_count, 'updated_at', updated_at) AS value
  FROM public.batch_student_uploads
  WHERE project_id = p_project_id AND batch_id = ('00000000-' || substring(p_project_id::text from 10))::uuid
  LIMIT 1
)
SELECT jsonb_build_object(
  'rows', COALESCE((SELECT jsonb_agg(student) FROM page_rows), '[]'::jsonb),
  'total', (SELECT total FROM filtered_count),
  'summary', jsonb_build_object('total', a.total, 'active', a.active, 'revoked', a.revoked, 'physical_areas', a.physical_areas),
  'grades', a.grades, 'areas', a.areas, 'metadata', (SELECT value FROM metadata)
) FROM aggregate_values a;
$$;

GRANT EXECUTE ON FUNCTION public.get_project_roster_page(uuid, integer, integer, text, integer, text, text) TO authenticated, anon;

DROP FUNCTION IF EXISTS public.update_student_in_batch(uuid, text, integer, text, text);
CREATE FUNCTION public.update_student_in_batch(
  p_batch_id uuid,
  p_student_id text,
  p_grade integer DEFAULT NULL,
  p_area text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_revoked_at timestamptz DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_updated integer := 0;
BEGIN
  UPDATE public.batch_student_uploads b SET students = (
    SELECT jsonb_agg(CASE WHEN elem->>'S_ID' = p_student_id THEN
      elem
      || jsonb_strip_nulls(jsonb_build_object('Grade', p_grade, 'Physical Area', p_area))
      || CASE WHEN p_status IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
        'Status', p_status, 'status', p_status, 'revoked_at', p_revoked_at, 'Revoked At', p_revoked_at) END
      ELSE elem END ORDER BY ordinality)
    FROM jsonb_array_elements(b.students) WITH ORDINALITY AS student(elem, ordinality)
  ), updated_at = now()
  WHERE b.batch_id = p_batch_id
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(b.students) elem WHERE elem->>'S_ID' = p_student_id);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_student_in_batch(uuid, text, integer, text, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_update_roster_student_statuses(p_batch_id uuid, p_updates jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  UPDATE public.batch_student_uploads b
  SET students = (
    SELECT jsonb_agg(CASE WHEN u.value IS NULL THEN s.value ELSE
      s.value || jsonb_build_object('Status', u.value->>'status', 'status', u.value->>'status',
        'revoked_at', u.value->'revoked_at', 'Revoked At', u.value->'revoked_at') END ORDER BY s.ordinality)
    FROM jsonb_array_elements(b.students) WITH ORDINALITY s(value, ordinality)
    LEFT JOIN jsonb_array_elements(p_updates) u(value) ON u.value->>'student_id' = s.value->>'S_ID'
  ), updated_at = now()
  WHERE b.batch_id = p_batch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_project_roster_student(p_batch_id uuid, p_project_id uuid, p_student jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_updated integer := 0;
BEGIN
  UPDATE public.batch_student_uploads b SET
    students = (SELECT COALESCE(jsonb_agg(s.value ORDER BY s.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(b.students) WITH ORDINALITY s(value, ordinality)
      WHERE s.value->>'S_ID' <> p_student->>'S_ID') || jsonb_build_array(p_student),
    student_count = jsonb_array_length((SELECT COALESCE(jsonb_agg(s.value ORDER BY s.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(b.students) WITH ORDINALITY s(value, ordinality)
      WHERE s.value->>'S_ID' <> p_student->>'S_ID') || jsonb_build_array(p_student)),
    updated_at = now()
  WHERE b.batch_id = p_batch_id AND b.project_id = p_project_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_project_roster_student(p_batch_id uuid, p_student_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_updated integer := 0;
BEGIN
  UPDATE public.batch_student_uploads b SET
    students = (SELECT COALESCE(jsonb_agg(s.value ORDER BY s.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(b.students) WITH ORDINALITY s(value, ordinality)
      WHERE s.value->>'S_ID' <> p_student_id),
    student_count = jsonb_array_length((SELECT COALESCE(jsonb_agg(s.value ORDER BY s.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(b.students) WITH ORDINALITY s(value, ordinality)
      WHERE s.value->>'S_ID' <> p_student_id)),
    updated_at = now()
  WHERE b.batch_id = p_batch_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_update_roster_student_statuses(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_project_roster_student(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_project_roster_student(uuid, text) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_batch_student_uploads_project_batch
  ON public.batch_student_uploads(project_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_student_uploads_students_gin
  ON public.batch_student_uploads USING gin(students jsonb_path_ops);
