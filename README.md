# Trainingsmaker Westland Wil Vooruit Jeugd

De Trainingsmaker voor de jeugdtrainers van Westland Wil Vooruit. Trainers openen hem zonder wachtwoord, zien de planning (de eerstvolgende training, komende en vorige trainingen), zien op de homepage een voorgestelde training (warming-up, 2 tot 4 oefeningen, cooling-down), gebruiken die met één knop als pdf in de huisstijl, of bouwen de training zelf op uit de bibliotheek of met een eigen oefening.

- **Voorkant:** platte HTML/CSS/JS op GitHub Pages. Geen build-stap.
- **Database en login:** Supabase (project `trainingsbouwer`, eu-central-1).
- **Pdf:** wordt in de browser gemaakt met jsPDF. Er wordt niets naar een andere server gestuurd.

## Veldrijden en wielrennen
Bij **Training maken** en in de **Bibliotheek** kies je bovenaan *Veldrijden* of *Wielrennen*; je ziet dan alleen oefeningen van die discipline. De app onthoudt de laatste keuze op dat apparaat, wisselen kan altijd. *Zelf een training maken* begint met dezelfde vraag. De planning toont beide disciplines, met per training de discipline erbij; de voorgestelde training gebruikt alleen oefeningen van de discipline van die training. Elke planningregel heeft een `discipline` (`veldrit` of `weg`, migratie `20261115194710`).

## Onderdelen
| Tabblad | Wat |
|---|---|
| Planning (homepage) | Voorgestelde training voor de eerstvolgende datum: uitklapbaar per oefening (leren, let op, nodig), knop *Gebruik deze training* (pdf) en link *Training anders opbouwen*. Daaronder komende en vorige trainingen. Admin: trainingen inplannen, bewerken, verbergen |
| Training maken | Twee tabbladen. **Zelf een training maken**: datum (start altijd 18:30), groepen en thema (titel = datum \| thema); warming-up uit 3 willekeurige voorbeelden; 2–4 oefeningen, per oefening een thema met 2 willekeurige voorbeelden of een eigen oefening (naam, wat je doet, wat ze leren, waar je op let, wat je nodig hebt); cooling-down; succescriteria, wat je niet nastreeft, vaste regels aanvinken plus eigen regels; pdf. **Training samenstellen**: swipen na Start |
| Bibliotheek | Zoeken en filteren op soort, thema en groep |
| Oefening toevoegen | Nieuwe oefening (warming-up, kern of cooling-down) direct in de gedeelde bibliotheek, met trefwoorden en optioneel een YouTube-filmpje (tekening alleen voor de admin) |
| Voorstel swipen | Alleen admin, vanaf een training in de planning: per onderdeel rechts (in de training), links (andere) of shuffle; het goedgekeurde voorstel zien de trainers op de homepage |
| Beheer | Alleen admin: oude concepten publiceren of verwijderen |

## Voorgestelde training
- De admin plant een training met **trefwoorden** (bijvoorbeeld *bunnyhop, korte draai, op- en afstappen*). Twee trainingen op één dag (bijvoorbeeld groep 3 apart) = twee regels met dezelfde datum en elk eigen groepen; de homepage toont ze allebei.
- Bij *Voorstel swipen* stelt de app per onderdeel een oefening voor (warming-up, 2 tot 4 oefeningen, cooling-down). Rechts = in de training, links = afgewezen en een andere, shuffle = een andere zonder oordeel. Elke swipe komt in `voorstel_beoordelingen` en telt mee bij volgende voorstellen. Het resultaat staat in `planning_onderdelen`.
- Is er (nog) geen goedgekeurd voorstel, dan maakt de browser er zelf een op basis van trefwoorden, titel en omschrijving.
- Later kan de AI-functie (subproject 07) het voorstellen overnemen.

## Rollen en beveiliging
| Rol | Inloggen | Mag |
|---|---|---|
| **Trainer** | Nee, gewoon de site openen | Gepubliceerde planning en oefeningen zien, training maken en pdf downloaden, oefening direct toevoegen aan de bibliotheek (zonder tekening) |
| **Admin** | Knop *Admin*, alleen een wachtwoord | Alles: planning beheren, voorstellen publiceren, alle data |

