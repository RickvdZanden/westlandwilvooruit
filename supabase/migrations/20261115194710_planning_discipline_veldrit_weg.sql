-- Harde scheiding veldrijden / wielrennen (akkoord Rick 15-11-2026, subchat 08).
-- Planning krijgt een discipline; bestaande trainingen krijgen de discipline van de meeste
-- gekoppelde oefeningen (archief), anders veldrit.
alter table public.planning add column discipline text not null default 'veldrit'
  check (discipline in ('veldrit', 'weg'));
comment on column public.planning.discipline is 'veldrit = veldrijden, weg = wielrennen. Trainers zien alleen hun eigen discipline.';
update public.planning p set discipline = 'weg'
where (select count(*) filter (where o.discipline = 'weg') - count(*) filter (where o.discipline = 'veldrit')
       from public.planning_onderdelen po join public.oefeningen o on o.id = po.oefening_id
       where po.planning_id = p.id) > 0;
create index planning_discipline_datum_idx on public.planning (discipline, datum);

-- Daarna (los uitgevoerd): gelijkspel in het wegseizoen (vóór 1 september) ook op weg gezet:
-- Tempotraining (19-03), Snelheid (14-04), De laatste ronde (21-04).
update public.planning set discipline = 'weg' where discipline = 'veldrit' and datum < '2026-09-01';
