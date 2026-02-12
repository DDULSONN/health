-- ============================================
-- GymTools Community - Migration v3
-- Soft delete, deletion logs, edit/delete policies
-- Run in Supabase SQL Editor AFTER migration_v2.sql
-- ============================================

-- 1. Soft delete columns on posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts(is_deleted);

-- 2. Deletion logs table (법적 대비용)
CREATE TABLE IF NOT EXISTS deleted_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  title_snapshot text NOT NULL,
  content_snapshot text,
  payload_snapshot jsonb,
  deleted_at timestamptz DEFAULT now()
);

ALTER TABLE deleted_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "deleted_logs_select_own" ON deleted_logs
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "deleted_logs_insert_own" ON deleted_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Update posts SELECT policy
--    일반 유저: is_hidden=false AND is_deleted=false
--    작성자 본인: 자신의 글 항상 조회 가능 (마이페이지용)
--    관리자: 모든 글 조회 가능
DROP POLICY IF EXISTS "posts_select_visible" ON posts;
CREATE POLICY "posts_select_visible" ON posts
  FOR SELECT USING (
    (is_hidden = false AND is_deleted = false)
    OR (auth.uid() = user_id)
    OR EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 4. Add UPDATE policy for own posts (수정 + soft delete)
DO $$ BEGIN
  CREATE POLICY "posts_update_own" ON posts
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
