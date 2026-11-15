-- Schema en beveiliging van project trainingsbouwer (al toegepast op 14-11-2026).
-- Overgenomen uit de migratiegeschiedenis van Supabase, zodat het schema ook in de repo staat.

-- ============ Tabellen ============
create table public.profielen (
  id uuid primary key references auth.users(id) on delete cascade,
  naam text,
  rol text not null default 'trainer' check (rol in ('beheerder','trainer')),
  created_at timestamptz not null default now()
);

create table public.themas (
  id uuid primary key default gen_random_uuid(),
  naam text not null unique,
  kort text,
  volgorde int not null default 0
);

create table public.oefeningen (
  id uuid primary key default gen_random_uuid(),
  soort text not null default 'kern' check (soort in ('kern','warming-up')),
  discipline text not null default 'veldrit' check (discipline in ('veldrit','weg')),
  titel text not null,
  thema_id uuid references public.themas(id) on delete set null,
  groepen text,
  niveaus smallint[] not null default '{1,2,3}',
  duur text,
  uitleg text not null,
  intensiteit text,
  differentiatie text,
  doel text,
  materiaal text,
  coach text,
  tekening_pad text,
  tags text[] not null default '{}',
  status text not null default 'concept' check (status in ('concept','gepubliceerd')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bronnen (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  url text not null check (url ~* '^https?://'),
  type text not null default 'video' check (type in ('video','artikel','overig')),
  onderwerp text,
  niveaus smallint[] not null default '{1,2,3}',
  samenvatting text,
  coachpunten text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.oefening_bronnen (
  oefening_id uuid not null references public.oefeningen(id) on delete cascade,
  bron_id uuid not null references public.bronnen(id) on delete cascade,
  primary key (oefening_id, bron_id)
);

create table public.trainingen (
  id uuid primary key default gen_random_uuid(),
  discipline text not null default 'veldrit' check (discipline in ('veldrit','weg')),
  datum_tekst text,
  titel text,
  thema text,
  groepen text,
  warmingup_id uuid references public.oefeningen(id) on delete set null,
  niet_nastreven text,
  succescriteria text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.trainingen_kernen (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.trainingen(id) on delete cascade,
  volgorde int not null,
  oefening_id uuid references public.oefeningen(id) on delete set null,
  duur text,
  eigen jsonb
);

create index on public.oefeningen (thema_id);
create index on public.oefeningen (created_by);
create index on public.bronnen (created_by);
create index on public.oefening_bronnen (bron_id);
create index on public.trainingen (created_by);
create index on public.trainingen (warmingup_id);
create index on public.trainingen_kernen (training_id);
create index on public.trainingen_kernen (oefening_id);

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger oefeningen_updated before update on public.oefeningen
  for each row execute function public.set_updated_at();

-- ============ Hulpfuncties (omzeilen RLS bewust, geen toegang voor anoniem) ============
create or replace function public.is_trainer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profielen where id = (select auth.uid()));
$$;
create or replace function public.is_beheerder() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profielen where id = (select auth.uid()) and rol = 'beheerder');
$$;
revoke execute on function public.is_trainer() from public, anon;
revoke execute on function public.is_beheerder() from public, anon;
grant execute on function public.is_trainer() to authenticated;
grant execute on function public.is_beheerder() to authenticated;

-- ============ Row Level Security ============
alter table public.profielen enable row level security;
alter table public.themas enable row level security;
alter table public.oefeningen enable row level security;
alter table public.bronnen enable row level security;
alter table public.oefening_bronnen enable row level security;
alter table public.trainingen enable row level security;
alter table public.trainingen_kernen enable row level security;

-- profielen: eigen profiel lezen, beheerder beheert alles
create policy profielen_lezen on public.profielen for select to authenticated
  using (id = (select auth.uid()) or (select public.is_beheerder()));
create policy profielen_beheer on public.profielen for all to authenticated
  using ((select public.is_beheerder())) with check ((select public.is_beheerder()));

-- themas: trainers lezen, beheerder schrijft
create policy themas_lezen on public.themas for select to authenticated
  using ((select public.is_trainer()));
create policy themas_beheer on public.themas for all to authenticated
  using ((select public.is_beheerder())) with check ((select public.is_beheerder()));

-- oefeningen: gepubliceerd voor alle trainers, concepten alleen eigen; trainers voegen alleen concepten toe
create policy oefeningen_lezen on public.oefeningen for select to authenticated
  using ((select public.is_trainer()) and (status = 'gepubliceerd' or created_by = (select auth.uid()) or (select public.is_beheerder())));
create policy oefeningen_toevoegen on public.oefeningen for insert to authenticated
  with check ((select public.is_beheerder()) or ((select public.is_trainer()) and status = 'concept' and created_by = (select auth.uid())));
create policy oefeningen_wijzigen on public.oefeningen for update to authenticated
  using ((select public.is_beheerder()) or ((select public.is_trainer()) and created_by = (select auth.uid()) and status = 'concept'))
  with check ((select public.is_beheerder()) or ((select public.is_trainer()) and created_by = (select auth.uid()) and status = 'concept'));
create policy oefeningen_verwijderen on public.oefeningen for delete to authenticated
  using ((select public.is_beheerder()) or ((select public.is_trainer()) and created_by = (select auth.uid()) and status = 'concept'));

-- bronnen: trainers lezen en voegen toe, eigen of beheerder wijzigt
create policy bronnen_lezen on public.bronnen for select to authenticated
  using ((select public.is_trainer()));
create policy bronnen_toevoegen on public.bronnen for insert to authenticated
  with check ((select public.is_trainer()) and created_by = (select auth.uid()));
create policy bronnen_wijzigen on public.bronnen for update to authenticated
  using ((select public.is_beheerder()) or created_by = (select auth.uid()))
  with check ((select public.is_beheerder()) or created_by = (select auth.uid()));
create policy bronnen_verwijderen on public.bronnen for delete to authenticated
  using ((select public.is_beheerder()) or created_by = (select auth.uid()));

-- oefening_bronnen: trainers lezen, beheerder koppelt
create policy ob_lezen on public.oefening_bronnen for select to authenticated
  using ((select public.is_trainer()));
create policy ob_beheer on public.oefening_bronnen for all to authenticated
  using ((select public.is_beheerder())) with check ((select public.is_beheerder()));

-- trainingen: alle trainers lezen, eigen schrijven
create policy trainingen_lezen on public.trainingen for select to authenticated
  using ((select public.is_trainer()));
create policy trainingen_toevoegen on public.trainingen for insert to authenticated
  with check ((select public.is_trainer()) and created_by = (select auth.uid()));
create policy trainingen_wijzigen on public.trainingen for update to authenticated
  using ((select public.is_beheerder()) or created_by = (select auth.uid()))
  with check ((select public.is_beheerder()) or created_by = (select auth.uid()));
create policy trainingen_verwijderen on public.trainingen for delete to authenticated
  using ((select public.is_beheerder()) or created_by = (select auth.uid()));

-- trainingen_kernen: volgt de training
create policy tk_lezen on public.trainingen_kernen for select to authenticated
  using ((select public.is_trainer()));
create policy tk_schrijven on public.trainingen_kernen for all to authenticated
  using ((select public.is_beheerder()) or exists (select 1 from public.trainingen t where t.id = training_id and t.created_by = (select auth.uid())))
  with check ((select public.is_beheerder()) or exists (select 1 from public.trainingen t where t.id = training_id and t.created_by = (select auth.uid())));

-- anoniem krijgt geen enkele tabelrechten
revoke all on all tables in schema public from anon;
