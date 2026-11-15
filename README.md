# Trainingsmaker Westland Wil Vooruit Jeugd

De Trainingsmaker voor de jeugdtrainers van Westland Wil Vooruit. Trainers openen hem met één gedeeld wachtwoord, kiezen een warming-up en 2 of 3 kernen uit de bibliotheek (of schrijven zelf een kern met een tekening) en downloaden een pdf in de huisstijl.

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
### Wachtwoordslot (geen e-mail-login)
- De site is afgesloten met een wachtwoord. Er is geen e-mail-login of magic link meer.
- **In de broncode staat geen wachtwoord en geen Supabase-adres of -sleutel.** `js/sleutels.json` bevat alleen versleutelde gegevens (AES-GCM-256, sleutel afgeleid van het wachtwoord met PBKDF2-SHA256, 600.000 rondes).
- Klopt het wachtwoord, dan ontsleutelt de browser de Supabase-gegevens plus een **gedeeld Supabase-account** en logt daarmee in. Per wachtwoord is er een eigen account, dus je kunt een trainerswachtwoord en een beheerwachtwoord hebben.
- "Onthoud op dit apparaat" bewaart de ontsleutelde gegevens in de browser van dat apparaat. "Vergrendelen" wist ze weer.
- Na het openen ziet iemand met het wachtwoord in de netwerkverkeer-tab van de browser wél het Supabase-adres. Dat is niet te voorkomen. Echte bescherming van de data blijft daarom Row Level Security.
- Kies een lang wachtwoord (bijvoorbeeld 4 losse woorden). Het versleutelde bestand is openbaar en kan offline geprobeerd worden.

### Database
- Toegang wordt geregeld met Row Level Security in Supabase:
  - Anonieme bezoekers zien niets.
  - Alleen accounts met een rij in `profielen` mogen erin. Rol `trainer` voegt concepten toe, rol `beheerder` publiceert.
- Tekeningen staan in de private Storage-bucket `tekeningen`. Uploaden kan alleen in de eigen map (`<user-id>/…`), maximaal 2 MB, PNG of JPG.
- Strikte Content-Security-Policy: scripts en lettertypes alleen van de eigen site, verbindingen alleen naar `*.supabase.co`, afbeeldingen ook van `westlandwilvooruit.nl` (logo en pijl komen rechtstreeks van de clubsite).
- Bibliotheken (supabase-js 2.119.0, jsPDF 2.5.1, jsPDF-AutoTable 3.8.2) staan in `vendor/`, lettertypes (Kanit, Montserrat, OFL-licentie) in `fonts/`. Er wordt geen code van een CDN geladen.

## Eenmalig instellen
1. **GitHub Pages:** Settings → Pages → Source: *GitHub Actions*. Elke push naar `main` publiceert automatisch (`.github/workflows/deploy.yml`).
2. **Supabase Auth** (dashboard → Authentication):
   - Zet open aanmelding uit (*Allow new users to sign up* uit).
   - Maak bij *Users → Add user → Create new user* het gedeelde account aan, bijvoorbeeld `trainingsmaker-trainer@westlandwilvooruit.nl`, met een lang willekeurig wachtwoord en *Auto Confirm User* aan. Optioneel een tweede account voor beheer.
3. **Account een rol geven:** zet het gebruikers-id van elk account in `profielen` (rol `trainer` of `beheerder`).
4. **Wachtwoord instellen:** open `tools/versleutel.html` op je eigen computer (dubbelklik, het werkt offline). Vul de Project URL, de publishable key, het toegangswachtwoord en de accountgegevens in. Zet de uitkomst in `js/sleutels.json`, commit en push.
   - **Wachtwoord wijzigen** = opnieuw stap 4. Wil je dat oude apparaten er ook uit liggen, verander dan ook het wachtwoord van het gedeelde account in Supabase.
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
js/sleutels.json    versleutelde instellingen voor het wachtwoordslot
fonts/              Kanit en Montserrat (zelf gehost)
tools/              versleutel.html: sleutels maken (wordt niet gepubliceerd)
vendor/             supabase-js, jsPDF, AutoTable (met licenties)
supabase/           SQL-migraties
tests/              Playwright-test met een nep-Supabase en nep-sleutels
```

## Migraties
De bestanden in `supabase/migrations/` hebben hetzelfde versienummer als in Supabase (Database → Migrations).
De migratie `20261114175658_bibliotheek_startoefeningen` (5 thema's en 20 startoefeningen) staat alleen in Supabase; de inhoud van de bibliotheek wordt daar beheerd.
Nieuwe tabellen of kolommen eerst melden in de overzichtschat (zie het projectoverzicht).
