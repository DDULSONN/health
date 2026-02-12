-- ============================================
-- GymTools Community - Migration v4 (Photo Bodycheck)
-- ============================================

-- 0) 제약을 먼저 완화: bodycheck + photo_bodycheck 둘 다 허용
--    (기존 제약이 photo_bodycheck를 막고 있어 UPDATE가 실패하는 경우 대응)
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_type_check;
ALTER TABLE posts
  ADD CONSTRAINT posts_type_check
  CHECK (type IN ('1rm', 'lifts', 'helltest', 'bodycheck', 'photo_bodycheck', 'free'));

-- 1) 기존 bodycheck 타입 데이터 변환
UPDATE posts
SET type = 'photo_bodycheck'
WHERE type = 'bodycheck';

-- 2) 최종 제약으로 고정 (bodycheck 제거)
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_type_check;
ALTER TABLE posts
  ADD CONSTRAINT posts_type_check
  CHECK (type IN ('1rm', 'lifts', 'helltest', 'photo_bodycheck', 'free'));

-- 3) posts 컬럼 추가 (몸평 점수 캐시 + 성별)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS score_sum integer DEFAULT 0 NOT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS vote_count integer DEFAULT 0 NOT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS great_count integer DEFAULT 0 NOT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS good_count integer DEFAULT 0 NOT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS normal_count integer DEFAULT 0 NOT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS rookie_count integer DEFAULT 0 NOT NULL;

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_gender_check;
ALTER TABLE posts
  ADD CONSTRAINT posts_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female'));

CREATE INDEX IF NOT EXISTS idx_posts_photo_bodycheck_rank
  ON posts (type, gender, score_sum DESC, vote_count DESC, created_at ASC);

-- 4) votes 테이블
CREATE TABLE IF NOT EXISTS bodycheck_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating text NOT NULL CHECK (rating IN ('great', 'good', 'normal', 'rookie')),
  score integer NOT NULL CHECK (score BETWEEN 0 AND 3),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bodycheck_votes_post_id ON bodycheck_votes(post_id);
CREATE INDEX IF NOT EXISTS idx_bodycheck_votes_user_id ON bodycheck_votes(user_id);

CREATE OR REPLACE FUNCTION set_bodycheck_votes_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_bodycheck_votes_updated_at ON bodycheck_votes;
CREATE TRIGGER trg_set_bodycheck_votes_updated_at
BEFORE UPDATE ON bodycheck_votes
FOR EACH ROW EXECUTE FUNCTION set_bodycheck_votes_updated_at();

-- 5) 집계 함수 (API에서 RPC로 호출)
CREATE OR REPLACE FUNCTION recompute_photo_bodycheck_post_stats(p_post_id uuid)
RETURNS void AS $$
DECLARE
  v_score_sum integer;
  v_vote_count integer;
  v_great_count integer;
  v_good_count integer;
  v_normal_count integer;
  v_rookie_count integer;
BEGIN
  SELECT
    COALESCE(SUM(score), 0),
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE rating = 'great')::integer,
    COUNT(*) FILTER (WHERE rating = 'good')::integer,
    COUNT(*) FILTER (WHERE rating = 'normal')::integer,
    COUNT(*) FILTER (WHERE rating = 'rookie')::integer
  INTO
    v_score_sum,
    v_vote_count,
    v_great_count,
    v_good_count,
    v_normal_count,
    v_rookie_count
  FROM bodycheck_votes
  WHERE post_id = p_post_id;

  UPDATE posts
  SET
    score_sum = v_score_sum,
    vote_count = v_vote_count,
    great_count = v_great_count,
    good_count = v_good_count,
    normal_count = v_normal_count,
    rookie_count = v_rookie_count
  WHERE id = p_post_id
    AND type = 'photo_bodycheck';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION recompute_photo_bodycheck_post_stats(uuid) TO authenticated;

-- 6) RLS
ALTER TABLE bodycheck_votes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "bodycheck_votes_select_all" ON bodycheck_votes
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "bodycheck_votes_insert_own" ON bodycheck_votes
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "bodycheck_votes_update_own" ON bodycheck_votes
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7) (rerun safety) 허용되지 않는 type 값이 있으면 안내
DO $$
DECLARE
  invalid_types text;
BEGIN
  SELECT string_agg(DISTINCT type, ', ')
  INTO invalid_types
  FROM posts
  WHERE type NOT IN ('1rm', 'lifts', 'helltest', 'photo_bodycheck', 'free');

  IF invalid_types IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid posts.type values found: %', invalid_types;
  END IF;
END $$;
