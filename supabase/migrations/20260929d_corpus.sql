-- Phase 5: the chain board and corpus views.
--
-- Run once in the Supabase SQL editor on a database that has
-- 20260929c_themes_memo.sql applied. A fresh database doesn't need this:
-- schema.sql already includes everything below.
--
-- Adds:
--   - corpus_matrix(): code counts per theme per interview, and each
--     interview's codes that no theme holds. Read-only; no tables change.

begin;

-- ─── the code × interview matrix ─────────────────────────────────────────
-- A code belongs to one transcript, so what recurs across interviews is the
-- theme. One row per theme per interview: how many of that interview's active
-- codes the theme holds. Rows with a null theme count the interview's active
-- codes that no counted theme holds. Proposed themes count only when asked
-- for; confirmed ones always do. Saturation, coverage by label and the matrix
-- are all read from this.
create or replace function corpus_matrix(p_project_id uuid, p_include_proposed boolean default false)
returns table (theme_id uuid, transcript_id uuid, codes integer)
language sql stable security definer set search_path = public as $$
  with active as (
    select c.id, c.transcript_id
    from code c
    join transcript t on t.id = c.transcript_id
    where t.project_id = p_project_id and c.merged_into_id is null
  ),
  member as (
    select tc.theme_id, a.transcript_id, a.id as code_id
    from theme_code tc
    join theme th on th.id = tc.theme_id
    join active a on a.id = tc.code_id
    where th.project_id = p_project_id
      and (th.status = 'confirmed' or p_include_proposed)
  )
  select m.theme_id, m.transcript_id, count(*)::integer
  from member m
  where has_seat()
  group by m.theme_id, m.transcript_id
  union all
  select null::uuid, a.transcript_id, count(*)::integer
  from active a
  where has_seat() and not exists (select 1 from member m where m.code_id = a.id)
  group by a.transcript_id;
$$;

revoke execute on function corpus_matrix from public, anon;
grant execute on function corpus_matrix to authenticated;

commit;
