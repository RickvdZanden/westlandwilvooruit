# Import trainingen 2026 uit Google Drive (15-11-2026)

Direct in Supabase gezet (project `trainingsbouwer`), niet als migratie: het is inhoud, geen schema.

**Bron:** Google Drive, map *Trainingen jeugd Westland Wil Vooruit / 1. Trainingen* (39 trainingsdocumenten, 10 feb t/m 20 okt 2026), aangevuld met *Seizoensplanning 2026* (soort training) en de trainingsvormen *Schouder aan schouder* en *Boter, kaas en eieren*. Van documenten met meerdere versies is de nieuwste gebruikt.

**Resultaat:**
- `planning`: alle 39 trainingen hebben een omschrijving (thema, doel, succescriteria, niet nastreven), groep, trefwoorden en waar bekend een begintijd (18:30).
- `oefeningen`: 105 nieuwe oefeningen (warming-up, kern, cooling-down), allemaal gepubliceerd. Een oefening die in meerdere trainingen terugkomt, staat er één keer in en is meerdere keren gekoppeld.
- `planning_onderdelen`: 154 koppelingen. Elke training toont daarmee precies de warming-up, kernen en cooling-down van het originele document; een ontbrekende warming-up = *Trainerskeuze*, een ontbrekende cooling-down = leeg (trainerskeuze).
- Ook in de bibliotheek, zonder datum: *Krachttraining op de fiets* en *Krachttraining op de roller*.

Daarom toont de app een vastgelegde training ook als die maar 1 kernoefening had (19 mrt, 14 apr Snelheid, 21 apr De laatste ronde, 28 apr, 7 mei).
