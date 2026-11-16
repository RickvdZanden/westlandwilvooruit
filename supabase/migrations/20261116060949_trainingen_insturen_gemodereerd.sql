-- Trainingen die trainers maken worden bewaard en door de admin gemodereerd (akkoord Rick 16-11-2026, subchat 08).
-- Een trainer (anoniem) stuurt een training in via één functie: training_insturen(jsonb).
-- Eigen warming-up, oefeningen en cooling-down komen als concept in de bibliotheek,
-- een eigen thema als tekst bij de training. De admin keurt goed, verwijdert, of maakt van
-- een eigen thema een echt thema. Anoniem kan niets lezen of wijzigen: alleen insturen.

-- ============ trainingen uitbreiden ============
alter table public.trainingen
  add column status text not null default 'concept' check (status in ('concept', 'goedgekeurd')),
  add column datum date,
  add column thema_id uuid references public.themas (id) on delete set null,
  add column thema_eigen text,
  add column niveaus smallint[] not null default '{}',
  add column cooldown_id uuid references public.oefeningen (id) on delete set null,
  add column regels text[] not null default '{}',
  add constraint trainingen_lengtes check (
        char_length(coalesce(titel, '')) <= 200
    and char_length(coalesce(thema, '')) <= 200
    and char_length(coalesce(thema_eigen, '')) <= 100
    and char_length(coalesce(groepen, '')) <= 200
    and char_length(coalesce(datum_tekst, '')) <= 100
    and char_length(coalesce(niet_nastreven, '')) <= 2000
    and char_length(coalesce(succescriteria, '')) <= 2000
    and coalesce(cardinality(regels), 0) <= 20
    and char_length(coalesce(array_to_string(regels, ' '), '')) <= 3000
    and coalesce(cardinality(niveaus), 0) <= 3
  );
create index trainingen_status_idx on public.trainingen (status, created_at desc);
create index trainingen_thema_idx on public.trainingen (thema_id);
alter table public.trainingen_kernen add constraint tk_eigen_lengte check (pg_column_size(eigen) <= 20000);

