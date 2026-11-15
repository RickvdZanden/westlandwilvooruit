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
PLAN_VERBORGEN = {"id": "p3", "datum": "2026-12-01", "start_tijd": None, "eind_tijd": None, "groep": None, "titel": "Nog geheim", "omschrijving": None, "locatie": "De Wollebrand", "gepubliceerd": False}
WP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 14"><rect width="22" height="14" fill="#12FF46"/></svg>'
def nep_routes(ctx, admin=False):
    ctx.add_init_script("window.TM_NU = %s;" % json.dumps(NU))
    ctx.route(SB + "/**", lambda r, q: handler(r, q, admin))
    ctx.route("https://westlandwilvooruit.nl/**", lambda r, q: r.fulfill(status=200, content_type="image/svg+xml", body=WP_SVG) if q.url.endswith(".svg") else r.fulfill(status=200, content_type="image/png", body=PNG))

calls = []
def handler(route, request, admin=False):
    url, m = request.url, request.method
    calls.append((m, url, request.post_data if m in ("POST", "PATCH") and "storage" not in url else None))
    j = lambda body, status=200: route.fulfill(status=status, content_type="application/json", body=json.dumps(body))
    if "/rest/v1/profielen" in url: return j({"rol": "admin"} if admin else None)
    if "/rest/v1/planning" in url:
        if m == "GET": return j(PLAN + ([PLAN_VERBORGEN] if admin else []))
        if m in ("POST", "PATCH"): return j([], 201 if m == "POST" else 200)
        if m == "DELETE": return route.fulfill(status=204, body="")
    if "/rest/v1/themas" in url: return j(FIX["themas"])
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
    check(pg.locator("#plan-komend .plan").count() == 1 and "Zandstroken" in pg.inner_text("#plan-komend"), "komende trainingen: 24 november")
    check(pg.inner_text("#plan-vorig-n") == "(1)", "vorige trainingen: 1 (10 november)")
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
    with pg.expect_download() as dl0: pg.click("#gebruik-training")
    p0 = OUT / "voorstel.pdf"; dl0.value.save_as(p0)
    t0 = "\n".join(x.extract_text() for x in PdfReader(str(p0)).pages)
    check("Dinsdag 17 november" in t0 and "KORTE BOCHTEN" in t0 and "Trainerskeuze" in t0, "'Gebruik deze training' maakt de pdf")
    pg.click("#anders-opbouwen")
    pg.wait_for_selector("[data-pane=bouwer]:not([hidden])")
    check(pg.input_value("#datum") == "Dinsdag 17 november, 18:30", "training anders opbouwen neemt datum uit de planning over")
    check(pg.input_value("#thema") == "Bochtentechniek", "en het thema")
    check(2 <= pg.locator("#sel .card").count() <= 4, "en de voorgestelde oefeningen")
    pg.click(".tab[data-tab=nieuw]")
    check(pg.is_hidden("#n-img"), "trainer kan geen tekening uploaden")
    pg.fill("#n-titel", "Voorstel trainer"); pg.fill("#n-uitleg", "De renner/renster rijdt een rondje.")
    pg.click("#n-save"); pg.wait_for_selector("#n-msg:has-text('goedgekeurd')")
    post = [c for c in calls if c[0] == "POST" and "/rest/v1/oefeningen" in c[1]][-1]
    row = json.loads(post[2])
    check(row["status"] == "concept" and row["created_by"] is None and row["tekening_pad"] is None, "voorstel van trainer: concept, zonder eigenaar en tekening")
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
    pg.fill("#p-datum", "2026-12-08"); pg.fill("#p-start", "18:30"); pg.fill("#p-titel", "Opstappen"); pg.click("#p-opslaan")
    pg.wait_for_selector("#p-msg:has-text('Toegevoegd')")
    pp = [c for c in calls if c[0] == "POST" and "/rest/v1/planning" in c[1]][-1]
    prow = json.loads(pp[2])
    check(prow["datum"] == "2026-12-08" and prow["titel"] == "Opstappen" and prow["gepubliceerd"] is True, "admin zet een training in de planning")
    pg.screenshot(path=str(OUT / "planning-admin.png"), full_page=True)
    pg.click("#admin-uit"); pg.wait_for_selector("#admin-knop:not([hidden])")
    check(pg.is_hidden("#tab-beheer"), "na uitloggen weer trainer")
    ctx.close()

    m = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2); nep_routes(m); mp = m.new_page()
    mp.goto(BASE); mp.wait_for_selector("#plan-volgende .plan--groot"); mp.screenshot(path=str(OUT / "planning-mobiel.png"), full_page=True); m.close()

    # 2. admin met bestaande sessie: training maken, bibliotheek, beheer
    ctx = br.new_context(accept_downloads=True, viewport={"width": 900, "height": 1200})
    nep_routes(ctx, admin=True)
    ctx.add_init_script("localStorage.setItem('sb-aeeqkcnaqilttqppljmj-auth-token', %s)" % json.dumps(json.dumps(SESSION)))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    cons = []; pg.on("console", lambda m: cons.append(m.text) if m.type == "error" else None)
    pg.goto(BASE); pg.wait_for_selector("#admin-actief:not([hidden])")
    pg.click(".tab[data-tab=bouwer]"); pg.wait_for_selector("#cards .opt")
    check(pg.is_visible("#tab-beheer"), "admin ziet het tabblad Beheer")
    check(pg.locator("#warm .opt").count() == 2, "2 warming-ups uit de database")
    check(pg.locator("#cards .opt").count() == 3, "3 kernen bij Techniek (incl. eigen-zicht op concept)")

    pg.click("#cards .opt:has-text('Bidon op de ovaal') b")
    pg.click("#cards .opt:has-text('Korte bochten') b")
    check(pg.locator("#sel .card").count() == 2, "2 kernen gekozen")
    check(pg.input_value("#thema") == "Bidon op de ovaal, Korte bochten", "thema automatisch ingevuld")

    pg.fill("#ek-titel", "Kopwisselen in een rij"); pg.fill("#ek-uitleg", "Rij van vier.\n\nDe voorste gaat na een ronde achteraan.")
    pg.set_input_files("#ek-img", files=[{"name": "t.png", "mimeType": "image/png", "buffer": PNG}])
    pg.wait_for_selector("#ek-prev:not([hidden])")
    pg.click("#ek-add")
    check(pg.locator("#sel .card").count() == 3, "eigen kern met tekening toegevoegd")
    pg.fill("#datum", "Dinsdag 17 november, 18:30")
    pg.screenshot(path=str(OUT / "bouwer.png"), full_page=True)

    with pg.expect_download() as dl: pg.click("#make")
    pdfp = OUT / "test-training.pdf"; dl.value.save_as(pdfp)
    r = PdfReader(str(pdfp)); txt = "\n".join(pg_.extract_text() for pg_ in r.pages)
    imgs = sum(len(pg_.images) for pg_ in r.pages)
    check(len(r.pages) >= 3, f"pdf heeft {len(r.pages)} pagina's")
    for s in ["INLEIDING", "Dinsdag 17 november", "KERN 1 (GROEP 1): BIDON OP DE OVAAL", "KERN 3: KOPWISSELEN IN EEN RIJ", "Trainerskeuze", "Broekpolderlaan 14", "dernyrondje"]:
        check(s in txt, "pdf bevat: " + s)
    check(imgs >= len(r.pages) + 2, f"pdf bevat kopbalk op elke pagina + 2 tekeningen ({imgs} afbeeldingen)")

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
    check(row["status"] == "concept" and row["created_by"] == ME, "nieuwe oefening is concept van de ingelogde trainer")
    check(row["tekening_pad"].startswith(ME + "/"), "tekening staat in de eigen map")
    check(any(c[0] == "POST" and "/storage/v1/object/tekeningen/" + ME + "/" in c[1] for c in calls), "tekening geüpload naar Storage")

    # beheer
    pg.click(".tab[data-tab=beheer]")
    n = pg.locator("#concepten .item").count()
    check(n == 2, f"beheer toont {n} concepten")
    pg.locator("#concepten .item:has-text('Concept van trainer') button:has-text('Publiceren')").click()
    pg.locator("#concepten .item:has-text('Concept van trainer')").wait_for(state="detached")
    check(any(c[0] == "PATCH" and "id=eq.a4" in c[1] and '"gepubliceerd"' in (c[2] or "") for c in calls), "publiceren stuurt status gepubliceerd")

    check(not errs, "geen javascript-fouten " + "; ".join(errs))
    check(not cons, "geen console-fouten " + "; ".join(cons))
    br.close()
srv.shutdown()
sys.exit(1 if check.failed else 0)
