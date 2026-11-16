"""End-to-end test met een nep-Supabase (er gaat niets naar de echte database).

Draaien:  pip install playwright pypdf && playwright install chromium
          python tests/test_e2e.py
"""
import base64, http.server, json, threading, time, functools, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "out"; OUT.mkdir(exist_ok=True)
FIX = json.loads((ROOT / "tests" / "fixtures.json").read_text())
SB = "https://aeeqkcnaqilttqppljmj.supabase.co"  # alle verzoeken worden onderschept
NU = "2026-11-15T12:00:00"  # zondag 15 november: volgende training is dinsdag 17 november
ME = "u-me"
PNG = (ROOT / "img" / "bidon.png").read_bytes()

def b64(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip("=")
exp = int(time.time()) + 3600
jwt = b64({"alg": "HS256", "typ": "JWT"}) + "." + b64({"sub": ME, "exp": exp, "role": "authenticated", "email": "test@example.com"}) + ".x"
SESSION = {"access_token": jwt, "refresh_token": "r", "expires_in": 3600, "expires_at": exp, "token_type": "bearer",
           "user": {"id": ME, "email": "test@example.com", "aud": "authenticated", "role": "authenticated", "app_metadata": {}, "user_metadata": {}}}

PLAN = [
    {"id": "p0", "datum": "2026-11-10", "start_tijd": "18:30:00", "eind_tijd": "19:45:00", "groep": "Alle groepen", "titel": "Balans en remmen", "omschrijving": None, "locatie": "De Wollebrand", "gepubliceerd": True},
    {"id": "p1", "datum": "2026-11-17", "start_tijd": "18:30:00", "eind_tijd": "19:45:00", "groep": "Alle groepen", "titel": "Bochtentechniek", "omschrijving": "Neem een bidon mee.", "locatie": "De Wollebrand", "gepubliceerd": True},
    {"id": "p2", "datum": "2026-11-24", "start_tijd": "18:30:00", "eind_tijd": None, "groep": "Groep 2 en 3", "titel": "Zandstroken", "omschrijving": None, "locatie": "De Wollebrand", "gepubliceerd": True},
]
PLAN.append({"id": "p4", "datum": "2026-11-19", "start_tijd": "18:30:00", "eind_tijd": None, "groep": "Alle groepen", "titel": "Wegtraining in de waaier", "omschrijving": None, "locatie": None, "gepubliceerd": True, "discipline": "weg", "trefwoorden": ["waaier"]})
PLAN_VERBORGEN = {"id": "p3", "datum": "2026-12-01", "start_tijd": None, "eind_tijd": None, "groep": None, "titel": "Nog geheim", "omschrijving": None, "locatie": "De Wollebrand", "gepubliceerd": False}
WP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 14"><rect width="22" height="14" fill="#12FF46"/></svg>'
def nep_routes(ctx, admin=False):
    ctx.add_init_script("window.TM_NU = %s;" % json.dumps(NU))
    ctx.route(SB + "/**", lambda r, q: handler(r, q, admin))
    ctx.route("https://westlandwilvooruit.nl/**", lambda r, q: r.fulfill(status=200, content_type="image/svg+xml", body=WP_SVG) if q.url.endswith(".svg") else r.fulfill(status=200, content_type="image/png", body=PNG))

calls = []
ONDERDELEN = []
def handler(route, request, admin=False):
    url, m = request.url, request.method
    calls.append((m, url, request.post_data if m in ("POST", "PATCH") and "storage" not in url else None))
    j = lambda body, status=200: route.fulfill(status=status, content_type="application/json", body=json.dumps(body))
    if "/rest/v1/profielen" in url: return j({"rol": "admin"} if admin else None)
    if "/rest/v1/planning?" in url or url.endswith("/rest/v1/planning"):
        if m == "GET": return j(PLAN + ([PLAN_VERBORGEN] if admin else []))
        if m in ("POST", "PATCH"): return j([], 201 if m == "POST" else 200)
        if m == "DELETE": return route.fulfill(status=204, body="")
    if "/rest/v1/themas" in url: return j(FIX["themas"])
    if "/rest/v1/planning_onderdelen" in url:
        if m == "GET": return j(ONDERDELEN)
        if m == "POST": ONDERDELEN.extend(json.loads(request.post_data)); return j([], 201)
        if m == "DELETE": ONDERDELEN.clear(); return route.fulfill(status=204, body="")
    if "/rest/v1/voorstel_beoordelingen" in url:
        if m == "GET": return j([])
        if m == "POST": return j([], 201)
    if "/rest/v1/oefeningen" in url:
        if m == "GET": return j(FIX["oefeningen"])
        if m == "POST":
            row = json.loads(request.post_data); row["id"] = "new1"; FIX["oefeningen"].append(row); return j([], 201)
        if m == "PATCH":
            for o in FIX["oefeningen"]:
                if "eq.a4" in url:
                    if o["id"] == "a4": o["status"] = "gepubliceerd"
            return route.fulfill(status=204, body="")
        if m == "DELETE": return route.fulfill(status=204, body="")
    if "/storage/v1/object" in url:
        if m == "POST" and "/object/tekeningen/" in url: return j({"Key": "tekeningen/x", "Id": "1"})
        if m == "GET": return route.fulfill(status=200, content_type="image/png", body=PNG)
        if m == "DELETE": return j([])
    if "/auth/v1/token" in url: return j(SESSION)
    if "/auth/v1/" in url: return j({})
    return j({"message": "onbekend in test: " + url}, 404)

def serve():
    class Stil(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Stil, directory=str(ROOT))
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

def tik(pg, sel):
    """Klik op een swipe-knop en wacht tot de kaart is weggevlogen."""
    pg.click(sel); pg.wait_for_timeout(350)

def check(cond, msg):
    print(("OK   " if cond else "FOUT ") + msg)
    if not cond: check.failed = True
check.failed = False

srv = serve()
BASE = "http://127.0.0.1:8765/index.html"
with sync_playwright() as p:
    br = p.chromium.launch()
    # 0. geen admin-wachtwoord of secret key in de broncode
    bron = "\n".join(p.read_text() for p in [ROOT / "index.html", *(ROOT / "js").glob("*.js")])
    check("sb_secret" not in bron and "service_role" not in bron, "geen secret key in de broncode")
    check("signInWithOtp" not in bron, "geen e-mail-login meer")

    # 1. trainer: zonder wachtwoord
    errs = []
    ctx = br.new_context(viewport={"width": 900, "height": 1200}); nep_routes(ctx); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector("#plan-volgende .plan--groot")
    check("zondag 15 november 2026" in pg.inner_text("#vandaag").lower(), "app weet dat het vandaag zondag 15 november is")
    volgende = pg.inner_text("#plan-volgende")
    check("Dinsdag 17 november" in volgende and "Over 2 dagen" in volgende and "Bochtentechniek" in volgende, "volgende training = dinsdag 17 november")
    komend = pg.inner_text("#plan-komend")
    check(pg.locator("#plan-komend .event").count() == 2 and "Zandstroken" in komend and "Wegtraining in de waaier" in komend, "planning toont beide disciplines")
    check("Wielrennen" in komend and "Veldrijden" in komend, "met per training de discipline")
    check(pg.locator("[data-pane=planning] .discipline").count() == 0, "geen discipline-keuze op de planning")
    pg.click(".tab[data-tab=bieb]")
    check("Waaier" not in pg.inner_text("#bieb"), "bibliotheek: veldrijden toont geen wegoefeningen")
    pg.click("[data-pane=bieb] .discipline__knop[data-disc=weg]")
    check(pg.locator("#bieb .item").count() == 1 and "Waaier" in pg.inner_text("#bieb"), "bibliotheek: wielrennen toont alleen wegoefeningen")
    check("Techniek en materiaal, Zand, modder en nat" in pg.inner_text("#bieb"), "oefening met meerdere thema's toont ze allemaal")
    pg.click(".tab[data-tab=bouwer]")
    check(pg.input_value("#datum") == "2026-11-17", "datumbewust: op zondag staat de datum al op dinsdag 17 november")
    tip = pg.inner_text("#datum-tip")
    check("eerstvolgende training" in tip and "18:30" in tip and "Bochtentechniek" in tip, "met uitleg en wat er in de planning staat (" + tip + ")")
    check(pg.get_attribute("[data-pane=bouwer] .discipline__knop[data-disc=weg]", "aria-pressed") == "true", "keuze geldt ook bij Training maken")
    check("Waaier" in pg.inner_text("#slots") and "Bidon" not in pg.inner_text("#slots"), "wielrennen: alleen wegoefeningen bij Training maken")
    pg.click("[data-pane=bouwer] .discipline__knop[data-disc=veldrit]")
    check("Waaier" not in pg.inner_text("#slots"), "terug naar veldrijden")
    pg.click(".tab[data-tab=planning]")
    check(pg.locator("#plan-vorig .event").count() == 1 and "Balans en remmen" in pg.inner_text("#plan-vorig"), "afgelopen trainingen als lijst")
    check(pg.inner_text("#plan-vorig-n") == "(1)", "vorige trainingen: 1 (10 november)")
    check(pg.locator("#plan-komend .event__pijl svg").count() == 2, "chevron in de knop")
    with pg.expect_download() as dl1: pg.click("#plan-komend .event:has-text('Zandstroken') .event__knop")
    p1 = OUT / "komend.pdf"; dl1.value.save_as(p1)
    t1 = "\n".join(x.extract_text() for x in PdfReader(str(p1)).pages)
    check("Dinsdag 24 november" in t1 and "Zandstroken" in t1, "komende training in de lijst opent direct de pdf")
    pg.click("#plan-vorig .event a")
    pg.wait_for_selector("[data-pane=training]:not([hidden])")
    check("Balans en remmen" in pg.inner_text("#training-detail") and pg.url.endswith("#training/p0"), "afgelopen training zonder vastgelegde oefeningen linkt naar de eigen pagina")
    pg.click("#training-terug"); pg.wait_for_selector("[data-pane=planning]:not([hidden])")
    check(not pg.url.endswith("#training/p0"), "terug naar de planning")
    check(pg.is_visible("#admin-knop") and pg.is_hidden("#tab-beheer"), "trainer ziet geen beheer, wel de admin-knop")
    check(pg.locator(".alleen-admin:visible").count() == 0, "trainer ziet geen admin-onderdelen")
    check(pg.inner_text("#vandaag") == pg.inner_text("#vandaag").strip() and "ZONDAG" not in pg.inner_text("#vandaag"), "datum staat er gewoon, niet in hoofdletters")
    pg.wait_for_selector("#plan-volgende details.voorstel")
    pg.click("#plan-volgende details.voorstel summary")
    items = pg.locator("#plan-volgende .voorstel__item")
    soorten = [items.nth(i).locator(".voorstel__soort").inner_text() for i in range(items.count())]
    check(soorten[0] == "Warming-up" and soorten[-1] == "Cooling-down" and 2 <= len(soorten) - 2 <= 4, "voorstel: warming-up, 2 tot 4 oefeningen, cooling-down (" + ", ".join(soorten) + ")")
    check("Korte bochten" in pg.inner_text("#plan-volgende .voorstel"), "voorstel past bij het thema Bochtentechniek")
    check("Leren" in pg.inner_text("#plan-volgende .voorstel") and "Let op" in pg.inner_text("#plan-volgende .voorstel"), "per oefening: leren en let op")
    pg.screenshot(path=str(OUT / "planning-trainer.png"), full_page=True)
    with pg.expect_download() as dl0: pg.click("#plan-volgende .gebruik-training")
    p0 = OUT / "voorstel.pdf"; dl0.value.save_as(p0)
    t0 = "\n".join(x.extract_text() for x in PdfReader(str(p0)).pages)
    check("Dinsdag 17 november" in t0 and "KORTE BOCHTEN" in t0 and "Trainerskeuze" in t0, "'Gebruik deze training' maakt de pdf")
    pg.click("#plan-volgende .anders-opbouwen")
    pg.wait_for_selector("[data-pane=bouwer]:not([hidden])")
    check(pg.input_value("#datum") == "2026-11-17", "training anders opbouwen neemt datum uit de planning over")
    check(pg.inner_text("#titel-voorbeeld").startswith("Dinsdag 17 november | "), "titel = datum | thema (" + pg.inner_text("#titel-voorbeeld") + ")")
    gekozen = pg.locator("#slots .slot .opt[aria-pressed=true]").count()
    check(gekozen == pg.locator("#slots .slot").count() and 2 <= gekozen <= 4, "en de voorgestelde oefeningen staan gekozen")
    # terugknop van de browser blijft binnen de Trainingsmaker
    pg.go_back(); pg.wait_for_selector("[data-pane=planning]:not([hidden])")
    check(pg.url.startswith(BASE), "terugknop vanaf Training maken: terug naar de planning, niet weg van de site")
    pg.go_forward(); pg.wait_for_selector("[data-pane=bouwer]:not([hidden])")
    check(pg.input_value("#datum") == "2026-11-17", "vooruitknop: weer bij Training maken, ingevulde gegevens blijven staan")
    # trainer maakt zelf een training in vier stappen
    n0 = len(calls)
    check(pg.is_visible("#sub-zelf") and pg.is_hidden("#ts-start"), "Training maken opent op het tabblad 'Zelf een training maken'")
    pg.click("#subtab-samenstellen")
    pg.click("#ts-start"); pg.wait_for_selector("[data-pane=swipe]:not([hidden])")
    check("Stap 1 van 5" in pg.inner_text("#sw-stap") and pg.is_visible("#sw-disc") and pg.is_hidden("#sw-bezig"), "stap 1: eerst de vraag veldrijden of wielrennen")
    pg.click(".sw-disc-knop[data-disc=veldrit]")
    check(pg.inner_text("#sw-titel") == "Zelf een training maken" and "Stap 2 van 5" in pg.inner_text("#sw-stap") and "Warming-up" in pg.inner_text("#sw-kaart"), "stap 2: warming-up swipen")
    check(pg.locator(".sw-knop--ja svg").count() == 1 and pg.evaluate("getComputedStyle(document.querySelector('#sw-ja')).borderRadius") == "50%", "ronde knoppen met vinkje")
    tik(pg, "#sw-ja")
    check(pg.is_visible("#sw-keuze") and "Stap 3 van 5" in pg.inner_text("#sw-stap"), "stap 3: aantal, groepen en thema")
    check(pg.locator("#sw-themas .sw-thema").count() == 2, "thema's om aan te vinken (met veldritoefeningen)")
    pg.click(".sw-k[data-n='2']"); pg.check("#sw-themas .sw-thema >> nth=0"); pg.click("#sw-verder")
    check("Stap 4 van 5" in pg.inner_text("#sw-stap") and "oefening 1 van 2" in pg.inner_text("#sw-stap"), "stap 4: oefeningen swipen (2)")
    pg.go_back(); pg.wait_for_selector("#sw-keuze:not([hidden])")
    check("Stap 3 van 5" in pg.inner_text("#sw-stap") and pg.url.startswith(BASE), "terugknop tijdens het swipen: één stap terug (stap 3)")
    pg.go_back(); pg.wait_for_timeout(200)
    check("Stap 2 van 5" in pg.inner_text("#sw-stap") and "Warming-up" in pg.inner_text("#sw-kaart"), "nog een keer terug: stap 2")
    pg.go_forward(); pg.wait_for_selector("#sw-keuze:not([hidden])")
    pg.click(".sw-k[data-n='2']"); pg.click("#sw-verder")
    check("oefening 1 van 2" in pg.inner_text("#sw-stap"), "daarna gewoon verder met swipen")
    eerste = pg.inner_text("#sw-kaart h3"); tik(pg, "#sw-nee")
    check(pg.inner_text("#sw-kaart h3") != eerste, "trainer: links geeft een andere oefening")
    # slepen met de muis naar rechts
    box = pg.locator("#sw-kaart").bounding_box()
    pg.mouse.move(box["x"] + 80, box["y"] + 120); pg.mouse.down(); pg.mouse.move(box["x"] + 280, box["y"] + 125, steps=10); pg.mouse.up(); pg.wait_for_timeout(350)
    check("oefening 2 van 2" in pg.inner_text("#sw-stap"), "slepen naar rechts zet de oefening vast")
    # kort slepen = terug op zijn plek
    box = pg.locator("#sw-kaart").bounding_box()
    pg.mouse.move(box["x"] + 80, box["y"] + 120); pg.mouse.down(); pg.mouse.move(box["x"] + 120, box["y"] + 122, steps=10); pg.mouse.up(); pg.wait_for_timeout(350)
    check("oefening 2 van 2" in pg.inner_text("#sw-stap"), "een klein stukje slepen doet niets")
    tik(pg, "#sw-ja")
    check("Stap 5 van 5" in pg.inner_text("#sw-stap") and "Cooling-down" in pg.inner_text("#sw-kaart"), "stap 5: cooling-down swipen")
    tik(pg, "#sw-ja")
    pg.wait_for_selector("#sw-klaar:not([hidden])")
    check(pg.is_visible("#sw-pdf") and pg.is_hidden("#sw-opslaan") and pg.locator("#sw-lijst li").count() == 4, "klaar: warming-up, 2 oefeningen, cooling-down")
    check(not any("voorstel_beoordelingen" in c[1] for c in calls[n0:]), "swipes van trainers worden niet opgeslagen")
    with pg.expect_download() as dl2: pg.click("#sw-pdf")
    p2 = OUT / "geswiped.pdf"; dl2.value.save_as(p2)
    t2 = "\n".join(x.extract_text() for x in PdfReader(str(p2)).pages)
    check("Techniek en materiaal" in t2 and "KERN 2" in t2 and "KERN 3" not in t2 and "Veldrijden" in t2 and "WAAIER" not in t2, "pdf van de geswipete veldrittraining, zonder wegoefeningen")
    pg.click("#sw-aanpassen"); pg.wait_for_selector("[data-pane=bouwer]:not([hidden])")
    check(pg.locator("#slots .slot").count() == 2 and pg.locator("#slots .opt[aria-pressed=true]").count() == 2 and not pg.is_checked(".grp[value='3']"), "aanpassen neemt oefeningen en groepen over")
    pg.click(".tab[data-tab=nieuw]")
    check(pg.is_hidden("#n-img"), "trainer kan geen tekening uploaden")
    pg.fill("#n-titel", "Voorstel trainer"); pg.fill("#n-uitleg", "De renner/renster rijdt een rondje.")
    pg.fill("#n-yt", "https://example.com/filmpje"); pg.click("#n-save")
    check("YouTube" in pg.inner_text("#n-msg"), "ongeldige YouTube-link wordt geweigerd")
    pg.fill("#n-yt", "https://youtu.be/dQw4w9WgXcQ")
    pg.click("#n-save"); pg.wait_for_selector("#n-msg:has-text('bibliotheek')")
    post = [c for c in calls if c[0] == "POST" and "/rest/v1/oefeningen" in c[1]][-1]
    row = json.loads(post[2])
    check(row["status"] == "gepubliceerd" and row["created_by"] is None and row["tekening_pad"] is None, "oefening van trainer: direct in de bibliotheek, zonder eigenaar en tekening")
    check(row["youtube_url"] == "https://youtu.be/dQw4w9WgXcQ", "YouTube-link wordt opgeslagen")
    FIX["oefeningen"].pop()
    # admin inloggen met alleen een wachtwoord
    pg.click("#admin-knop"); pg.wait_for_selector("[data-pane=admin]:not([hidden])")
    pg.screenshot(path=str(OUT / "admin-login.png"))
    ctx.unroute(SB + "/**"); ctx.route(SB + "/**", lambda r, q: handler(r, q, True))
    n0 = len(calls)
    pg.fill("#admin-ww", "geheim-wachtwoord"); pg.click("#admin-login")
    pg.wait_for_selector("#admin-actief:not([hidden])")
    tok = [c for c in calls[n0:] if "/auth/v1/token" in c[1]]
    check(tok and "admin@training.westlandwilvooruit.nl" in tok[0][2], "admin logt in met vast admin-account + ingetypt wachtwoord")
    check(pg.is_visible("#tab-beheer") and pg.is_visible("#plan-form"), "admin ziet beheer en het planningformulier")
    check("niet zichtbaar" in pg.inner_text("#plan-komend"), "admin ziet ook verborgen planning")
    pg.fill("#p-datum", "2026-12-08"); pg.fill("#p-start", "18:30"); pg.fill("#p-titel", "Opstappen"); pg.fill("#p-trefwoorden", "Op- en afstappen, Bunnyhop"); pg.click("#p-opslaan")
    pg.wait_for_selector("#p-msg:has-text('Toegevoegd')")
    pp = [c for c in calls if c[0] == "POST" and "/rest/v1/planning" in c[1]][-1]
    prow = json.loads(pp[2])
    check(prow["datum"] == "2026-12-08" and prow["titel"] == "Opstappen" and prow["gepubliceerd"] is True, "admin zet een training in de planning")
    check(prow["trefwoorden"] == ["op- en afstappen", "bunnyhop"], "met trefwoorden")
    # voorstel swipen
    pg.click("#plan-volgende .swipe-start"); pg.wait_for_selector("[data-pane=swipe]:not([hidden])")
    check("Warming-up" in pg.inner_text("#sw-stap"), "swipen begint bij de warming-up")
    tik(pg, "#sw-ja")
    eerste = pg.inner_text("#sw-kaart h3"); tik(pg, "#sw-nee")
    check(pg.inner_text("#sw-kaart h3") != eerste, "links swipen geeft een andere oefening")
    check(any(c[0] == "POST" and "voorstel_beoordelingen" in c[1] and '"afgewezen"' in (c[2] or "") for c in calls), "afwijzing wordt opgeslagen")
    eerste = pg.inner_text("#sw-kaart h3"); tik(pg, "#sw-shuffle")
    check(pg.inner_text("#sw-kaart h3") != eerste, "shuffle geeft een andere oefening")
    # slepen naar rechts
    box = pg.locator("#sw-kaart").bounding_box()
    pg.mouse.move(box["x"] + 100, box["y"] + 100); pg.mouse.down(); pg.mouse.move(box["x"] + 300, box["y"] + 110, steps=8); pg.mouse.up(); pg.wait_for_timeout(350)
    check("Oefening 2" in pg.inner_text("#sw-stap"), "naar rechts slepen zet de oefening in de training")
    tik(pg, "#sw-ja"); tik(pg, "#sw-ja")
    check("Cooling-down" in pg.inner_text("#sw-stap") and "Rustig uitrijden" in pg.inner_text("#sw-kaart"), "cooling-down swipet mee")
    tik(pg, "#sw-ja"); pg.wait_for_selector("#sw-klaar:not([hidden])")
    pg.screenshot(path=str(OUT / "swipen-klaar.png"), full_page=True)
    pg.click("#sw-opslaan"); pg.wait_for_selector("[data-pane=planning]:not([hidden])")
    check(len(ONDERDELEN) == 5 and [o["soort"] for o in ONDERDELEN] == ["warming-up", "kern", "kern", "kern", "cooling-down"], "goedgekeurd voorstel opgeslagen (5 onderdelen)")
    check(ONDERDELEN[-1]["oefening_id"] == "c1", "met de gekozen cooling-down")
    check("voorstel goedgekeurd" in pg.inner_text("#plan-volgende"), "planning toont dat het voorstel is goedgekeurd")
    pg.click("#plan-volgende details.voorstel summary")
    check("Rustig uitrijden" in pg.inner_text("#plan-volgende .voorstel") and pg.locator("#plan-volgende .video-link").count() >= 1, "trainers zien het goedgekeurde voorstel met filmpje")
    pg.screenshot(path=str(OUT / "planning-admin.png"), full_page=True)
    pg.click("#admin-uit"); pg.wait_for_selector("#admin-knop:not([hidden])")
    check(pg.is_hidden("#tab-beheer"), "na uitloggen weer trainer")
    ctx.close()

    m = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2); nep_routes(m); mp = m.new_page()
    mp.goto(BASE); mp.wait_for_selector("#plan-volgende .plan--groot"); mp.screenshot(path=str(OUT / "planning-mobiel.png"), full_page=True); m.close()

    # datumbewust op een trainingsdag: donderdag 19 november
    dctx = br.new_context(viewport={"width": 390, "height": 844}); nep_routes(dctx)
    dctx.add_init_script("window.TM_NU = %s;" % json.dumps("2026-11-19T07:00:00"))
    dpg = dctx.new_page(); dpg.goto(BASE); dpg.wait_for_selector("#plan-volgende")
    dpg.click(".tab[data-tab=bouwer]"); dpg.wait_for_selector("#slots .slot")
    check(dpg.input_value("#datum") == "2026-11-19" and "Vandaag is er training" in dpg.inner_text("#datum-tip"), "op donderdag staat de datum al op vandaag")
    dpg.fill("#datum", "2026-11-20"); check("dinsdag en donderdag" in dpg.inner_text("#datum-tip"), "waarschuwing bij een andere dag")
    dctx.close()

    # 2. admin met bestaande sessie: training maken, bibliotheek, beheer
    ctx = br.new_context(accept_downloads=True, viewport={"width": 900, "height": 1200})
    nep_routes(ctx, admin=True)
    ctx.add_init_script("localStorage.setItem('sb-aeeqkcnaqilttqppljmj-auth-token', %s)" % json.dumps(json.dumps(SESSION)))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    cons = []; pg.on("console", lambda m: cons.append(m.text) if m.type == "error" else None)
    pg.goto(BASE); pg.wait_for_selector("#admin-actief:not([hidden])")
    pg.click(".tab[data-tab=bouwer]"); pg.wait_for_selector("#slots .slot")
    check(pg.is_visible("#tab-beheer"), "admin ziet het tabblad Beheer")
    check(pg.locator("#warm .opt").count() == 2, "warming-up: voorbeelden uit de database (er zijn er 2)")
    check(pg.locator("#slots .slot").count() == 3, "standaard 3 oefeningen")
    pg.click("[data-pane=bouwer] .aantal[data-n='4']"); check(pg.locator("#slots .slot").count() == 4, "4 oefeningen kiezen")
    pg.click("[data-pane=bouwer] .aantal[data-n='3']")
    pg.fill("#datum", "2026-11-17")
    pg.click("#thema-chips .chip:has-text('Techniek en materiaal')")
    check(pg.inner_text("#titel-voorbeeld") == "Dinsdag 17 november | Techniek en materiaal", "titel = datum | thema")
    check(pg.input_value("#s0-thema") != "" and pg.locator("#slots .slot >> nth=0 >> .opt").count() == 2, "per oefening 2 voorbeelden uit het thema")
    check(pg.locator("#slots .opt:has-text('Concept van trainer')").count() == 0, "concepten worden niet voorgesteld")
    pg.click("#slots .slot >> nth=0 >> .opt:has-text('Bidon op de ovaal') b")
    pg.click("#slots .slot >> nth=1 >> .opt:has-text('Korte bochten') b")
    pg.click("#slots .slot >> nth=2 >> .opt:has-text('Bidon op de ovaal') b")
    check(pg.locator("#slots .slot >> nth=0 >> .opt[aria-pressed=true]").count() == 0, "dezelfde oefening kan niet twee keer: oefening 1 wordt leeg")
    pg.click("#slots .slot >> nth=2 >> .opt:has-text('Bidon op de ovaal') b")
    pg.click("#slots .slot >> nth=0 >> .opt:has-text('Bidon op de ovaal') b")
    pg.click("#make")
    check("oefening 3" in pg.inner_text("#hint"), "zonder derde oefening: duidelijke melding")
    pg.fill("#s2-titel", "Kopwisselen in een rij"); pg.fill("#s2-uitleg", "Rij van vier.\n\nDe voorste gaat na een ronde achteraan.")
    pg.fill("#s2-doel", "In een rij rijden en netjes wisselen."); pg.fill("#s2-coach", "Afstand tot het wiel.\nNiet remmen in de rij."); pg.fill("#s2-materiaal", "Niets.")
    check(pg.locator("#slots .slot >> nth=2").get_attribute("class").find("slot--eigen") >= 0, "eigen oefening wordt gebruikt")
    check(pg.locator("#sub-zelf input[type=file]").count() == 0, "geen tekening meer bij een eigen oefening")
    eerste = pg.locator("#slots .slot >> nth=0")
    check(eerste.locator(".slot__eigen").evaluate("e => e.compareDocumentPosition(e.parentNode.querySelector('.slot__voorbeelden')) & 4") > 0, "eerst zelf schrijven, daaronder de voorbeelden")
    check("kijk hieronder" in eerste.inner_text(), "met de tip dat je ook een voorbeeld kunt kiezen")
    check(pg.locator(".regel").count() == 5 and pg.locator(".regel:checked").count() == 5, "vaste regels om aan te vinken")
    pg.uncheck(".regel >> nth=3"); pg.fill("#eigen-regels", "Helm altijd op, ook bij het inrijden.")
    pg.screenshot(path=str(OUT / "bouwer.png"), full_page=True)

    with pg.expect_download() as dl: pg.click("#make")
    check("Dinsdag 17 november" in dl.value.suggested_filename and "Techniek" in dl.value.suggested_filename, "bestandsnaam met datum en thema (" + dl.value.suggested_filename + ")")
    pdfp = OUT / "test-training.pdf"; dl.value.save_as(pdfp)
    r = PdfReader(str(pdfp)); txt = "\n".join(pg_.extract_text() for pg_ in r.pages)
    imgs = sum(len(pg_.images) for pg_ in r.pages)
    check(len(r.pages) >= 3, f"pdf heeft {len(r.pages)} pagina's")
    for s_ in ["INLEIDING", "Dinsdag 17 november, 18:30", "Techniek en materiaal", "KERN 1 (GROEP 1): BIDON OP DE OVAAL", "KERN 3: KOPWISSELEN IN EEN RIJ", "In een rij rijden", "Trainerskeuze", "Broekpolderlaan 14", "dernyrondje", "Helm altijd op"]:
        check(s_ in txt, "pdf bevat: " + s_)
    check("Niemand blijft stilstaan" not in txt, "uitgevinkte regel staat niet in de pdf")
    check(imgs >= len(r.pages) + 1, f"pdf bevat kopbalk op elke pagina + tekening ({imgs} afbeeldingen)")
    # logo gaat naar de planning
    pg.click(".tab[data-tab=bieb]"); pg.click("#logo")
    check(pg.is_visible("[data-pane=planning]") and pg.url.startswith(BASE), "logo gaat naar de planning")

    # bibliotheek
    pg.click(".tab[data-tab=bieb]"); pg.fill("#zoek", "zand")
    check(pg.locator("#bieb .item").count() == 1, "zoeken op 'zand' geeft 1 oefening")
    pg.fill("#zoek", ""); pg.select_option("#f-soort", "warming-up")
    check(pg.locator("#bieb .item").count() == 2, "filter warming-ups geeft 2")
    pg.select_option("#f-soort", "")
    pg.locator("#bieb .item:has-text('Bidon') summary").click()
    pg.wait_for_selector("#bieb .item:has-text('Bidon') img.prev")
    check(True, "tekening bij Bidon laadt in de bibliotheek")
    pg.screenshot(path=str(OUT / "bieb.png"), full_page=True)

    # oefening toevoegen
    pg.click(".tab[data-tab=nieuw]")
    pg.fill("#n-titel", "Testoefening"); pg.fill("#n-uitleg", "Hij rijdt een rondje.")
    pg.click("#n-save")
    check("renner/renster" in pg.inner_text("#n-msg"), "'hij' wordt geweigerd")
    pg.fill("#n-uitleg", "De renner/renster rijdt een rondje.")
    pg.set_input_files("#n-img", files=[{"name": "t.png", "mimeType": "image/png", "buffer": PNG}])
    pg.click("#n-save"); pg.wait_for_selector("#n-msg:has-text('Opgeslagen')")
    post = [c for c in calls if c[0] == "POST" and "/rest/v1/oefeningen" in c[1]][-1]
    row = json.loads(post[2])
    check(row["status"] == "gepubliceerd" and row["created_by"] == ME, "nieuwe oefening van de admin staat direct in de bibliotheek")
    check(row["tekening_pad"].startswith(ME + "/"), "tekening staat in de eigen map")
    check(any(c[0] == "POST" and "/storage/v1/object/tekeningen/" + ME + "/" in c[1] for c in calls), "tekening geüpload naar Storage")

    # beheer
    pg.click(".tab[data-tab=beheer]")
    n = pg.locator("#concepten .item").count()
    check(n == 1, f"beheer toont {n} oud concept (nieuwe oefeningen zijn direct gepubliceerd)")
    pg.locator("#concepten .item:has-text('Concept van trainer') button:has-text('Publiceren')").click()
    pg.locator("#concepten .item:has-text('Concept van trainer')").wait_for(state="detached")
    check(any(c[0] == "PATCH" and "id=eq.a4" in c[1] and '"gepubliceerd"' in (c[2] or "") for c in calls), "publiceren stuurt status gepubliceerd")

    check(not errs, "geen javascript-fouten " + "; ".join(errs))
    check(not cons, "geen console-fouten " + "; ".join(cons))
    br.close()
srv.shutdown()
sys.exit(1 if check.failed else 0)