-- ============ hulpfunctie: oefening uit een inzending ============
-- {"id": "<uuid>"}  → bestaande, gepubliceerde oefening van de juiste soort
-- {"eigen": {...}, "thema_id": "<uuid>"} → nieuwe concept-oefening in de bibliotheek
create or replace function private.oefening_uit_inzending(d jsonb, p_soort text, p_disc text, p_niv smallint[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb;
  v_id uuid;
  v_thema uuid;
  v_titel text;
  v_uitleg text;
begin
  if d is null or jsonb_typeof(d) <> 'object' then return null; end if;
  if d ? 'id' then
    select id into v_id from public.oefeningen
      where id = (d ->> 'id')::uuid and status = 'gepubliceerd' and soort = p_soort;
    if v_id is null then raise exception 'Onbekende oefening.' using errcode = '22023'; end if;
    return v_id;
  end if;
  e := d -> 'eigen';
  if e is null or jsonb_typeof(e) <> 'object' then return null; end if;
  v_titel := btrim(coalesce(e ->> 'titel', ''));
  v_uitleg := btrim(coalesce(e ->> 'uitleg', ''));
  if v_titel = '' or v_uitleg = '' then raise exception 'Een eigen oefening heeft een naam en een korte uitleg nodig.' using errcode = '22023'; end if;
  if nullif(d ->> 'thema_id', '') is not null then
    select id into v_thema from public.themas where id = (d ->> 'thema_id')::uuid;
  end if;
  insert into public.oefeningen (soort, discipline, titel, uitleg, doel, coach, materiaal, duur, intensiteit,
                                 thema_id, thema_ids, niveaus, tags, status, created_by)
  values (p_soort, p_disc, v_titel, v_uitleg,
          nullif(btrim(coalesce(e ->> 'doel', '')), ''), nullif(btrim(coalesce(e ->> 'coach', '')), ''),
          nullif(btrim(coalesce(e ->> 'materiaal', '')), ''), 'Naar keuze van de trainer', 'Naar keuze van de trainer.',
          v_thema, case when v_thema is null then '{}'::uuid[] else array[v_thema] end,
          case when cardinality(p_niv) > 0 then p_niv else '{1,2,3}'::smallint[] end, '{}', 'concept', null)
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function private.oefening_uit_inzending(jsonb, text, text, smallint[]) from public, anon, authenticated;

-- ============ training insturen ============
create or replace function public.training_insturen(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_disc text := p ->> 'discipline';
  v_niv smallint[];
  v_thema uuid;
  v_warm uuid;
  v_cool uuid;
  v_oef uuid;
  k jsonb;
  i int := 0;
  n int;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'Ongeldige training.' using errcode = '22023'; end if;
  if v_disc is null or v_disc not in ('veldrit', 'weg') then raise exception 'Kies veldrijden of wielrennen.' using errcode = '22023'; end if;
  if jsonb_typeof(p -> 'kernen') <> 'array' then raise exception 'Geen oefeningen.' using errcode = '22023'; end if;
  n := jsonb_array_length(p -> 'kernen');
  if n < 2 or n > 4 then raise exception 'Een training heeft 2 tot 4 oefeningen.' using errcode = '22023'; end if;

  -- rem tegen misbruik: niet te veel inzendingen achter elkaar, niet te veel wachtend
  perform pg_advisory_xact_lock(hashtext('trainingen_insturen'));
  if (select count(*) from public.trainingen where status = 'concept' and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Er zijn net veel trainingen opgeslagen. Probeer het over een paar minuten opnieuw.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.trainingen where status = 'concept') >= 200 then
    raise exception 'Er wachten al veel trainingen op goedkeuring. Probeer het later opnieuw.' using errcode = 'P0001';
  end if;

  v_niv := coalesce((select array_agg(distinct x::smallint) from jsonb_array_elements_text(coalesce(p -> 'niveaus', '[]')) x where x in ('1', '2', '3')), '{}');
  if nullif(p ->> 'thema_id', '') is not null then
    select id into v_thema from public.themas where id = (p ->> 'thema_id')::uuid;
  end if;

  v_warm := private.oefening_uit_inzending(p -> 'warm', 'warming-up', v_disc, v_niv);
  if v_warm is null then raise exception 'Kies een warming-up of schrijf er zelf een.' using errcode = '22023'; end if;
  v_cool := private.oefening_uit_inzending(p -> 'cool', 'cooling-down', v_disc, v_niv); -- leeg = trainerskeuze

  insert into public.trainingen (id, status, discipline, datum, datum_tekst, titel, thema, thema_id, thema_eigen, groepen, niveaus,
                                 warmingup_id, cooldown_id, niet_nastreven, succescriteria, regels, created_by)
  values (v_id, 'concept', v_disc, nullif(p ->> 'datum', '')::date, left(p ->> 'datum_tekst', 100), left(p ->> 'titel', 200),
          left(p ->> 'thema', 200), v_thema, nullif(left(btrim(coalesce(p ->> 'thema_eigen', '')), 100), ''), left(p ->> 'groepen', 200), v_niv,
          v_warm, v_cool, left(p ->> 'niet', 2000), left(p ->> 'succes', 2000),
          coalesce((select array_agg(left(r, 300)) from (select jsonb_array_elements_text(coalesce(p -> 'regels', '[]')) r limit 20) x), '{}'),
          (select auth.uid()));

  for k in select value from jsonb_array_elements(p -> 'kernen') loop
    i := i + 1;
    v_oef := private.oefening_uit_inzending(k, 'kern', v_disc, v_niv);
    if v_oef is null then raise exception 'Oefening % ontbreekt.', i using errcode = '22023'; end if;
    insert into public.trainingen_kernen (training_id, volgorde, oefening_id, eigen)
    values (v_id, i, v_oef, case when k ? 'eigen' then k -> 'eigen' else null end);
  end loop;
  return v_id;
end
$$;
revoke all on function public.training_insturen(jsonb) from public;
grant execute on function public.training_insturen(jsonb) to anon, authenticated;
