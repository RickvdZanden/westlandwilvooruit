-- Moderatie van de bibliotheek + admin alleen met tweestapsverificatie (TOTP).
--
-- 1. is_admin() telt alleen nog als de sessie met TOTP is bevestigd (aal2). Een
--    uitgelekt wachtwoord alleen geeft dus geen rechten meer.
-- 2. is_admin() gaat uit de openbare API (/rest/v1/rpc) naar het schema private.
--    ALTER ... SET SCHEMA houdt dezelfde functie (OID), dus alle bestaande
--    policies blijven werken.
-- 3. Oefeningen van trainers (anoniem) komen binnen als concept; de admin
--    publiceert ze in Beheer.
-- 4. Lengtegrenzen op alle tekstvelden en een rem op anonieme inzendingen
--    (max 10 per 10 minuten, max 100 concepten in de wachtrij).

-- ---------- 1 + 2: is_admin ----------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

alter function public.is_admin() set schema private;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
     and exists (select 1 from public.profielen where id = (select auth.uid()) and rol = 'admin');
$$;

revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated;

-- ---------- 3: moderatie ----------
drop policy if exists oefeningen_toevoegen on public.oefeningen;
create policy oefeningen_toevoegen on public.oefeningen for insert to anon
  with check (status = 'concept' and created_by is null and tekening_pad is null);

-- ---------- 4: lengtegrenzen (gelden voor iedereen, ruim boven de huidige data) ----------
alter table public.oefeningen
  add constraint oefeningen_lengtes check (
        char_length(titel) <= 200
    and char_length(coalesce(uitleg, '')) <= 5000
    and char_length(coalesce(groepen, '')) <= 200
    and char_length(coalesce(duur, '')) <= 200
    and char_length(coalesce(intensiteit, '')) <= 500
    and char_length(coalesce(differentiatie, '')) <= 3000
    and char_length(coalesce(doel, '')) <= 2000
    and char_length(coalesce(materiaal, '')) <= 1000
    and char_length(coalesce(coach, '')) <= 3000
    and char_length(coalesce(youtube_url, '')) <= 200
    and coalesce(cardinality(tags), 0) <= 20
    and char_length(coalesce(array_to_string(tags, ','), '')) <= 500
    and coalesce(cardinality(thema_ids), 0) <= 10
    and coalesce(cardinality(niveaus), 0) <= 3
  );

-- ---------- 4: rem op anonieme inzendingen ----------
create or replace function private.rem_anonieme_inzendingen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    new.created_at := now();
    new.updated_at := now();
    perform pg_advisory_xact_lock(hashtext('oefeningen_anoniem'));
    if (select count(*) from public.oefeningen
        where created_by is null and status = 'concept' and created_at > now() - interval '10 minutes') >= 10 then
      raise exception 'Er zijn net veel oefeningen ingestuurd. Probeer het over een paar minuten opnieuw.' using errcode = 'P0001';
    end if;
    if (select count(*) from public.oefeningen where status = 'concept') >= 100 then
      raise exception 'Er wachten al veel oefeningen op goedkeuring. Probeer het later opnieuw.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;

revoke all on function private.rem_anonieme_inzendingen() from public;

drop trigger if exists oefeningen_rem on public.oefeningen;
create trigger oefeningen_rem
  before insert on public.oefeningen
  for each row execute function private.rem_anonieme_inzendingen();
