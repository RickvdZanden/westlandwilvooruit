# Trainingsbouwer Westland Wil Vooruit Jeugd

Trainingsplatform voor de jeugdtrainers van Westland Wil Vooruit. Trainers loggen in met een magic link, kiezen een warming-up en 2 of 3 kernen uit de bibliotheek (of schrijven zelf een kern met een tekening) en downloaden een pdf in de huisstijl.

- **Voorkant:** platte HTML/CSS/JS op GitHub Pages. Geen build-stap.
- **Database en login:** Supabase (project `trainingsbouwer`, eu-central-1).
- **Pdf:** wordt in de browser gemaakt met jsPDF. Er wordt niets naar een andere server gestuurd.

## Onderdelen
| Tabblad | Wat |
|---|---|
| Training maken | Thema kiezen, kernen aanklikken, eigen kern + tekening, pdf maken |
| Bibliotheek | Zoeken en filteren op soort, thema en groep |
| Oefening toevoegen | Nieuwe oefening als **concept**, optioneel met tekening |
| Beheer | Alleen voor beheerders: concepten publiceren of verwijderen |

## Beveiliging
- In `js/config.js` staat alleen de **publishable key**. Die mag publiek. Zet hier nooit een secret of service-role key.
- Toegang wordt geregeld met Row Level Security in Supabase:
  - Anonieme bezoekers zien niets.
  - Alleen gebruikers met een rij in `profielen` zijn trainer.
  - Trainers voegen alleen concepten toe. Beheerders publiceren.
- Tekeningen staan in de private Storage-bucket `tekeningen`. Uploaden kan alleen in de eigen map (`<user-id>/…`), maximaal 2 MB, PNG of JPG.
- De pagina heeft een strikte Content-Security-Policy: scripts alleen van de eigen site, verbindingen alleen naar Supabase.
- Bibliotheken (supabase-js 2.119.0, jsPDF 2.5.1, jsPDF-AutoTable 3.8.2) staan in `vendor/`, dus er wordt geen code van een CDN geladen.

## Eenmalig instellen
1. **GitHub Pages:** Settings → Pages → Source: *GitHub Actions*. Elke push naar `main` publiceert automatisch (`.github/workflows/deploy.yml`).
2. **Supabase Auth** (dashboard → Authentication):
   - Zet open aanmelding uit (*Allow new users to sign up* uit).
   - Zet bij URL Configuration de *Site URL* op het adres van de site. Zet hetzelfde adres ook bij *Redirect URLs* (eerst `https://<organisatie>.github.io/<repo>/`, later `https://training.westlandwilvooruit.nl/`).
   - Nodig trainers uit via *Users → Invite user*.
3. **Trainer activeren:** na de eerste login ziet een nieuwe trainer een code (gebruikers-id). Een beheerder voegt die toe in `profielen` (rol `trainer` of `beheerder`).
4. **Eigen domein:**
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
vendor/             supabase-js, jsPDF, AutoTable (met licenties)
supabase/           SQL-migraties
tests/              Playwright-test met een nep-Supabase
```

## Migraties
De bestanden in `supabase/migrations/` hebben hetzelfde versienummer als in Supabase (Database → Migrations).
De migratie `20261114175658_bibliotheek_startoefeningen` (5 thema's en 20 startoefeningen) staat alleen in Supabase; de inhoud van de bibliotheek wordt daar beheerd.
Nieuwe tabellen of kolommen eerst melden in de overzichtschat (zie het projectoverzicht).
