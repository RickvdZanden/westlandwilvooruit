"""End-to-end test met een nep-Supabase (er gaat niets naar de echte database).

Draaien:  pip install playwright pypdf cryptography && playwright install chromium
          python tests/test_e2e.py
"""
import base64, hashlib, http.server, json, os, threading, time, functools, sys
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from playwright.sync_api import sync_playwright
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "out"; OUT.mkdir(exist_ok=True)
FIX = json.loads((ROOT / "tests" / "fixtures.json").read_text())
SB = "https://testproject.supabase.co"   # nep-project: het echte adres staat nergens in de repo
ME = "u-me"
PNG = (ROOT / "img" / "bidon.png").read_bytes()

def b64(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip("=")
exp = int(time.time()) + 3600
jwt = b64({"alg": "HS256", "typ": "JWT"}) + "." + b64({"sub": ME, "exp": exp, "role": "authenticated", "email": "test@example.com"}) + ".x"
SESSION = {"access_token": jwt, "refresh_token": "r", "expires_in": 3600, "expires_at": exp, "token_type": "bearer",
           "user": {"id": ME, "email": "test@example.com", "aud": "authenticated", "role": "authenticated", "app_metadata": {}, "user_metadata": {}}}

# Versleutelde testsleutels, op dezelfde manier als tools/versleutel.js ze maakt.
WW_TRAINER, WW_BEHEER = "test-fiets-modder-bidon", "test-beheer-wind-zand"
ITER = 1000  # laag, alleen voor de snelheid van de test
CFG = {"supabaseUrl": SB, "supabaseKey": "sb_publishable_test", "email": "beheer@example.com", "wachtwoord": "x", "rol": "beheer"}
def sleutelbestand(rollen):
    salt = os.urandom(16); out = []
    for ww, cfg in rollen:
        key = hashlib.pbkdf2_hmac("sha256", ww.encode(), salt, ITER, 32); iv = os.urandom(12)
        out.append({"iv": base64.b64encode(iv).decode(), "data": base64.b64encode(AESGCM(key).encrypt(iv, json.dumps(cfg).encode(), None)).decode()})
    return {"versie": 1, "iteraties": ITER, "salt": base64.b64encode(salt).decode(), "sleutels": out}
SLEUTELS = sleutelbestand([(WW_TRAINER, dict(CFG, email="trainer@example.com", rol="trainer")), (WW_BEHEER, CFG)])
WP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 14"><rect width="22" height="14" fill="#12FF46"/></svg>'
def nep_routes(ctx, sleutels=SLEUTELS):
    ctx.route(SB + "/**", handler)
    ctx.route("**/js/sleutels.json", lambda r, q: r.fulfill(status=200, content_type="application/json", body=json.dumps(sleutels)))
    ctx.route("https://westlandwilvooruit.nl/**", lambda r, q: r.fulfill(status=200, content_type="image/svg+xml", body=WP_SVG) if q.url.endswith(".svg") else r.fulfill(status=200, content_type="image/png", body=PNG))

calls = []
def handler(route, request):
    url, m = request.url, request.method
    calls.append((m, url, request.post_data if m in ("POST", "PATCH") and "storage" not in url else None))
    j = lambda body, status=200: route.fulfill(status=status, content_type="application/json", body=json.dumps(body))
    if "/rest/v1/profielen" in url: return j({"rol": "beheerder", "naam": "Test Trainer"})
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
    # 0. geen geheimen in de broncode die online komt
    bron = "\n".join(p.read_text() for p in [ROOT / "index.html", *(ROOT / "js").glob("*.js"), *(ROOT / "css").glob("*.css")])
    check("sb_publishable" not in bron and "sb_secret" not in bron, "geen Supabase-sleutel in de broncode")
    check("aeeqk" not in bron and ".supabase.co\"" not in bron, "geen Supabase-projectadres in de broncode")
    check("signInWithOtp" not in bron and "login-mail" not in bron, "geen e-mail-login meer")

    # 1. wachtwoordslot
    errs = []
    ctx = br.new_context(viewport={"width": 1280, "height": 800}); nep_routes(ctx); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector("#slot:not([hidden])")
    check(pg.is_hidden("#app"), "zonder wachtwoord zie je alleen het slot")
    check(pg.inner_text(".slot__titel") == "Trainingsmaker", "slot heet Trainingsmaker")
    pg.screenshot(path=str(OUT / "slot.png"))
    pg.fill("#slot-wachtwoord", "fout-wachtwoord"); pg.click("#slot-knop")
    pg.wait_for_selector("#slot-melding:not([hidden])")
    check("klopt niet" in pg.inner_text("#slot-melding"), "fout wachtwoord geeft melding")
    check(pg.is_hidden("#app"), "fout wachtwoord opent de app niet")
    pg.screenshot(path=str(OUT / "slot-fout.png"))
    n0 = len(calls)
    pg.fill("#slot-wachtwoord", WW_TRAINER); pg.click("#slot-knop")
    pg.wait_for_selector("#app:not([hidden])")
    check(any("/auth/v1/token" in c[1] and "trainer@example.com" in (c[2] or "") for c in calls[n0:]), "goed wachtwoord logt in met het gedeelde account")
    check(pg.evaluate("localStorage.getItem('tm-ontgrendeld') !== null"), "apparaat onthoudt het slot")
    pg.reload(); pg.wait_for_selector("#app:not([hidden])")
    check(pg.is_hidden("#slot"), "na herladen blijft het slot open")
    pg.click("#vergrendel"); pg.wait_for_selector("#slot:not([hidden])")
    check(pg.evaluate("localStorage.getItem('tm-ontgrendeld') === null"), "vergrendelen wist het apparaat")
    ctx.close()

    m = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2); nep_routes(m); mp = m.new_page()
    mp.goto(BASE); mp.wait_for_selector("#slot:not([hidden])"); mp.screenshot(path=str(OUT / "slot-mobiel.png")); m.close()

    leeg = br.new_context(); nep_routes(leeg, {"versie": 1, "iteraties": ITER, "salt": "", "sleutels": []}); lp = leeg.new_page()
    lp.goto(BASE); lp.fill("#slot-wachtwoord", "iets"); lp.click("#slot-knop"); lp.wait_for_selector("#slot-melding:not([hidden])")
    check("nog niet ingesteld" in lp.inner_text("#slot-melding"), "leeg sleutelbestand: duidelijke melding")
    leeg.close()

    # 2. met sessie (beheerder)
    ctx = br.new_context(accept_downloads=True, viewport={"width": 900, "height": 1200})
    nep_routes(ctx)
    ctx.add_init_script("localStorage.setItem('tm-ontgrendeld', %s); localStorage.setItem('sb-testproject-auth-token', %s)" % (json.dumps(json.dumps(CFG)), json.dumps(json.dumps(SESSION))))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    cons = []; pg.on("console", lambda m: cons.append(m.text) if m.type == "error" else None)
    pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
    pg.wait_for_selector("#cards .opt")
    check(pg.is_visible("#tab-beheer"), "beheerder ziet het tabblad Beheer")
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
