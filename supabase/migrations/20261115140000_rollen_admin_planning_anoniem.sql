-- Twee rollen: trainer (geen account, anoniem) en admin (account met wachtwoord).
-- Nieuwe tabel planning. Alle policies opnieuw opgebouwd rond public.is_admin().
-- Besluit Rick 15-11-2026: trainers zonder wachtwoord; Supabase-adres + publishable key
-- staan daardoor in de broncode. Wat anoniem mag, is hieronder strikt beperkt.

-- ============ Rollen ============
alter table public.profielen drop constraint if exists profielen_rol_check;
update public.profielen set rol = 'admin' where rol = 'beheerder';
alter table public.profielen alter column rol set default 'admin';
alter table public.profielen add constraint profielen_rol_check check (rol in ('admin'));
comment on table public.profielen is 'Alleen admins hebben een account. Trainers werken zonder account (anoniem).';

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profielen where id = (select auth.uid()) and rol = 'admin');
$$;
revoke execute on function public.is_admin() from public;
-- Ook anon mag hem aanroepen (geeft dan altijd false); nodig omdat policies voor anon hem gebruiken.
grant execute on function public.is_admin() to anon, authenticated;

-- ============ Planning ============
create table public.planning (
  id uuid primary key default gen_random_uuid(),
  datum date not null,
  start_tijd time,
  eind_tijd time,
  groep text,
  titel text not null,
  omschrijving text,
  locatie text default 'De Wollebrand',
  gepubliceerd boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index planning_datum_idx on public.planning (datum);
create trigger planning_updated before update on public.planning
  for each row execute function public.set_updated_at();
alter table public.planning enable row level security;

-- ============ Oude policies weg ============
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;
drop policy if exists "tekeningen_lezen" on storage.objects;
drop policy if exists "tekeningen_uploaden" on storage.objects;
drop policy if exists "tekeningen_verwijderen" on storage.objects;
drop function if exists public.is_beheerder();
drop function if exists public.is_trainer();

-- ============ Rechten op tabelniveau ============
revoke all on all tables in schema public from anon;
grant select on public.themas, public.oefeningen, public.planning to anon;
grant insert on public.oefeningen to anon;

-- ============ Policies ============
-- profielen: admin leest en beheert
create policy profielen_admin on public.profielen for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- themas: iedereen leest, admin schrijft
create policy themas_lezen on public.themas for select to anon, authenticated using (true);
create policy themas_admin on public.themas for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- oefeningen: iedereen leest gepubliceerde; trainers (anoniem) stellen alleen een concept
-- voor, zonder tekening en zonder eigenaar; admin doet alles.
create policy oefeningen_lezen on public.oefeningen for select to anon, authenticated
  using (status = 'gepubliceerd' or (select public.is_admin()));
create policy oefeningen_voorstellen on public.oefeningen for insert to anon
  with check (status = 'concept' and created_by is null and tekening_pad is null);
create policy oefeningen_admin on public.oefeningen for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- planning: iedereen leest gepubliceerde regels, admin doet alles
create policy planning_lezen on public.planning for select to anon, authenticated
  using (gepubliceerd or (select public.is_admin()));
create policy planning_admin on public.planning for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- bronnen, koppelingen, trainingen: (nog) niet in gebruik, alleen admin
create policy bronnen_admin on public.bronnen for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy ob_admin on public.oefening_bronnen for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy trainingen_admin on public.trainingen for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy tk_admin on public.trainingen_kernen for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ============ Tekeningen (Storage) ============
-- Lezen voor iedereen (nodig voor bibliotheek en pdf); uploaden en verwijderen alleen admin.
create policy "tekeningen_lezen" on storage.objects for select to anon, authenticated
  using (bucket_id = 'tekeningen');
create policy "tekeningen_admin_uploaden" on storage.objects for insert to authenticated
  with check (bucket_id = 'tekeningen' and (select public.is_admin()));
create policy "tekeningen_admin_verwijderen" on storage.objects for delete to authenticated
  using (bucket_id = 'tekeningen' and (select public.is_admin()));
