-- Usage (2026-10-01). Starts from 20261001a_settings_and_access.
--
-- usage_runs(): every Claude run with what it was on, who ran it, the model,
-- tokens and cost, for Settings → Usage. Workspace owners only.

begin;

-- One row per run of any pass since p_since (all time when null), with
-- what it was on, who ran it, the model asked for and the one that
-- answered, tokens and cost. Workspace owners only: it spans every
-- project, and spend is theirs to watch.
create or replace function usage_runs(p_since timestamptz default null)
returns table (
  id uuid, pass text, project_id uuid, transcript_id uuid, subject text, started_by uuid,
  started_at timestamptz, finished_at timestamptz, status run_status, model text, served_by text,
  input_tokens integer, output_tokens integer, cost_usd numeric, accepted integer, rejected integer, error text
)
language sql stable security definer set search_path = public as $$
  select * from (
    select r.id, 'Coding', t.project_id, r.transcript_id, t.title, r.started_by, r.started_at, r.finished_at,
           r.status, r.model, r.served_by, r.input_tokens, r.output_tokens, r.cost_usd, r.accepted, r.rejected, r.error
    from coding_run r join transcript t on t.id = r.transcript_id
    union all
    select r.id, 'Notes', t.project_id, r.transcript_id, t.title || ' · ' || nt.name, r.started_by, r.started_at, r.finished_at,
           r.status, r.model, r.served_by, r.input_tokens, r.output_tokens, r.cost_usd, r.accepted, r.rejected, r.error
    from note_run r join transcript t on t.id = r.transcript_id left join note_template nt on nt.id = r.template_id
    union all
    select r.id, 'Themes', r.project_id, null, null, r.started_by, r.started_at, r.finished_at,
           r.status, r.model, r.served_by, r.input_tokens, r.output_tokens, r.cost_usd, r.accepted, r.rejected, r.error
    from theme_run r
    union all
    select r.id, case when pt.kind = 'deck' then 'Deck' else 'Memo' end, r.project_id, null, pt.name, r.started_by, r.started_at, r.finished_at,
           r.status, r.model, r.served_by, r.input_tokens, r.output_tokens, r.cost_usd, r.accepted, r.rejected, r.error
    from product_run r left join product_template pt on pt.id = r.template_id
    union all
    select r.id, 'Process flows', r.project_id, null, null, r.started_by, r.started_at, r.finished_at,
           r.status, r.model, r.served_by, r.input_tokens, r.output_tokens, r.cost_usd, r.accepted, r.rejected, r.error
    from flow_run r
    union all
    select r.id, 'Architecture', r.project_id, null, null, r.started_by, r.started_at, r.finished_at,
           r.status, r.model, r.served_by, r.input_tokens, r.output_tokens, r.cost_usd, r.accepted, r.rejected, r.error
    from arch_run r
  ) runs
  where is_owner() and (p_since is null or runs.started_at >= p_since)
  order by runs.started_at desc;
$$;

revoke execute on function usage_runs from public, anon;
grant execute on function usage_runs to authenticated;

commit;
