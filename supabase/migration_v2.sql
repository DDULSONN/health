-- ============================================
-- GymTools Community - Migration v2
-- Run in Supabase SQL Editor AFTER migration.sql
-- ============================================

-- 1. Backfill: ensure all post/comment authors have profiles
INSERT INTO profiles (user_id, nickname)
SELECT DISTINCT p.user_id, 'User_' || LEFT(p.user_id::text, 8)
FROM posts p
WHERE NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.user_id = p.user_id)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO profiles (user_id, nickname)
SELECT DISTINCT c.user_id, 'User_' || LEFT(c.user_id::text, 8)
FROM comments c
WHERE NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.user_id = c.user_id)
ON CONFLICT (user_id) DO NOTHING;

-- 2. FK constraints (enables PostgREST embedded join: profiles(nickname))
DO $$ BEGIN
  ALTER TABLE posts ADD CONSTRAINT fk_posts_profiles
    FOREIGN KEY (user_id) REFERENCES profiles(user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE comments ADD CONSTRAINT fk_comments_profiles
    FOREIGN KEY (user_id) REFERENCES profiles(user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Images column
ALTER TABLE posts ADD COLUMN IF NOT EXISTS images text[] DEFAULT '{}';

-- 4. Auto-create profile on signup (trigger)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (user_id, nickname)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'full_name',
      'User_' || LEFT(NEW.id::text, 8)
    )
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 5. Storage bucket for community images
INSERT INTO storage.buckets (id, name, public)
VALUES ('community', 'community', true)
ON CONFLICT DO NOTHING;

-- 6. Storage RLS policies
DO $$ BEGIN
  CREATE POLICY "community_upload_auth" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'community' AND auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "community_read_public" ON storage.objects
    FOR SELECT USING (bucket_id = 'community');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "community_delete_own" ON storage.objects
    FOR DELETE USING (
      bucket_id = 'community'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
