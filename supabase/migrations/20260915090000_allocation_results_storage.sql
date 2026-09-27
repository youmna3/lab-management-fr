ALTER TABLE public.batch_allocation_outputs
  ADD COLUMN IF NOT EXISTS allocation_storage_path TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('allocation-results', 'allocation-results', false)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Authenticated users read allocation results" ON storage.objects;
CREATE POLICY "Authenticated users read allocation results"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'allocation-results');

DROP POLICY IF EXISTS "Authenticated users create allocation results" ON storage.objects;
CREATE POLICY "Authenticated users create allocation results"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'allocation-results');

DROP POLICY IF EXISTS "Authenticated users update allocation results" ON storage.objects;
CREATE POLICY "Authenticated users update allocation results"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'allocation-results')
WITH CHECK (bucket_id = 'allocation-results');

DROP POLICY IF EXISTS "Authenticated users delete allocation results" ON storage.objects;
CREATE POLICY "Authenticated users delete allocation results"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'allocation-results');
