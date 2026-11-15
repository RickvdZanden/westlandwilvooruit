-- Homepage & admin-swipen (subchat 08, akkoord Rick 15-11-2026).
-- 1. Oefeningen: soort cooling-down, YouTube-link; trainers publiceren direct (geen goedkeuring meer).
-- 2. Planning: trefwoorden per training (meerdere trainingen per datum = meerdere regels).
-- 3. planning_onderdelen: het door de admin goedgekeurde voorstel per training.
-- 4. voorstel_beoordelingen: elke swipe, zodat volgende voorstellen beter worden.

-- ============ 1. Oefeningen ============
alter table public.oefeningen drop constraint oefeningen_soort_check;
alter table public.oefeningen add constraint oefeningen_soort_check
  check (soort in ('warming-up', 'kern', 'cooling-down'));

alter table public.oefeningen add column youtube_url text;
alter table public.oefeningen add constraint oefeningen_youtube_check
  check (youtube_url is null or youtube_url ~* '^https://(www\.|m\.)?(youtube\.com|youtu\.be)/');

-- Trainers (anoniem) zetten een oefening direct in de gedeelde bibliotheek.
-- Nog steeds zonder eigenaar en zonder tekening (uploaden blijft voor de admin).
drop policy oefeningen_voorstellen on public.oefeningen;
create policy oefeningen_toevoegen on public.oefeningen for insert to anon
  with check (status = 'gepubliceerd' and created_by is null and tekening_pad is null
              and char_length(titel) <= 200 and char_length(uitleg) <= 5000);

-- ============ 2. Planning ============
alter table public.planning add column trefwoorden text[] not null default '{}';
comment on column public.planning.trefwoorden is 'Trefwoorden waarop de voorgestelde training wordt samengesteld.';

-- ============ 3. Goedgekeurd voorstel ============
create table public.planning_onderdelen (
  planning_id uuid not null references public.planning (id) on delete cascade,
  positie smallint not null check (positie between 0 and 9),
  soort text not null check (soort in ('warming-up', 'kern', 'cooling-down')),
  oefening_id uuid references public.oefeningen (id) on delete cascade, -- null = trainerskeuze (alleen cooling-down)
  created_at timestamptz not null default now(),
  primary key (planning_id, positie),
  check (oefening_id is not null or soort = 'cooling-down')
);
create index planning_onderdelen_oefening_idx on public.planning_onderdelen (oefening_id);
alter table public.planning_onderdelen enable row level security;
revoke all on public.planning_onderdelen from anon;
grant select on public.planning_onderdelen to anon;

create policy po_lezen on public.planning_onderdelen for select to anon, authenticated
  using (exists (select 1 from public.planning p where p.id = planning_id and (p.gepubliceerd or (select public.is_admin()))));
create policy po_admin on public.planning_onderdelen for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ============ 4. Beoordelingen (swipes) ============
create table public.voorstel_beoordelingen (
  id uuid primary key default gen_random_uuid(),
  planning_id uuid references public.planning (id) on delete set null,
  oefening_id uuid not null references public.oefeningen (id) on delete cascade,
  oordeel text not null check (oordeel in ('goed', 'afgewezen')),
  trefwoorden text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index voorstel_beoordelingen_oefening_idx on public.voorstel_beoordelingen (oefening_id);
create index voorstel_beoordelingen_planning_idx on public.voorstel_beoordelingen (planning_id);
alter table public.voorstel_beoordelingen enable row level security;
revoke all on public.voorstel_beoordelingen from anon;

create policy vb_admin on public.voorstel_beoordelingen for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
