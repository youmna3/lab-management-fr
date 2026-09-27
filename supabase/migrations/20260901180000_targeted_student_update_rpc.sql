-- ============================================================================
-- Migration: 20260901180000_targeted_student_update_rpc.sql
-- Description: High-performance in-database single student update RPC
-- Eliminates transferring multi-megabyte JSON arrays over HTTP for 1-row edits.
-- ============================================================================

-- Function: update_student_in_batch
CREATE OR REPLACE FUNCTION public.update_student_in_batch(
  p_batch_id UUID,
  p_student_id TEXT,
  p_grade INTEGER DEFAULT NULL,
  p_area TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated BOOLEAN := false;
BEGIN
  UPDATE public.batch_student_uploads
  SET 
    students = (
      SELECT jsonb_agg(
        CASE 
          WHEN elem->>'S_ID' = p_student_id THEN
            jsonb_build_object(
              'S_ID', p_student_id,
              'Grade', COALESCE(p_grade, (elem->>'Grade')::int, 4),
              'Physical Area', COALESCE(p_area, elem->>'Physical Area', 'Unspecified Area'),
              'Status', COALESCE(p_status, elem->>'Status', 'Enrolled'),
              'status', COALESCE(p_status, elem->>'status', 'Enrolled')
            )
          ELSE elem
        END
      )
      FROM jsonb_array_elements(students) AS elem
    ),
    updated_at = NOW()
  WHERE batch_id = p_batch_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.update_student_in_batch(UUID, TEXT, INTEGER, TEXT, TEXT) TO authenticated, anon, service_role;

-- Ensure indexes are present on lookup columns
CREATE INDEX IF NOT EXISTS idx_batch_student_uploads_batch_id ON public.batch_student_uploads(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_student_uploads_project_id ON public.batch_student_uploads(project_id);
