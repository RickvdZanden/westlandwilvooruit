-- Thema's voor wegwielrennen + meerdere thema's per oefening (akkoord Rick 15-11-2026, subchat 08).
-- 1. Nieuwe thema's (Starts, sprint en tempo en Techniek en materiaal bestonden al).
insert into public.themas (naam, kort, volgorde) values
  ('Bochten en lijnkeuze', 'Insturen, kijken, lijnen kiezen, afdalen', 6),
  ('Groepsrijden en waaier', 'Waaier, molentje, 2-aan-2, ploegentijdrit', 7),
  ('Klimmen', 'Klimtechniek, herhalingen, klimsprint', 8),
  ('Koers en tactiek', 'Positioneren, gaten dichtrijden, koersjes', 9),
  ('Duur en souplesse', 'Duurblokken, souplesse, eenbenig trappen, kracht', 10);

-- 2. Meerdere thema's per oefening; thema_id blijft het hoofdthema.
alter table public.oefeningen add column thema_ids uuid[] not null default '{}';
comment on column public.oefeningen.thema_ids is 'Alle thema''s van de oefening (hoofdthema = thema_id staat er ook in).';
update public.oefeningen set thema_ids = array[thema_id] where thema_id is not null;
create index oefeningen_thema_ids_idx on public.oefeningen using gin (thema_ids);

-- 3. Wegoefeningen (kern) zonder thema indelen op trefwoorden en titel:
--    eerste trefwoord telt 3, elk passend trefwoord 1, passend woord in de titel 2.
--    Hoofdthema = hoogste score; elk thema met score >= 2 komt in thema_ids.
with t(naam, prio, tags, titel) as (values
 ('Klimmen',1, array['klim','klimtechniek'], array['klim']),
 ('Koers en tactiek',2, array['koers','tactiek','positioneren','gat dichtrijden','wedstrijdvorm','kopman','knecht','wielkeuze','krachten verdelen','timing'], array['koers','tactiek','positi']),
 ('Groepsrijden en waaier',3, array['waaier','molentje','groepsrijden','2-aan-2','wiel zitten','kopbeurt','ploegentijdrit','communiceren','derny','samenwerken','wind'], array['waaier','molentje','ploegentijdrit','groep']),
 ('Bochten en lijnkeuze',4, array['bochten','lijnkeuze','kijken','insturen','laat insturen','leunen','sturen','doortrappen','afdalen'], array['bocht','lijn']),
 ('Starts, sprint en tempo',5, array['sprint','tempo','intervallen','starts','surplace','lead-out','aanzetten','herstel','doseren','vo2max','reactie','tellen','uit het wiel'], array['sprint','tempo','start']),
 ('Duur en souplesse',6, array['duur','souplesse','eenbenig','trapbeweging','kracht','thuistraining','stil bovenlichaam'], array['duur','souplesse','eenbenig','roller']),
 ('Techniek en materiaal',7, array['slalom','balans','1 hand','bunnyhop','180 graden','contact','duo','stuurcontrole','bidon','remmen','controle','basisvaardigheid','vertrouwen','techniek','schakelen'], array['techniek','slalom','parcours'])),
o as (select id, titel, tags from public.oefeningen where soort = 'kern' and discipline = 'weg' and thema_id is null),
s as (select o.id, th.id thema, t.prio,
  (case when lower(o.tags[1]) = any(t.tags) then 3 else 0 end)
  + (select count(*) from unnest(o.tags) x where lower(x) = any(t.tags))
  + (case when exists (select 1 from unnest(t.titel) w where lower(o.titel) like '%' || w || '%') then 2 else 0 end) score
  from o cross join t join public.themas th on th.naam = t.naam),
hoofd as (select distinct on (id) id, thema from s order by id, score desc, prio),
alle as (select id, array_agg(thema order by score desc, prio) filter (where score >= 2) themas from s group by id)
update public.oefeningen e set thema_id = h.thema,
  thema_ids = (select array_agg(distinct x) from unnest(array[h.thema] || coalesce(a.themas, '{}')) x)
from hoofd h join alle a using (id) where e.id = h.id;
