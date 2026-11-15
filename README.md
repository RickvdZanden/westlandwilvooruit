# Trainingsmaker Westland Wil Vooruit Jeugd

De Trainingsmaker voor de jeugdtrainers van Westland Wil Vooruit. Trainers openen hem zonder wachtwoord, zien de planning (de eerstvolgende training, komende en vorige trainingen), kiezen een warming-up en 2 of 3 kernen uit de bibliotheek (of schrijven zelf een kern met een tekening) en downloaden een pdf in de huisstijl.

- **Voorkant:** platte HTML/CSS/JS op GitHub Pages. Geen build-stap.
- **Database en login:** Supabase (project `trainingsbouwer`, eu-central-1).
- **Pdf:** wordt in de browser gemaakt met jsPDF. Er wordt niets naar een andere server gestuurd.

## Onderdelen
| Tabblad | Wat |
|---|---|
| Planning | Volgende training (op basis van de datum van vandaag), komende en vorige trainingen. Admin: trainingen inplannen, bewerken, verbergen |
| Training maken | Thema kiezen, kernen aanklikken, eigen kern + tekening, pdf maken |
| Bibliotheek | Zoeken en filteren op soort, thema en groep |
| Oefening voorstellen | Nieuwe oefening als **concept** (tekening alleen voor de admin) |
| Beheer | Alleen admin: voorstellen publiceren of verwijderen |

## Rollen en beveiliging
| Rol | Inloggen | Mag |
|---|---|---|
| **Trainer** | Nee, gewoon de site openen | Gepubliceerde planning en oefeningen zien, training maken en pdf downloaden, oefening voorstellen (concept, zonder tekening) |
| **Admin** | Knop *Admin*, alleen een wachtwoord | Alles: planning beheren, voorstellen publiceren, alle data |

- Omdat trainers geen wachtwoord hebben, praat de pagina rechtstreeks met Supabase. Het projectadres en de **publishable key** staan daarom in `js/config.js`. Dat is bewust (besluit 15-11-2026). Zet hier nooit een secret of service-role key.
- Wat iemand zonder account mag, is vastgelegd met Row Level Security (migratie `20261115140000_rollen_admin_planning_anoniem`): alleen lezen van gepubliceerde planning, thema's en oefeningen, en een concept-oefening voorstellen zonder tekening. Iedereen met de link kan dat dus ook; de admin keurt voorstellen goed.
- Het **admin-wachtwoord staat nergens in de code**. In `js/config.js` staat alleen het adres van het admin-account; het wachtwoord typ je in en wordt door Supabase gecontroleerd (met bescherming tegen te veel pogingen).
- Alleen accounts met rol `admin` in `profielen` zijn admin. Een ander account krijgt geen extra rechten.
- Tekeningen staan in de private Storage-bucket `tekeningen`: iedereen kan ze lezen (nodig voor de pdf), alleen de admin uploadt of verwijdert.
- Strikte Content-Security-Policy: scripts en lettertypes alleen van de eigen site, verbindingen alleen naar het Supabase-project, afbeeldingen ook van `westlandwilvooruit.nl` (logo en pijl komen rechtstreeks van de clubsite).
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