- Omdat trainers geen wachtwoord hebben, praat de pagina rechtstreeks met Supabase. Het projectadres en de **publishable key** staan daarom in `js/config.js`. Dat is bewust (besluit 15-11-2026). Zet hier nooit een secret of service-role key.
- Wat iemand zonder account mag, is vastgelegd met Row Level Security (migraties `20261115134710_rollen_admin_planning_anoniem` en `20261115180710_voorstellen_swipen_youtube_direct_publiceren`): lezen van gepubliceerde planning, voorstellen, thema's en oefeningen, en een oefening direct toevoegen (zonder tekening, met lengtegrens). Iedereen met de link kan dat dus ook; de admin kan een oefening altijd verwijderen in de bibliotheek. Swipes zijn alleen voor de admin.
- Het **admin-wachtwoord staat nergens in de code**. In `js/config.js` staat alleen het adres van het admin-account; het wachtwoord typ je in en wordt door Supabase gecontroleerd (met bescherming tegen te veel pogingen).
- Alleen accounts met rol `admin` in `profielen` zijn admin. Een ander account krijgt geen extra rechten.
- Tekeningen staan in de private Storage-bucket `tekeningen`: iedereen kan ze lezen (nodig voor de pdf), alleen de admin uploadt of verwijdert.
- Strikte Content-Security-Policy: scripts en lettertypes alleen van de eigen site, verbindingen alleen naar het Supabase-project, afbeeldingen ook van `westlandwilvooruit.nl` (logo en pijl komen rechtstreeks van de clubsite), filmpjes alleen via `www.youtube-nocookie.com` (`frame-src`).
- Bibliotheken (supabase-js 2.119.0, jsPDF 2.5.1, jsPDF-AutoTable 3.8.2) staan in `vendor/`, lettertypes (Kanit, Montserrat, OFL-licentie) in `fonts/`. Er wordt geen code van een CDN geladen.

## Eenmalig instellen
1. **GitHub Pages:** Settings → Pages → Source: *GitHub Actions*. Elke push naar `main` publiceert automatisch (`.github/workflows/deploy.yml`).
2. **Supabase Auth** (dashboard → Authentication):
   - Zet open aanmelding uit (*Allow new users to sign up* uit).
   - *Users → Add user → Create new user*: e-mail `admin@training.westlandwilvooruit.nl` (staat in `js/config.js`), jouw admin-wachtwoord, *Auto Confirm User* aan.
3. **Admin-rol geven** (SQL Editor):
   ```sql
   insert into public.profielen (id, naam, rol)
   select id, 'Admin', 'admin' from auth.users where email = 'admin@training.westlandwilvooruit.nl'
   on conflict (id) do update set rol = 'admin';
   ```
4. **Admin-wachtwoord wijzigen:** in Supabase bij *Users* → het admin-account → *Reset/Change password*. In de code hoeft niets te veranderen.
5. **Eigen domein:**
   - Verifieer eerst het domein in GitHub (organisatie-instellingen → Pages).
   - Maak daarna bij Hostnet een CNAME `training` naar `<organisatie>.github.io`.
   - Vul het domein in bij Settings → Pages en zet *Enforce HTTPS* aan.
   - Laat de MX/SPF-records van de e-mail ongemoeid.

## Oefeningen schrijven
Schrijf "de renner/renster" (nooit "hij"), kort en bondig, zonder verwijzingen naar eerdere trainingen. Gebruik groep 1, 2 en 3 (beginnend, gevorderd, pro). Cooling-down is altijd "Trainerskeuze".

## Mappen
```
index.html          de pagina
css/ js/ img/       stijl, code, kopbalk en vaste tekeningen
fonts/              Kanit en Montserrat (zelf gehost)
vendor/             supabase-js, jsPDF, AutoTable (met licenties)
supabase/           SQL-migraties
tests/              Playwright-test met een nep-Supabase
```

## Migraties
De bestanden in `supabase/migrations/` hebben hetzelfde versienummer als in Supabase (Database → Migrations).
De migratie `20261114175658_bibliotheek_startoefeningen` (5 thema's en 20 startoefeningen) staat alleen in Supabase; de inhoud van de bibliotheek wordt daar beheerd.
Nieuwe tabellen of kolommen eerst melden in de overzichtschat (zie het projectoverzicht).
