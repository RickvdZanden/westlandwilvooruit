// Trainingsmaker Westland Wil Vooruit Jeugd — voorkant op Supabase.
// Alle tekst van gebruikers wordt via textContent getoond (nooit innerHTML).
// Twee rollen: trainer (geen account, anoniem) en admin (inloggen op /inlog/ met wachtwoord + TOTP).
// Wat elke rol mag, staat in de database (Row Level Security); de knoppen hier zijn alleen gemak.
(function () {
  if (window.top !== window.self) { document.documentElement.hidden = true; return; } // niet in een iframe van een andere site
  const CFG = window.TB_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  window.TB_SB = sb; // handig voor testen in de console

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const el = (t, a = {}, ...k) => {
    const e = document.createElement(t);
    for (const [x, y] of Object.entries(a)) {
      if (y == null || y === false) continue;
      if (x === "class") e.className = y;
      else if (x.startsWith("on")) e.addEventListener(x.slice(2), y);
      else e.setAttribute(x, y);
    }
    k.flat().forEach(c => { if (c != null && c !== "") e.append(c.nodeType ? c : document.createTextNode(c)); });
    return e;
  };
  const fout = msg => { $("#fout").textContent = msg || ""; if (msg) window.scrollTo({ top: 0, behavior: "smooth" }); };
  const paras = s => (s || "").split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  const lines = s => (s || "").split(/\n+/).map(x => x.trim()).filter(Boolean);
  const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const MAX_IMG = 2 * 1024 * 1024;
  const MIN_KERN = 2, MAX_KERN = 4;
  // Veldrijden en wielrennen zijn strikt gescheiden: andere trainers, andere oefeningen.
  const discVan = x => (x && x.discipline) || "veldrit";
  const DISC_NAAM = { veldrit: "Veldrijden", weg: "Wielrennen" };
  let DISC = (() => { try { return localStorage.getItem("tm-discipline") === "weg" ? "weg" : "veldrit"; } catch { return "veldrit"; } })();
  const inDisc = o => discVan(o) === DISC; // opbouw: warming-up + 2 tot 4 oefeningen + cooling-down

  // ---------- staat ----------
  let me = null;             // null = trainer (anoniem), anders {id, rol: "admin"}
  let PLAN = [];             // planningregels (trainers zien alleen gepubliceerde)
  const isAdmin = () => !!me && me.rol === "admin";
  let THEMAS = [];
  let OEF = [];              // alle zichtbare oefeningen (rijen uit de database)
  let ONDERDELEN = [];       // goedgekeurde voorstellen per planningregel
  let BEOORD = [];           // swipes (alleen admin)
  // Formulier "Zelf een training maken". slots: [{thema, keuze (id), opties: [id, id], eigen: {titel, uitleg, doel, coach, materiaal}}]
  const state = { warm: null, warmOpties: [], cool: null, thema: null, n: 3, slots: [] };
  const byId = id => OEF.find(o => o.id === id);
  // Een oefening kan meerdere thema's hebben (thema_ids); thema_id is het hoofdthema.
  const themasVan = o => o && o.thema_ids && o.thema_ids.length ? o.thema_ids : (o && o.thema_id ? [o.thema_id] : []);
  const heeftThema = (o, id) => themasVan(o).includes(id);
  const themaNaam = id => (THEMAS.find(t => t.id === id) || {}).naam || "";

  // ---------- afbeeldingen ----------
  const imgCache = new Map();
  const blobToData = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  const measure = data => new Promise((res, rej) => { const i = new Image(); i.onload = () => res({ data, w: i.naturalWidth, h: i.naturalHeight, fmt: data.startsWith("data:image/jpeg") ? "JPEG" : "PNG" }); i.onerror = () => rej(new Error("Afbeelding kon niet worden gelezen.")); i.src = data; });
  async function loadImg(pad) {
    if (!pad) return null;
    if (imgCache.has(pad)) return imgCache.get(pad);
    let blob;
    if (pad.startsWith("asset:")) {
      const r = await fetch("img/" + pad.slice(6).replace(/[^\w.\-]/g, ""));
      if (!r.ok) throw new Error("Tekening niet gevonden.");
      blob = await r.blob();
    } else {
      const { data, error } = await sb.storage.from("tekeningen").download(pad);
      if (error) throw error;
      blob = data;
    }
    const img = await measure(await blobToData(blob));
    imgCache.set(pad, img);
    return img;
  }
  function checkFile(f) {
    if (!f) return null;
    if (!/^image\/(png|jpeg)$/.test(f.type)) return "Kies een PNG- of JPG-bestand.";
    if (f.size > MAX_IMG) return "De tekening is groter dan 2 MB.";
    return null;
  }

  // ---------- admin ----------
  // Inloggen gebeurt op /inlog/ (wachtwoord + code uit de authenticator-app, TOTP).
  // Hier telt een sessie alleen als admin als die met TOTP is bevestigd (aal2);
  // de database controleert hetzelfde in is_admin().
  function toonRol() {
    $("#admin-actief").hidden = !isAdmin();
    $("#tab-beheer").hidden = !isAdmin();
    $$(".alleen-admin").forEach(x => x.hidden = !isAdmin());
  }
  async function bepaalRol(session) {
    me = null;
    if (session) {
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data } = aal && aal.currentLevel === "aal2"
        ? await sb.from("profielen").select("rol").eq("id", session.user.id).maybeSingle()
        : { data: null };
      if (data && data.rol === "admin") me = { id: session.user.id, rol: "admin" };
      else await sb.auth.signOut({ scope: "local" }); // geen (volledig bevestigde) admin: gewoon weer trainer
    }
    toonRol();
  }
  $("#admin-uit").addEventListener("click", async () => {
    await sb.auth.signOut({ scope: "local" });
    me = null; toonRol(); resetPlanForm(); await loadData(); openTab("planning");
  });

  // ---------- tabbladen ----------
  $$(".tab").forEach(b => b.addEventListener("click", () => openTab(b.dataset.tab)));
  // Terugknop van de browser: elk tabblad (en elke stap van "Training maken") is een eigen
  // stap in de geschiedenis, zodat "vorige" binnen de Trainingsmaker blijft.
  let navTerug = false; // true tijdens het afhandelen van de terugknop: dan niets nieuws vastleggen
  const kaleUrl = () => location.pathname + location.search;
  function openTab(name, viaRoute) {
    if (!navTerug) {
      const st = history.state;
      if (viaRoute) history.replaceState({ tab: name, swStap: 0 }, "", location.href);
      else if (!st) history.replaceState({ tab: name, swStap: 0 }, "", kaleUrl());
      else if (st.tab !== name || location.hash) history.pushState({ tab: name, swStap: 0 }, "", kaleUrl());
    }
    $$(".tab").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === name)));
    $$("[data-pane]").forEach(p => p.hidden = p.dataset.pane !== name);
    fout("");
    if (name === "bieb") renderBieb();
    if (name === "beheer") renderBeheer();
    if (name === "planning") renderPlanning();
    window.scrollTo({ top: 0 });
  }

  // ---------- data ----------
  async function loadData() {
    fout("");
    const [t, o, p, po, vb] = await Promise.all([
      sb.from("themas").select("id, naam, kort, volgorde").order("volgorde"),
      sb.from("oefeningen").select("*").order("titel"),
      sb.from("planning").select("*").order("datum").order("start_tijd", { nullsFirst: true }),
      sb.from("planning_onderdelen").select("planning_id, positie, soort, oefening_id").order("positie"),
      isAdmin() ? sb.from("voorstel_beoordelingen").select("oefening_id, oordeel, trefwoorden") : Promise.resolve({ data: [] })
    ]);
    ONDERDELEN = po.error ? [] : po.data;
    BEOORD = vb.error ? [] : (vb.data || []);
    if (p.error) fout("Kon de planning niet laden: " + p.error.message);
    else { PLAN = p.data; renderPlanning(); }
    if (t.error || o.error) { fout("Kon de bibliotheek niet laden: " + (t.error || o.error).message); return; }
    THEMAS = t.data; OEF = o.data;
    if (!p.error) renderPlanning(); // opnieuw, nu met oefeningen voor de voorgestelde training
    if (state.cool && !byId(state.cool)) state.cool = null;
    if (!$("#datum").value) $("#datum").value = volgendeTrainingsdag(); // op dinsdag/donderdag: vandaag
    if (!bewerkId && !$("#p-datum").value) $("#p-datum").value = volgendeTrainingsdag();
    if (!state.warm || !byId(state.warm)) { state.warm = null; state.warmOpties = []; nieuweWarm(null); }
    state.slots.forEach(s => { if (s.keuze && !byId(s.keuze)) s.keuze = null; s.opties = s.opties.filter(byId); if (!s.opties.length) kiesOpties(s); });
    zorgSlots();
    fillThemaSelects();
    renderThemaChips(); renderWarm(); renderCool(); renderSlots(); renderBieb(); renderTsThema(); updateTitel();
    toonRoute();
  }
  function fillThemaSelects() {
    const f = $("#f-thema"), n = $("#n-thema"), fv = f.value, nv = n.value;
    f.replaceChildren(el("option", { value: "" }, "Alle thema's"), ...THEMAS.map(t => el("option", { value: t.id }, t.naam)));
    n.replaceChildren(el("option", { value: "" }, "Geen thema"), ...THEMAS.map(t => el("option", { value: t.id }, t.naam)));
    f.value = fv; n.value = nv || (THEMAS[0] ? THEMAS[0].id : "");
  }

  // YouTube: alleen een geldige video-id wordt ingesloten, via youtube-nocookie (CSP frame-src).
  function ytId(url) {
    const m = (url || "").match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#].*)?$/);
    return m ? m[1] : null;
  }
  const ytFrame = (o) => el("iframe", { class: "video", src: "https://www.youtube-nocookie.com/embed/" + ytId(o.youtube_url), title: "Filmpje bij " + o.titel,
    loading: "lazy", allow: "encrypted-media; picture-in-picture; fullscreen", referrerpolicy: "strict-origin-when-cross-origin" });
  function details(o) {
    const d = el("details", {}, el("summary", {}, "Bekijk uitleg"),
      el("p", {}, paras(o.uitleg).join("\n\n")),
      o.differentiatie ? el("p", { class: "meta" }, "Differentiatie:\n" + lines(o.differentiatie).join("\n")) : null,
      o.coach ? el("p", { class: "meta" }, "Waar moet je op letten? " + o.coach) : null);
    if (ytId(o.youtube_url)) d.addEventListener("toggle", () => { if (d.open && !d.dataset.yt) { d.dataset.yt = "1"; d.append(ytFrame(o)); } });
    if (o.tekening_pad) {
      d.addEventListener("toggle", async () => {
        if (!d.open || d.dataset.img) return;
        d.dataset.img = "1";
        try { const img = await loadImg(o.tekening_pad); d.append(el("img", { class: "prev", src: img.data, alt: "Tekening bij " + o.titel })); }
        catch { d.append(el("p", { class: "meta" }, "Tekening kon niet worden geladen.")); }
      });
    }
    return d;
  }
  // ---------- training maken: zelf een training maken (formulier) ----------
  // Opbouw: gegevens (datum, groepen, thema) → warming-up (3 voorbeelden) → 2 tot 4 oefeningen,
  // per oefening een thema met 2 voorbeelden of een eigen oefening → cooling-down → succes en regels.
  const conceptBadge = o => o.status === "concept" ? el("span", { class: "badge concept" }, "concept") : null;
  const willekeurig = (lijst, n) => { const a = lijst.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
  const gekozenGroepen = () => $$(".grp:checked").map(x => Number(x.value));
  const pastBijGroepen = o => { const g = gekozenGroepen(); return !g.length || !(o.niveaus || []).length || o.niveaus.some(n => g.includes(n)); };
  const themasInDisc = () => THEMAS.filter(t => OEF.some(o => o.soort === "kern" && o.status === "gepubliceerd" && inDisc(o) && heeftThema(o, t.id)));
  const kort = (s, n) => { s = paras(s)[0] || ""; return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
  const datumVeldTekst = () => $("#datum").value ? datumTekst($("#datum").value) + ", 18:30" : "";
  const nieuwSlot = () => ({ thema: state.thema || "", keuze: null, opties: [], eigen: {} });

  // subtabbladen
  function toonSub(naam) {
    $$(".subtab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.sub === naam)));
    $("#sub-zelf").hidden = naam !== "zelf"; $("#sub-samenstellen").hidden = naam !== "samenstellen";
  }
  $$(".subtab").forEach(b => b.addEventListener("click", () => toonSub(b.dataset.sub)));

  // 1. gegevens
  const trainingThemaTekst = () => $("#thema-anders").value.trim() || themaNaam(state.thema);
  $("#thema-anders").addEventListener("input", () => {
    if ($("#thema-anders").value.trim() && state.thema) { state.thema = null; renderThemaChips(); } // eigen thema of een thema uit de lijst
    updateTitel();
  });
  function titelTekst() {
    const d = $("#datum").value ? datumTekst($("#datum").value) : "", t = trainingThemaTekst();
    return [d, t].filter(Boolean).join(" | ");
  }
  // De app is datumbewust: trainingen zijn op dinsdag en donderdag om 18:30.
  const TRAININGSDAGEN = [2, 4]; // 2 = dinsdag, 4 = donderdag
  function volgendeTrainingsdag() {
    const d = alsDatum(vandaag());
    for (let i = 0; i < 7 && !TRAININGSDAGEN.includes(d.getDay()); i++) d.setDate(d.getDate() + 1);
    return isoDag(d);
  }
  function updateTitel() {
    $("#titel-voorbeeld").textContent = titelTekst() || "kies een datum en een thema";
    const iso = $("#datum").value, tip = [];
    if (iso === vandaag()) tip.push("Vandaag is er training.");
    else if (iso && iso === volgendeTrainingsdag()) tip.push("Dit is de eerstvolgende training.");
    else if (iso && !TRAININGSDAGEN.includes(alsDatum(iso).getDay())) tip.push("Let op: de trainingen zijn op dinsdag en donderdag.");
    tip.push("De training begint om 18:30.");
    const gepland = iso && PLAN.find(p => p.datum === iso && p.gepubliceerd !== false);
    if (gepland) tip.push("In de planning staat: " + gepland.titel + ".");
    $("#datum-tip").textContent = tip.join(" ");
  }
  function renderThemaChips() {
    const met = themasInDisc();
    if (state.thema && !met.some(t => t.id === state.thema)) state.thema = null;
    $("#thema-chips").replaceChildren(...(met.length
      ? met.map(t => el("button", { class: "chip", "aria-pressed": String(state.thema === t.id), onclick: () => kiesTrainingThema(t.id) }, t.naam))
      : [el("p", { class: "meta" }, "Nog geen thema's voor " + DISC_NAAM[DISC].toLowerCase() + ".")]));
  }
  function kiesTrainingThema(id) {
    state.thema = state.thema === id ? null : id;
    if (state.thema) $("#thema-anders").value = "";
    // oefeningen waar nog niets gekozen is, volgen het thema van de training
    state.slots.forEach(s => { if (!s.keuze && !(s.eigen.titel || "").trim()) { s.thema = state.thema || ""; kiesOpties(s); } });
    renderThemaChips(); renderSlots(); updateTitel();
  }
  $("#datum").addEventListener("input", updateTitel);
  $$(".grp").forEach(x => x.addEventListener("change", () => {
    state.slots.forEach(s => { if (!s.keuze) kiesOpties(s); }); renderSlots();
  }));

  // 2. warming-up: drie willekeurige voorbeelden
  function nieuweWarm(behoud) {
    const pool = pubVan("warming-up").filter(o => o.id !== behoud && !state.warmOpties.includes(o.id));
    const reserve = pubVan("warming-up").filter(o => o.id !== behoud);
    const extra = willekeurig(pool.length >= (behoud ? 2 : 3) ? pool : reserve, behoud ? 2 : 3).map(o => o.id);
    state.warmOpties = behoud ? [behoud, ...extra] : extra;
    if (!state.warmOpties.includes(state.warm)) state.warm = state.warmOpties[0] || null;
  }
  function renderWarm() {
    const box = $("#warm");
    const lijst = state.warmOpties.map(byId).filter(Boolean);
    box.replaceChildren(...(lijst.length ? lijst.map(w => el("button", { class: "opt", "aria-pressed": String(state.warm === w.id),
      onclick: ev => { if (ev.target.closest("details")) return; state.warm = w.id; renderWarm(); } },
      el("b", {}, w.titel, conceptBadge(w)), el("span", { class: "meta" }, [w.duur, kort(w.uitleg, 110)].filter(Boolean).join(" · ")), details(w)))
      : [el("p", { class: "meta" }, "Nog geen warming-ups voor " + DISC_NAAM[DISC].toLowerCase() + " in de bibliotheek.")]));
    $("#warm-ander").hidden = pubVan("warming-up").length <= 3;
  }
  $("#warm-ander").addEventListener("click", () => { state.warm = null; nieuweWarm(null); renderWarm(); });

  // 3. oefeningen
  function kiesOpties(slot) {
    const elders = state.slots.filter(s => s !== slot).map(s => s.keuze).filter(Boolean);
    const alle = pubVan("kern").filter(o => (!slot.thema || heeftThema(o, slot.thema)) && pastBijGroepen(o) && !elders.includes(o.id));
    const nieuw = alle.filter(o => !slot.opties.includes(o.id));
    slot.opties = willekeurig(nieuw.length >= 2 ? nieuw : alle, 2).map(o => o.id);
    if (slot.keuze && !slot.opties.includes(slot.keuze)) slot.keuze = null;
  }
  function zorgSlots() {
    state.slots = state.slots.slice(0, state.n);
    while (state.slots.length < state.n) { const s = nieuwSlot(); state.slots.push(s); kiesOpties(s); }
    $$(".aantal").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.n) === state.n)));
  }
  $$(".aantal").forEach(b => b.addEventListener("click", () => { state.n = Number(b.dataset.n); zorgSlots(); renderSlots(); }));
  const EIGEN_VELDEN = [
    ["titel", "Hoe heet de oefening?", "input", "Bijvoorbeeld: Kopwisselen in een rij"],
    ["uitleg", "Kort: wat moet je doen?", "textarea", "Hoe ziet de oefening eruit?"],
    ["doel", "Wat leren de kinderen hiervan?", "textarea", ""],
    ["coach", "Waar moet je op letten als trainer?", "textarea", ""],
    ["materiaal", "Wat heb je nodig?", "textarea", "Bijvoorbeeld: 6 pionnen"]
  ];
  function renderSlot(s, i) {
    const eigenActief = !!(s.eigen.titel || "").trim();
    const kaart = el("div", { class: "card slot" + (eigenActief ? " slot--eigen" : "") });
    const sel = el("select", { id: "s" + i + "-thema", class: "slot-thema" },
      el("option", { value: "" }, "Alle thema's"), themasInDisc().map(t => el("option", { value: t.id }, t.naam)));
    sel.value = s.thema || "";
    sel.addEventListener("change", () => { s.thema = sel.value; s.keuze = null; kiesOpties(s); vervang(); });
    const opties = s.opties.map(byId).filter(Boolean);
    const vervang = () => kaart.replaceWith(renderSlot(s, i));
    // eerst zelf schrijven, daaronder de voorbeelden
    const eigen = el("div", { class: "slot__eigen" },
      EIGEN_VELDEN.flatMap(([k, label, soort, ph]) => {
        const id = "s" + i + "-" + k;
        const veld = el(soort, { id, class: "eigen-" + k, placeholder: ph || null, type: soort === "input" ? "text" : null });
        veld.value = s.eigen[k] || "";
        veld.addEventListener("input", () => {
          s.eigen[k] = veld.value;
          if (k === "titel") {
            const aan = !!veld.value.trim();
            kaart.classList.toggle("slot--eigen", aan);
            kaart.querySelectorAll(".slot__opties .opt").forEach(b => b.setAttribute("aria-pressed", String(!aan && b.dataset.id === s.keuze)));
          }
          updateHint();
        });
        return [el("label", { for: id }, label), veld];
      }));
    const voorbeelden = el("div", { class: "slot__voorbeelden" },
      el("p", { class: "slot__tip" }, "Geen eigen oefening? Kies dan een voorbeeld hieronder."),
      el("p", { class: "meta slot__let-op" }, "Je eigen oefening wordt gebruikt. Maak de naam leeg als je liever een voorbeeld kiest."),
      el("label", { for: "s" + i + "-thema" }, "Thema van de voorbeelden"), sel,
      el("div", { class: "slot__opties" }, opties.length ? opties.map(o => el("button", { class: "opt", "data-id": o.id, "aria-pressed": String(s.keuze === o.id && !eigenActief),
        onclick: ev => {
          if (ev.target.closest("details")) return;
          s.keuze = s.keuze === o.id ? null : o.id;
          // niet twee keer dezelfde oefening in één training
          if (s.keuze) state.slots.forEach(x => { if (x !== s && x.keuze === o.id) x.keuze = null; });
          renderSlots();
        } },
        el("b", {}, o.titel), el("span", { class: "meta" }, kort(o.uitleg, 110)), details(o)))
        : el("p", { class: "meta" }, "Geen oefeningen bij dit thema voor deze groepen.")),
      el("button", { class: "link slot__ander", onclick: () => { kiesOpties(s); vervang(); } }, "Andere voorbeelden"));
    kaart.append(
      el("h3", { class: "slot__kop" }, "Oefening " + (i + 1)),
      el("p", { class: "meta first" }, "Schrijf je eigen oefening. Je kunt ook een voorbeeld kiezen: kijk hieronder."),
      eigen, voorbeelden);
    return kaart;
  }
  function renderSlots() { $("#slots").replaceChildren(...state.slots.map(renderSlot)); updateHint(); }

  // 4. cooling-down
  function renderCool() {
    const box = $("#cool"); box.replaceChildren();
    box.append(el("button", { class: "opt", "aria-pressed": String(!state.cool), onclick: () => { state.cool = null; renderCool(); } },
      el("b", {}, "Trainerskeuze"), el("span", { class: "meta" }, "De trainer kiest zelf hoe de training wordt afgesloten.")));
    OEF.filter(o => o.soort === "cooling-down" && o.status === "gepubliceerd" && inDisc(o)).forEach(c => {
      box.append(el("button", { class: "opt", "aria-pressed": String(state.cool === c.id), onclick: ev => { if (ev.target.closest("details")) return; state.cool = c.id; renderCool(); } },
        el("b", {}, c.titel), el("span", { class: "meta" }, [c.duur, kort(c.uitleg, 110)].filter(Boolean).join(" · ")), details(c)));
    });
  }

  // eigen warming-up en cooling-down: gaat voor op een voorbeeld als de naam is ingevuld
  const eigenBlok = (pre, soort) => {
    const titel = $("#" + pre + "-titel").value.trim();
    if (!titel) return null;
    return { eigen: true, soort, titel, uitleg: $("#" + pre + "-uitleg").value.trim(), coach: $("#" + pre + "-coach").value.trim(),
      duur: "Naar keuze van de trainer", intensiteit: "Naar keuze van de trainer." };
  };
  [["we", "warm-blok"], ["ce", "cool-blok"]].forEach(([pre, blok]) => ["titel", "uitleg", "coach"].forEach(k =>
    $("#" + pre + "-" + k).addEventListener("input", () => { $("#" + blok).classList.toggle("blok--eigen", !!$("#" + pre + "-titel").value.trim()); updateHint(); })));

  // 5. regels
  window.TB_PDF.RULES.forEach((r, i) => $("#regels").append(el("label", { class: "chk" }, el("input", { type: "checkbox", class: "regel", value: r, checked: "" }), r)));
  const gekozenRegels = () => [...$$(".regel:checked").map(x => x.value), ...lines($("#eigen-regels").value)];

  // controle en pdf
  function eigenOefening(s) {
    const e = s.eigen;
    return { eigen: true, soort: "kern", titel: e.titel.trim(), groepen: "", duur: "Naar keuze van de trainer", uitleg: (e.uitleg || "").trim(),
      intensiteit: "Naar keuze van de trainer.", differentiatie: "", doel: (e.doel || "").trim() || "de renner/renster de oefening veilig en netjes uitvoert.",
      materiaal: (e.materiaal || "").trim(), coach: (e.coach || "").trim() };
  }
  function trainingOefeningen() {
    const fouten = [], lijst = [];
    state.slots.forEach((s, i) => {
      if ((s.eigen.titel || "").trim()) {
        if (!(s.eigen.uitleg || "").trim()) fouten.push("Vul bij oefening " + (i + 1) + " kort in wat je moet doen.");
        else lijst.push(eigenOefening(s));
      } else if (s.keuze && byId(s.keuze)) lijst.push(byId(s.keuze));
      else fouten.push("Kies bij oefening " + (i + 1) + " een voorbeeld of schrijf een eigen oefening.");
    });
    return { lijst, fouten };
  }
  function controle() {
    const { lijst, fouten } = trainingOefeningen();
    if (!$("#datum").value) fouten.unshift("Kies een datum.");
    const we = eigenBlok("we", "warming-up"), ce = eigenBlok("ce", "cooling-down");
    if (we && !we.uitleg) fouten.unshift("Vul bij je eigen warming-up kort in wat je moet doen.");
    else if (!we && !state.warm) fouten.unshift("Kies een warming-up of schrijf er zelf een.");
    if (ce && !ce.uitleg) fouten.push("Vul bij je eigen cooling-down kort in wat je moet doen.");
    return { lijst, fouten };
  }
  function updateHint() { const { fouten } = controle(); $("#hint").textContent = fouten[0] || ""; }

  function groepenTekst() {
    const g = $$(".grp:checked").map(x => x.value);
    if (!g.length || g.length === 3) return "Cat. 1 t/m 7: alle groepen";
    return "Cat. 1 t/m 7: groep " + g.join(" en ");
  }
  let headerImg = null;
  // Eén pdf-functie voor alles. t: {datum, groepen, thema, succes, niet, warmId, coolId, gekozen: [{id} of {oef}], regels?, titel?, discipline?}
  async function maakPdf(t) {
    if (!headerImg) headerImg = await loadImg("asset:header.png");
    const w = t.warmOef || byId(t.warmId);
    const kernen = [];
    for (const g of t.gekozen) {
      const o = g.oef || byId(g.id);
      let img = o.img || null;
      if (!img && o.tekening_pad) { try { img = await loadImg(o.tekening_pad); } catch { img = null; } }
      kernen.push({
        titel: o.titel, groepen: o.groepen || "", duur: g.duur || o.duur || "", uitleg: paras(o.uitleg), intensiteit: o.intensiteit || "",
        differentiatie: lines(o.differentiatie), doel: lines(o.doel), materiaal: o.materiaal || "", coach: o.coach || "", img,
        video: ytId(o.youtube_url) ? o.youtube_url : ""
      });
    }
    const c = t.coolOef || (t.coolId ? byId(t.coolId) : null);
    const doc = window.TB_PDF.make({
      datum: t.datum, groepen: t.groepen, thema: t.thema, succes: t.succes, niet: t.niet, header: headerImg, discipline: DISC_NAAM[t.discipline || DISC],
      warm: { titel: w.titel, uitleg: paras(w.uitleg), duur: w.duur, intensiteit: w.intensiteit, coach: w.coach }, kernen,
      cool: c ? { titel: c.titel, uitleg: paras(c.uitleg), duur: c.duur, coach: c.coach } : null, regels: t.regels
    });
    const naam = (t.titel || t.datum || "Training").replace(/[^\w\- ]+/g, " ").replace(/\s+/g, " ").trim() || "Training";
    doc.save("Training - " + naam + ".pdf");
  }
  // Elke gemaakte training wordt bewaard (gemodereerd): via de functie training_insturen.
  // Eigen oefeningen en een eigen thema komen als concept binnen; de admin keurt goed in Beheer.
  async function insturen(payload) {
    const { error } = await sb.rpc("training_insturen", { p: payload });
    return error ? error.message : null;
  }
  const eigenAlsInzending = o => ({ eigen: { titel: o.titel, uitleg: o.uitleg, doel: o.doel || "", coach: o.coach || "", materiaal: o.materiaal || "" } });
  function formulierInzending() {
    const we = eigenBlok("we", "warming-up"), ce = eigenBlok("ce", "cooling-down");
    return {
      discipline: DISC, datum: $("#datum").value || null, datum_tekst: datumVeldTekst(), titel: titelTekst(),
      thema: trainingThemaTekst(), thema_id: $("#thema-anders").value.trim() ? null : state.thema, thema_eigen: $("#thema-anders").value.trim(),
      groepen: groepenTekst(), niveaus: gekozenGroepen(),
      warm: we ? eigenAlsInzending(we) : { id: state.warm },
      cool: ce ? eigenAlsInzending(ce) : (state.cool ? { id: state.cool } : null),
      kernen: state.slots.map(sl => (sl.eigen.titel || "").trim()
        ? Object.assign(eigenAlsInzending(eigenOefening(sl)), { thema_id: sl.thema || state.thema || null })
        : { id: sl.keuze }),
      succes: $("#succes").value.trim(), niet: $("#niet").value.trim(), regels: gekozenRegels()
    };
  }
  $("#make").addEventListener("click", async () => {
    const { lijst, fouten } = controle();
    if (fouten.length) { $("#hint").textContent = fouten[0]; return; }
    const btn = $("#make"); btn.disabled = true; const label = btn.textContent; btn.textContent = "Pdf wordt gemaakt…"; fout("");
    try {
      await maakPdf({
        datum: datumVeldTekst(), groepen: groepenTekst(), thema: trainingThemaTekst() || lijst.map(o => o.titel).join(", "), titel: titelTekst(),
        succes: $("#succes").value.trim(), niet: $("#niet").value.trim(), warmId: state.warm, coolId: state.cool,
        warmOef: eigenBlok("we", "warming-up"), coolOef: eigenBlok("ce", "cooling-down"),
        gekozen: lijst.map(o => o.eigen ? { oef: o } : { id: o.id }), regels: gekozenRegels()
      });
      const f = await insturen(formulierInzending());
      $("#hint").textContent = f ? "De pdf is gemaakt, maar bewaren lukte niet: " + f : "Je training is bewaard. De admin kijkt hem na.";
    } catch (x) { fout("De pdf kon niet worden gemaakt: " + x.message); }
    btn.textContent = label; btn.disabled = false;
  });

  // het formulier vullen vanuit de planning, het swipen of de bibliotheek
  function vulBouwer(v) {
    if (v.disc && v.disc !== DISC) zetDisc(v.disc);
    if (v.datumIso !== undefined) $("#datum").value = v.datumIso || "";
    if (v.groepen) $$(".grp").forEach(x => x.checked = v.groepen.includes(Number(x.value)));
    const kernen = (v.kernen || []).filter(Boolean);
    const hoofd = o => o.thema_id || themasVan(o)[0] || "";
    if (v.thema !== undefined) state.thema = v.thema || (kernen[0] ? hoofd(kernen[0]) : null) || null;
    if (v.warm) { state.warm = v.warm.id; state.warmOpties = []; nieuweWarm(v.warm.id); }
    if (kernen.length) {
      state.n = Math.min(MAX_KERN, Math.max(MIN_KERN, kernen.length));
      state.slots = kernen.slice(0, MAX_KERN).map(o => ({ thema: hoofd(o), keuze: o.id, opties: [o.id], eigen: {} }));
      state.slots.forEach(s => {
        const ander = willekeurig(pubVan("kern").filter(o => o.id !== s.keuze && (!s.thema || heeftThema(o, s.thema)) && !state.slots.some(x => x.keuze === o.id)), 1);
        s.opties = [s.keuze, ...ander.map(o => o.id)];
      });
    }
    if (v.cool !== undefined) state.cool = v.cool ? v.cool.id : null;
    zorgSlots();
    renderThemaChips(); renderWarm(); renderSlots(); renderCool(); updateTitel();
    toonSub("zelf"); openTab("bouwer");
  }

  // ---------- bibliotheek ----------
  ["#zoek", "#f-soort", "#f-thema", "#f-niveau"].forEach(s => $(s).addEventListener("input", renderBieb));
  async function verwijder(o) {
    if (!confirm("Weet je zeker dat je \"" + o.titel + "\" wilt verwijderen?")) return;
    const { error } = await sb.from("oefeningen").delete().eq("id", o.id);
    if (error) { fout("Verwijderen lukte niet: " + error.message); return; }
    if (o.tekening_pad && !o.tekening_pad.startsWith("asset:")) await sb.storage.from("tekeningen").remove([o.tekening_pad]);
    await loadData(); renderBeheer();
  }
  function item(o, extra) {
    const acts = el("div", { class: "acts" });
    if (o.soort === "kern") acts.append(el("button", { class: "chip", onclick: () => {
      if (discVan(o) !== DISC) zetDisc(discVan(o));
      // in de eerste lege oefening zetten, anders in de laatste
      const s = state.slots.find(x => !x.keuze && !(x.eigen.titel || "").trim()) || state.slots[state.slots.length - 1];
      s.thema = o.thema_id || themasVan(o)[0] || ""; s.keuze = o.id; s.eigen = {};
      if (!s.opties.includes(o.id)) s.opties = [o.id, ...s.opties.filter(id => id !== o.id)].slice(0, 2);
      vulBouwer({});
    } }, "Gebruik in training"));
    else if (o.soort === "cooling-down") acts.append(el("button", { class: "chip", onclick: () => { if (discVan(o) !== DISC) zetDisc(discVan(o)); vulBouwer({ cool: o }); } }, "Kies als cooling-down"));
    else acts.append(el("button", { class: "chip", onclick: () => { if (discVan(o) !== DISC) zetDisc(discVan(o)); vulBouwer({ warm: o }); } }, "Kies als warming-up"));
    if (extra) extra(acts);
    else if (isAdmin()) acts.append(el("button", { class: "chip danger", onclick: () => verwijder(o) }, "Verwijderen"));
    return el("div", { class: "card item" },
      el("h3", {}, o.titel, conceptBadge(o)),
      el("p", { class: "meta first" }, [{ kern: "Kern", "warming-up": "Warming-up", "cooling-down": "Cooling-down" }[o.soort], themasVan(o).map(themaNaam).filter(Boolean).join(", "), o.groepen || ("Groep " + (o.niveaus || []).join(", ")), o.duur, o.discipline === "weg" ? "Weg" : ""].filter(Boolean).join(" · ")),
      details(o), acts);
  }
  function renderBieb() {
    const q = norm($("#zoek").value).split(/\s+/).filter(Boolean);
    const soort = $("#f-soort").value, thema = $("#f-thema").value, niv = Number($("#f-niveau").value);
    const lijst = OEF.filter(o => {
      if (!inDisc(o)) return false;
      if (soort && o.soort !== soort) return false;
      if (thema && !heeftThema(o, thema)) return false;
      if (niv && !(o.niveaus || []).includes(niv)) return false;
      const hay = norm([o.titel, o.uitleg, o.coach, o.materiaal, o.differentiatie, (o.tags || []).join(" "), themasVan(o).map(themaNaam).join(" ")].join(" "));
      return q.every(w => hay.includes(w));
    });
    $("#bieb-n").textContent = lijst.length + " van " + OEF.filter(inDisc).length + " oefeningen " + DISC_NAAM[DISC].toLowerCase();
    $("#bieb").replaceChildren(...lijst.map(o => item(o)));
  }

  // ---------- oefening toevoegen ----------
  $("#n-soort").addEventListener("input", () => { if ($("#n-soort").value !== "kern") $("#n-thema").value = ""; });
  $("#n-save").addEventListener("click", async () => {
    const msg = $("#n-msg"), btn = $("#n-save");
    const titel = $("#n-titel").value.trim(), uitleg = $("#n-uitleg").value.trim();
    const niveaus = $$(".n-niv:checked").map(x => Number(x.value));
    if (!titel || !uitleg) { msg.textContent = "Vul minimaal een titel en uitleg in."; return; }
    if (!niveaus.length) { msg.textContent = "Kies minimaal één groep."; return; }
    if (/\bhij\b/i.test(uitleg + " " + $("#n-doel").value + " " + $("#n-coach").value)) { msg.textContent = "Schrijf \"de renner/renster\" in plaats van \"hij\"."; return; }
    const f = isAdmin() ? $("#n-img").files[0] : null, ferr = checkFile(f);
    if (ferr) { msg.textContent = ferr; return; }
    const yt = $("#n-yt").value.trim();
    if (yt && !ytId(yt)) { msg.textContent = "Dat is geen geldige YouTube-link. Kopieer de link van de video (youtube.com of youtu.be)."; return; }
    btn.disabled = true; msg.textContent = "Bezig met versturen…";
    let pad = null;
    try {
      if (f) {
        pad = me.id + "/" + crypto.randomUUID() + (f.type === "image/png" ? ".png" : ".jpg");
        const up = await sb.storage.from("tekeningen").upload(pad, f, { contentType: f.type, upsert: false });
        if (up.error) throw up.error;
      }
      const row = {
        soort: $("#n-soort").value, discipline: $("#n-disc").value, titel, thema_id: $("#n-thema").value || null, thema_ids: $("#n-thema").value ? [$("#n-thema").value] : [],
        groepen: $("#n-groepen").value.trim() || null, niveaus, duur: $("#n-duur").value.trim() || null, uitleg,
        intensiteit: $("#n-int").value.trim() || null, differentiatie: $("#n-diff").value.trim() || null, doel: $("#n-doel").value.trim() || null,
        materiaal: $("#n-mat").value.trim() || null, coach: $("#n-coach").value.trim() || null, tekening_pad: pad,
        tags: $("#n-tags").value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean), youtube_url: yt || null,
        status: isAdmin() ? "gepubliceerd" : "concept", created_by: isAdmin() ? me.id : null
      };
      const { error } = await sb.from("oefeningen").insert(row);
      if (error) throw error;
      ["n-titel", "n-groepen", "n-duur", "n-uitleg", "n-int", "n-diff", "n-doel", "n-mat", "n-coach", "n-tags", "n-yt", "n-img"].forEach(k => $("#" + k).value = "");
      msg.textContent = isAdmin() ? "Opgeslagen. Je oefening staat nu in de bibliotheek." : "Bedankt! Je oefening is ingestuurd en komt in de bibliotheek zodra de admin hem heeft goedgekeurd.";
      await loadData();
    } catch (x) {
      if (pad) await sb.storage.from("tekeningen").remove([pad]);
      msg.textContent = "Opslaan lukte niet: " + x.message;
    }
    btn.disabled = false;
  });

  // ---------- beheer ----------
  async function renderIngestuurd() {
    const box = $("#trainingen-concept");
    const { data, error } = await sb.from("trainingen").select("*, trainingen_kernen(volgorde, oefening_id, eigen)").eq("status", "concept").order("created_at", { ascending: false });
    if (error) { box.replaceChildren(el("p", { class: "meta" }, "Kon de ingestuurde trainingen niet laden: " + error.message)); return; }
    if (!data.length) { box.replaceChildren(el("p", { class: "meta" }, "Geen trainingen om na te kijken.")); return; }
    box.replaceChildren(...data.map(t => {
      const kernen = (t.trainingen_kernen || []).sort((a, b) => a.volgorde - b.volgorde);
      const oefIds = [t.warmingup_id, t.cooldown_id, ...kernen.map(k => k.oefening_id)].filter(Boolean);
      const conceptIds = oefIds.filter(id => (byId(id) || {}).status === "concept");
      const regel = (soort, id) => { const o = byId(id); return el("li", {}, el("span", { class: "voorstel__soort" }, soort), el("b", {}, o ? o.titel : "Trainerskeuze"), o && o.status === "concept" ? el("span", { class: "badge concept" }, "nieuw") : null); };
      const acts = el("div", { class: "acts" });
      acts.append(el("button", { class: "chip", "aria-pressed": "true", onclick: async () => {
        const r = await sb.from("trainingen").update({ status: "goedgekeurd" }).eq("id", t.id);
        if (r.error) { fout("Goedkeuren lukte niet: " + r.error.message); return; }
        if (conceptIds.length) {
          const o = await sb.from("oefeningen").update({ status: "gepubliceerd", updated_at: new Date().toISOString() }).in("id", conceptIds);
          if (o.error) { fout("De training is goedgekeurd, maar de eigen oefeningen niet: " + o.error.message); }
        }
        await loadData(); renderBeheer();
      } }, conceptIds.length ? "Goedkeuren (ook " + conceptIds.length + " eigen oefening" + (conceptIds.length > 1 ? "en" : "") + ")" : "Goedkeuren"));
      if (t.thema_eigen && !t.thema_id) acts.append(el("button", { class: "chip", onclick: async () => {
        const volgorde = THEMAS.reduce((m, x) => Math.max(m, x.volgorde || 0), 0) + 1;
        const n = await sb.from("themas").insert({ naam: t.thema_eigen, volgorde }).select("id").single();
        if (n.error) { fout("Thema toevoegen lukte niet: " + n.error.message); return; }
        await sb.from("trainingen").update({ thema_id: n.data.id }).eq("id", t.id);
        const zonder = conceptIds.filter(id => !themasVan(byId(id)).length && (byId(id) || {}).soort === "kern");
        if (zonder.length) await sb.from("oefeningen").update({ thema_id: n.data.id, thema_ids: [n.data.id] }).in("id", zonder);
        await loadData(); renderBeheer();
      } }, "Maak \"" + t.thema_eigen + "\" een thema"));
      acts.append(el("button", { class: "chip danger", onclick: async () => {
        if (!confirm("Training \"" + (t.titel || "zonder titel") + "\" verwijderen? Eigen oefeningen die nog niet zijn goedgekeurd gaan ook weg.")) return;
        const r = await sb.from("trainingen").delete().eq("id", t.id);
        if (r.error) { fout("Verwijderen lukte niet: " + r.error.message); return; }
        if (conceptIds.length) await sb.from("oefeningen").delete().in("id", conceptIds).eq("status", "concept");
        await loadData(); renderBeheer();
      } }, "Verwijderen"));
      return el("div", { class: "card ingestuurd" },
        el("h3", {}, t.titel || "Training zonder titel"),
        el("p", { class: "meta first" }, [DISC_NAAM[t.discipline], t.datum_tekst, t.groepen].filter(Boolean).join(" · ")),
        t.thema_eigen ? el("p", {}, "Eigen thema: ", el("b", {}, t.thema_eigen), t.thema_id ? el("span", { class: "badge" }, "staat in de lijst") : el("span", { class: "badge concept" }, "nieuw thema")) : null,
        el("ol", { class: "sw-lijst" }, regel("Warming-up", t.warmingup_id), kernen.map((k, i) => regel("Oefening " + (i + 1), k.oefening_id)), regel("Cooling-down", t.cooldown_id)),
        t.succescriteria ? el("p", { class: "meta" }, "Succescriteria: " + t.succescriteria) : null,
        t.niet_nastreven ? el("p", { class: "meta" }, "Niet nastreven: " + t.niet_nastreven) : null,
        (t.regels || []).length ? el("p", { class: "meta" }, "Regels: " + t.regels.join(" · ")) : null,
        acts);
    }));
  }
  function renderBeheer() {
    if (!isAdmin()) return;
    renderIngestuurd();
    const lijst = OEF.filter(o => o.status === "concept");
    const box = $("#concepten");
    if (!lijst.length) { box.replaceChildren(el("p", { class: "meta" }, "Geen concepten om na te kijken.")); return; }
    box.replaceChildren(...lijst.map(o => item(o, acts => {
      acts.append(el("button", { class: "chip", "aria-pressed": "true", onclick: async () => {
        const { error } = await sb.from("oefeningen").update({ status: "gepubliceerd", updated_at: new Date().toISOString() }).eq("id", o.id);
        if (error) { fout("Publiceren lukte niet: " + error.message); return; }
        await loadData(); renderBeheer();
      } }, "Publiceren"));
      acts.append(el("button", { class: "chip danger", onclick: () => verwijder(o) }, "Verwijderen"));
    })));
  }

  // ---------- planning ----------
  // Datumbewust: alles vanaf vandaag is "komend", de eerste daarvan is de volgende training.
  const twee = n => String(n).padStart(2, "0");
  const isoDag = d => d.getFullYear() + "-" + twee(d.getMonth() + 1) + "-" + twee(d.getDate());
  const vandaag = () => isoDag(window.TM_NU ? new Date(window.TM_NU) : new Date()); // TM_NU alleen voor tests
  const alsDatum = iso => new Date(iso + "T12:00:00");
  const hoofdletter = t => t.charAt(0).toUpperCase() + t.slice(1);
  function datumTekst(iso, metJaar) {
    const d = alsDatum(iso), nu = alsDatum(vandaag());
    const o = { weekday: "long", day: "numeric", month: "long" };
    if (metJaar || d.getFullYear() !== nu.getFullYear()) o.year = "numeric";
    return hoofdletter(d.toLocaleDateString("nl-NL", o));
  }
  const tijdTekst = p => p.start_tijd ? p.start_tijd.slice(0, 5) + (p.eind_tijd ? "–" + p.eind_tijd.slice(0, 5) : "") : "";
  function afstand(iso) {
    const dagen = Math.round((alsDatum(iso) - alsDatum(vandaag())) / 864e5);
    if (dagen === 0) return "Vandaag";
    if (dagen === 1) return "Morgen";
    if (dagen > 1) return "Over " + dagen + " dagen";
    if (dagen === -1) return "Gisteren";
    return -dagen + " dagen geleden";
  }

  const datumTijd = p => datumTekst(p.datum) + (p.start_tijd ? ", " + p.start_tijd.slice(0, 5) : "");

  // ---------- voorgestelde training ----------
  // Heeft de admin een voorstel goedgekeurd (swipen), dan staat dat in planning_onderdelen.
  // Anders wordt een voorstel in de browser gemaakt: de trefwoorden, titel en omschrijving van
  // de planning worden gezocht in de gepubliceerde oefeningen; eerdere swipes tellen mee.
  // Later kan de AI-functie (subproject 07) dit overnemen.
  const STOP = new Set("voor met zonder door over onder tussen naar van een het de en of als bij tot dan ook nog niet wel alle groep groepen training trainingen neem mee maak".split(" "));
  const woordenVan = s => norm(s).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w));
  const planWoorden = p => woordenVan([(p.trefwoorden || []).join(" "), p.titel, p.omschrijving].join(" "));
  const raakt = (lijst, w) => lijst.some(x => x.includes(w) || w.includes(x));
  function score(o, woorden) {
    const titelW = woordenVan(o.titel), tagW = (o.tags || []).flatMap(woordenVan), themaW = themasVan(o).flatMap(id => woordenVan(themaNaam(id)));
    const rest = norm([o.uitleg, o.coach, o.doel, o.materiaal].join(" "));
    let s = woorden.reduce((s, w) => s + (raakt(tagW, w) ? 3 : 0) + (raakt(titelW, w) ? 3 : 0) + (raakt(themaW, w) ? 2 : 0) + (rest.includes(w) ? 1 : 0), 0);
    // eerdere swipes: goedgekeurd bij dezelfde trefwoorden telt mee, afgewezen telt tegen
    BEOORD.forEach(b => {
      if (b.oefening_id !== o.id) return;
      const zelfde = (b.trefwoorden || []).flatMap(woordenVan).some(t => raakt(woorden, t));
      s += b.oordeel === "goed" ? (zelfde ? 2 : 0.5) : (zelfde ? -3 : -0.5);
    });
    return s;
  }
  const pubVan = (soort, disc) => OEF.filter(o => o.status === "gepubliceerd" && o.soort === soort && discVan(o) === (disc || DISC));
  const rangschik = (lijst, woorden) => lijst.map(o => ({ o, s: score(o, woorden) })).sort((a, b) => b.s - a.s || a.o.titel.localeCompare(b.o.titel));
  function voorstel(p) {
    const vast = ONDERDELEN.filter(x => x.planning_id === p.id).sort((a, b) => a.positie - b.positie);
    if (vast.length) {
      const warm = vast.find(x => x.soort === "warming-up"), cool = vast.find(x => x.soort === "cooling-down");
      const kernen = vast.filter(x => x.soort === "kern").map(x => byId(x.oefening_id)).filter(Boolean);
      // Een vastgelegde training (goedgekeurd voorstel of uit het archief) toont precies wat er gegeven is,
      // ook als die maar 1 kernoefening had.
      if (warm && byId(warm.oefening_id) && kernen.length >= 1)
        return { warm: byId(warm.oefening_id), kernen, cool: cool && cool.oefening_id ? byId(cool.oefening_id) || null : null, goedgekeurd: true };
    }
    const woorden = planWoorden(p);
    const d = discVan(p);
    const warm = rangschik(pubVan("warming-up", d), woorden)[0];
    const kern = rangschik(pubVan("kern", d), woorden);
    if (!warm || kern.length < MIN_KERN) return null;
    const gekozen = kern.filter(x => x.s > 0).slice(0, 3).map(x => x.o);
    const bij = (o) => { if (gekozen.length < MIN_KERN && !gekozen.includes(o)) gekozen.push(o); };
    if (gekozen[0]) kern.filter(x => themasVan(x.o).some(id => heeftThema(gekozen[0], id))).forEach(x => bij(x.o)); // aanvullen uit hetzelfde thema
    kern.forEach(x => bij(x.o));
    const cool = rangschik(pubVan("cooling-down", d), woorden).find(x => x.s > 0);
    return { warm: warm.o, kernen: gekozen, cool: cool ? cool.o : null, goedgekeurd: false };
  }

  function maakTraining(p, vs) {
    vulBouwer({ datumIso: p.datum, disc: discVan(p), thema: vs ? null : undefined, warm: vs ? vs.warm : null, kernen: vs ? vs.kernen : [], cool: vs ? vs.cool : undefined });
  }

  async function pdfVoor(p, vs, knop) {
    if (knop.getAttribute("aria-busy") === "true") return;
    knop.setAttribute("aria-busy", "true"); fout("");
    try {
      await maakPdf({
        datum: datumTijd(p), groepen: p.groep ? "Cat. 1 t/m 7: " + p.groep : groepenTekst(), thema: p.titel || "",
        succes: $("#succes").value.trim(), niet: $("#niet").value.trim(),
        warmId: vs.warm.id, coolId: vs.cool ? vs.cool.id : null, gekozen: vs.kernen.map(o => ({ id: o.id, duur: o.duur || "" })), discipline: discVan(p)
      });
    } catch (x) { fout("De pdf kon niet worden gemaakt: " + x.message); }
    knop.removeAttribute("aria-busy");
  }
  async function gebruikTraining(p, vs, btn) {
    btn.disabled = true; const label = btn.firstChild.textContent; btn.firstChild.textContent = "Pdf wordt gemaakt…"; fout("");
    try {
      await maakPdf({
        datum: datumTijd(p), groepen: p.groep ? "Cat. 1 t/m 7: " + p.groep : groepenTekst(), thema: p.titel || "",
        succes: $("#succes").value.trim(), niet: $("#niet").value.trim(),
        warmId: vs.warm.id, coolId: vs.cool ? vs.cool.id : null, gekozen: vs.kernen.map(o => ({ id: o.id, duur: o.duur || "" })), discipline: discVan(p)
      });
    } catch (x) { fout("De pdf kon niet worden gemaakt: " + x.message); }
    btn.firstChild.textContent = label; btn.disabled = false;
  }

  const hoofd = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  function onderdeelInfo(o) {
    const s = paras(o.uitleg)[0] || "";
    const dl = el("dl", { class: "voorstel__info" });
    [["Leren", lines(o.doel).map(hoofd).join(" ")], ["Let op", o.coach], ["Nodig", o.materiaal]].forEach(([k, v]) => { if (v) dl.append(el("dt", {}, k), el("dd", {}, v)); });
    return [el("h3", {}, o.titel), s ? el("p", {}, s.length > 220 ? s.slice(0, 217).trimEnd() + "…" : s) : null, dl.children.length ? dl : null,
      ytId(o.youtube_url) ? el("a", { class: "video-link", href: "https://www.youtube.com/watch?v=" + ytId(o.youtube_url), target: "_blank", rel: "noopener noreferrer" }, "Filmpje bekijken") : null];
  }
  const TRAINERSKEUZE = { titel: "Trainerskeuze", uitleg: "De trainer kiest zelf hoe de training wordt afgesloten." };
  function voorstelLijst(vs) {
    const li = (soort, o) => el("li", { class: "voorstel__item" }, el("span", { class: "voorstel__soort" }, soort), onderdeelInfo(o));
    return el("ol", { class: "voorstel__lijst" },
      li("Warming-up", vs.warm), vs.kernen.map((o, i) => li("Oefening " + (i + 1), o)), li("Cooling-down", vs.cool || TRAINERSKEUZE));
  }

  function planRegel(p, groot) {
    const acts = el("div", { class: "acts" });
    const vs = groot ? voorstel(p) : null;
    let blok = null;
    if (vs) {
      blok = el("details", { class: "voorstel" },
        el("summary", {}, el("span", { class: "voorstel__open" }, "Bekijk de oefeningen"), el("span", { class: "meta" }, "warming-up · " + vs.kernen.length + " oefeningen · cooling-down")),
        voorstelLijst(vs));
      const knop = el("button", { class: "knop knop--klein gebruik-training", onclick: () => gebruikTraining(p, vs, knop) },
        el("span", {}, "Gebruik deze training"),
        el("span", { class: "knop__pijl", "aria-hidden": "true" }, el("img", { src: "https://westlandwilvooruit.nl/wp-content/uploads/2025/10/Pijl-zwart-1.svg", alt: "", width: "22", height: "14" })));
      acts.append(knop, el("span", { class: "anders" }, "Training anders opbouwen? ", el("button", { class: "link anders-opbouwen", onclick: () => maakTraining(p, vs) }, "Klik hier")));
    } else {
      acts.append(el("button", { class: "chip", onclick: () => maakTraining(p) }, "Maak training voor deze dag"));
    }
    if (isAdmin()) {
      const heeft = ONDERDELEN.some(x => x.planning_id === p.id);
      acts.append(
        el("button", { class: "chip swipe-start", onclick: () => startSwipen(p) }, heeft ? "Voorstel opnieuw swipen" : "Voorstel swipen"),
        el("button", { class: "chip", onclick: () => bewerkPlan(p) }, "Bewerken"),
        el("button", { class: "chip", onclick: () => zetZichtbaar(p, !p.gepubliceerd) }, p.gepubliceerd ? "Verbergen" : "Zichtbaar maken"),
        el("button", { class: "chip danger", onclick: () => verwijderPlan(p) }, "Verwijderen"));
    }
    const kop = [DISC_NAAM[discVan(p)], afstand(p.datum), tijdTekst(p), p.groep, p.locatie].filter(Boolean).join(" · ");
    const tw = (p.trefwoorden || []).length ? el("div", { class: "trefwoorden" }, p.trefwoorden.map(t => el("span", { class: "trefwoord" }, t))) : null;
    return el("div", { class: "card plan" + (groot ? " plan--groot" : "") + (p.gepubliceerd ? "" : " plan--verborgen") },
      el("p", { class: "plan__datum" }, datumTekst(p.datum)),
      el(groot ? "h2" : "h3", { class: "plan__titel" }, p.titel, p.gepubliceerd ? null : el("span", { class: "badge concept" }, "niet zichtbaar voor trainers"),
        isAdmin() && vs && vs.goedgekeurd ? el("span", { class: "badge" }, "voorstel goedgekeurd") : null),
      el("p", { class: "meta first" }, kop), tw,
      p.omschrijving ? el("p", { class: "plan__tekst" }, p.omschrijving) : null,
      blok, acts);
  }

  // Komende en afgelopen trainingen als lijst, in de stijl van "komende events" op de clubsite:
  // datumblok, titel, tijd en groep, pijltje. Standaard 3 per lijst, met "Toon alle".
  const SVG = "http://www.w3.org/2000/svg";
  function chevron() {
    const svg = document.createElementNS(SVG, "svg"), pad = document.createElementNS(SVG, "path");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "20"); svg.setAttribute("height", "20");
    pad.setAttribute("d", "M9 5l7 7-7 7"); pad.setAttribute("fill", "none"); pad.setAttribute("stroke", "currentColor");
    pad.setAttribute("stroke-width", "3"); pad.setAttribute("stroke-linecap", "square");
    svg.append(pad); return svg;
  }
  // Link naar één training: #training/<id>. Werkt ook als gedeelde link.
  function toonRoute() {
    const m = location.hash.match(/^#training\/([0-9a-zA-Z-]+)$/);
    if (!m) return false;
    const p = PLAN.find(x => x.id === m[1]);
    if (!p) return false;
    $("#training-detail").replaceChildren(planRegel(p, true));
    const d = $("#training-detail details.voorstel"); if (d) d.open = true; // op de eigen pagina meteen de oefeningen
    openTab("training", true);
    return true;
  }
  window.addEventListener("hashchange", () => { if (!toonRoute() && !location.hash) openTab("planning", true); });
  $("#training-terug").addEventListener("click", ev => { ev.preventDefault(); openTab("planning"); });
  window.addEventListener("popstate", ev => {
    const st = ev.state;
    navTerug = true;
    try {
      if (!st) { if (!toonRoute()) openTab("planning"); }
      else if (st.tab === "swipe") {
        const snap = SW_HIST[st.swStap || 0];
        if (SW && snap) { SW = swHerstel(snap); bezigMet = false; if (SW._kop) $("#sw-kop").textContent = SW._kop; openTab("swipe"); renderSwipe(); }
        else openTab("planning");
      }
      else if (st.tab === "training") { if (!toonRoute()) openTab("planning"); }
      else openTab(st.tab);
    } finally { navTerug = false; }
  });
  function eventRegel(p) {
    const d = alsDatum(p.datum);
    const dag = d.toLocaleDateString("nl-NL", { weekday: "long" });
    const maand = d.toLocaleDateString("nl-NL", { month: "short" }).replace(".", "");
    // Met een training (komend, of afgelopen met een goedgekeurd voorstel) opent de knop direct de pdf.
    // Afgelopen trainingen zonder vastgelegde oefeningen linken naar hun eigen pagina.
    const vs = voorstel(p), pdf = vs && (p.datum >= vandaag() || vs.goedgekeurd);
    const meta = [hoofdletter(dag) + (tijdTekst(p) ? " " + tijdTekst(p) : ""), DISC_NAAM[discVan(p)], p.groep, pdf ? "pdf" : null].filter(Boolean).join(" · ");
    const regel = pdf
      ? el("button", { class: "event__knop", "aria-label": datumTekst(p.datum) + ": " + p.titel + ". Pdf van de training downloaden", onclick: ev => pdfVoor(p, vs, ev.currentTarget) })
      : el("a", { class: "event__knop", href: "#training/" + p.id, "aria-label": datumTekst(p.datum) + ": " + p.titel });
    regel.append(
      el("span", { class: "event__datum", "aria-hidden": "true" }, el("span", { class: "event__dag" }, String(d.getDate())), el("span", { class: "event__maand" }, maand)),
      el("span", { class: "event__tekst" },
        el("span", { class: "event__titel" }, p.titel, p.gepubliceerd ? null : el("span", { class: "badge concept" }, "niet zichtbaar voor trainers")),
        el("span", { class: "event__meta" }, meta)),
      el("span", { class: "event__pijl", "aria-hidden": "true" }, chevron()));
    const li = el("li", { class: "event plan" + (p.gepubliceerd ? "" : " plan--verborgen") }, regel);
    if (isAdmin()) li.append(el("div", { class: "acts event__acts" },
      el("button", { class: "chip swipe-start", onclick: () => startSwipen(p) }, ONDERDELEN.some(x => x.planning_id === p.id) ? "Voorstel opnieuw swipen" : "Voorstel swipen"),
      el("button", { class: "chip", onclick: () => bewerkPlan(p) }, "Bewerken"),
      el("button", { class: "chip", onclick: () => zetZichtbaar(p, !p.gepubliceerd) }, p.gepubliceerd ? "Verbergen" : "Zichtbaar maken"),
      el("button", { class: "chip danger", onclick: () => verwijderPlan(p) }, "Verwijderen")));
    return li;
  }
  const alles = { komend: false, vorig: false };
  function vulLijst(naam, lijst, leegTekst) {
    const box = $("#plan-" + naam), meer = $("#plan-" + naam + "-meer");
    const toon = alles[naam] ? lijst : lijst.slice(0, 3);
    box.replaceChildren(...(toon.length ? toon.map(eventRegel) : [el("li", { class: "meta" }, leegTekst)]));
    meer.hidden = lijst.length <= 3;
    meer.textContent = alles[naam] ? "Toon minder" : "Toon alle " + lijst.length;
  }
  $("#plan-komend-meer").addEventListener("click", () => { alles.komend = !alles.komend; renderPlanning(); });
  $("#plan-vorig-meer").addEventListener("click", () => { alles.vorig = !alles.vorig; renderPlanning(); });

  function renderPlanning() {
    const t = vandaag();
    $("#vandaag").textContent = datumTekst(t, true);
    const mijn = PLAN; // de planning toont beide disciplines; kiezen doe je bij Training maken
    const komend = mijn.filter(p => p.datum >= t);
    const vorig = mijn.filter(p => p.datum < t).reverse();
    const eerste = komend.length ? komend.filter(p => p.datum === komend[0].datum) : []; // meerdere trainingen op één dag
    $("#plan-volgende").replaceChildren(...(eerste.length ? eerste.map(p => planRegel(p, true)) : [el("p", { class: "meta" }, "Er staat nog geen training gepland.")]));
    vulLijst("komend", komend.slice(eerste.length), komend.length ? "Daarna nog niets gepland." : "Nog niets gepland.");
    $("#plan-vorig-n").textContent = "(" + vorig.length + ")";
    vulLijst("vorig", vorig, "Nog geen afgelopen trainingen.");
  }

  // ---------- swipen ----------
  // Admin: voorstel bij een planningregel (warming-up, n oefeningen, cooling-down); swipes worden opgeslagen.
  // Trainer: zelf een training maken in vier stappen: warming-up swipen → aantal, groepen en thema
  // kiezen → oefeningen swipen → cooling-down swipen. Swipes van trainers worden niet opgeslagen.
  let SW = null;
  // Elke stap van het swipen wordt bewaard, zodat de terugknop een stap terug gaat.
  const SW_HIST = [];
  const swSnapshot = () => Object.assign({}, SW, {
    keuze: SW.keuze.slice(), gezien: JSON.parse(JSON.stringify(SW.gezien || {})),
    themaIds: (SW.themaIds || []).slice(), groepen: SW.groepen ? SW.groepen.slice() : SW.groepen, woorden: (SW.woorden || []).slice(),
    _kop: SW._kop
  });
  const swHerstel = snap => { const tmp = SW; SW = snap; const kopie = swSnapshot(); SW = tmp; return kopie; };
  function swStapVooruit() {
    SW._kop = $("#sw-kop").textContent;
    const st = history.state, n = (st && st.tab === "swipe" ? st.swStap || 0 : 0) + 1;
    SW_HIST.length = n; SW_HIST[n] = swSnapshot();
    history.pushState({ tab: "swipe", swStap: n }, "", kaleUrl());
  }
  function startSwipen(p) {
    SW = { modus: "admin", p, disc: discVan(p), woorden: planWoorden(p), n: 3, idx: 0, keuze: [], gezien: {}, keuzeKlaar: true };
    openSwipe(datumTijd(p) + (p.groep ? " · " + p.groep : ""), "Voorstel swipen",
      "Naar rechts of ✓: de oefening gaat in de training. Naar links of ✕: je krijgt een andere. Shuffle: een andere, zonder oordeel. Elke keuze wordt onthouden voor volgende voorstellen.");
  }
  function startTrainerSwipen() {
    SW = { modus: "trainer", disc: null, woorden: [], themaIds: [], groepen: null, n: 3, idx: 0, keuze: [], gezien: {}, keuzeKlaar: false };
    openSwipe("Training maken", "Zelf een training maken",
      "Naar rechts of ✓: leuk, de oefening staat vast. Naar links of ✕: niet leuk, je krijgt een andere. Shuffle: een andere, zonder oordeel.");
  }
  const groepNaam = g => !g || g.length === 3 ? "Alle groepen" : "Groep " + g.join(" en ");
  function openSwipe(kop, titel, uitleg) {
    $$(".sw-n").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.n) === SW.n)));
    $("#sw-kop").textContent = kop; $("#sw-titel").textContent = titel; $("#sw-uitleg").textContent = uitleg;
    $("#sw-msg").textContent = "";
    $("#sw-aantal").hidden = SW.modus !== "admin";
    $("#sw-opslaan").hidden = SW.modus !== "admin"; $("#sw-trainer").hidden = SW.modus !== "trainer";
    openTab("swipe"); SW._kop = $("#sw-kop").textContent; SW_HIST.length = 0; SW_HIST[0] = swSnapshot(); renderSwipe();
  }
  const pastBijGroep = o => !SW.groepen || !(o.niveaus || []).length || o.niveaus.some(n => SW.groepen.includes(n));
  const swSlots = () => [{ soort: "warming-up", label: "Warming-up" }, ...Array.from({ length: SW.n }, (_, i) => ({ soort: "kern", label: "Oefening " + (i + 1) })), { soort: "cooling-down", label: "Cooling-down" }];
  function swKandidaten(i) {
    const slot = swSlots()[i];
    const al = SW.keuze.filter(Boolean).map(o => o.id);
    let pool = pubVan(slot.soort, SW.disc).filter(o => !al.includes(o.id));
    if (slot.soort === "kern") {
      const passend = pool.filter(o => pastBijGroep(o) && (!SW.themaIds || !SW.themaIds.length || SW.themaIds.some(id => heeftThema(o, id))));
      if (passend.length) pool = passend; // niets passends: dan alle oefeningen, liever iets dan niets
    }
    const lijst = rangschik(pool, SW.woorden).map(x => x.o);
    if (slot.soort === "cooling-down") lijst.push(Object.assign({ id: null }, TRAINERSKEUZE));
    const gezien = SW.gezien[i] || (SW.gezien[i] = []);
    let over = lijst.filter(o => !gezien.includes(o.id));
    if (!over.length && lijst.length) { SW.gezien[i] = []; over = lijst; } // alles gezien: opnieuw rond
    return over;
  }
  function swVoortgang(slots) {
    if (SW.modus === "trainer") {
      // vijf stappen: discipline, warming-up, keuze, oefeningen, cooling-down
      const stap = !SW.disc ? 0 : SW.idx === 0 ? 1 : !SW.keuzeKlaar ? 2 : SW.idx < slots.length - 1 ? 3 : SW.idx === slots.length - 1 ? 4 : 5;
      return { segmenten: [0, 1, 2, 3, 4].map(i => i < stap ? "af" : i === stap ? "nu" : ""), stap };
    }
    return { segmenten: slots.map((s, i) => i < SW.idx ? "af" : i === SW.idx ? "nu" : "") };
  }
  function renderSwipe() {
    const slots = swSlots(), klaar = SW.idx >= slots.length;
    const discVraag = SW.modus === "trainer" && !SW.disc;
    const kiezen = SW.modus === "trainer" && !discVraag && SW.idx === 1 && !SW.keuzeKlaar;
    const vg = swVoortgang(slots);
    $("#sw-voortgang").replaceChildren(...vg.segmenten.map(c => el("span", { class: c })));
    $("#sw-disc").hidden = !discVraag;
    $("#sw-bezig").hidden = klaar || kiezen || discVraag; $("#sw-klaar").hidden = !klaar || discVraag; $("#sw-keuze").hidden = !kiezen;
    if (discVraag) { $("#sw-stap").textContent = "Stap 1 van 5: veldrijden of wielrennen?"; return; }
    if (klaar) {
      $("#sw-stap").textContent = SW.modus === "trainer" ? "Klaar! Dit is je training." : "Alle " + slots.length + " onderdelen gekozen.";
      $("#sw-lijst").replaceChildren(...slots.map((s, i) => el("li", {}, el("span", { class: "voorstel__soort" }, s.label), el("b", {}, SW.keuze[i] ? SW.keuze[i].titel : "Trainerskeuze"))));
      return;
    }
    if (kiezen) { $("#sw-stap").textContent = "Stap 3 van 5: hoeveel oefeningen, voor wie en welk thema?"; renderTsThema(); return; }
    const slot = slots[SW.idx], kand = swKandidaten(SW.idx);
    SW.huidig = kand[0] || null;
    $("#sw-stap").textContent = SW.modus === "trainer"
      ? "Stap " + (vg.stap + 1) + " van 5: " + (slot.soort === "kern" ? slot.label.toLowerCase() + " van " + SW.n : slot.label.toLowerCase())
      : "Onderdeel " + (SW.idx + 1) + " van " + slots.length + ": " + slot.label;
    const kaart = $("#sw-kaart");
    swReset(false);
    if (!SW.huidig) { kaart.replaceChildren(el("p", { class: "meta" }, "Er staan nog geen oefeningen van deze soort in de bibliotheek.")); return; }
    const o = SW.huidig;
    kaart.classList.remove("nieuw"); void kaart.offsetWidth; kaart.classList.add("nieuw");
    kaart.replaceChildren(el("div", {}, el("span", { class: "voorstel__soort" }, slot.label),
      (o.tags || []).length ? el("div", { class: "trefwoorden" }, o.tags.map(t => el("span", { class: "trefwoord" + (raakt(SW.woorden, norm(t)) ? " raak" : "") }, t))) : null,
      onderdeelInfo(o)));
  }
  async function swBeoordeel(o, oordeel) {
    if (!o || !o.id || SW.modus !== "admin") return;
    const { error } = await sb.from("voorstel_beoordelingen").insert({ planning_id: SW.p.id, oefening_id: o.id, oordeel, trefwoorden: SW.p.trefwoorden || [] });
    if (!error) BEOORD.push({ oefening_id: o.id, oordeel, trefwoorden: SW.p.trefwoorden || [] });
  }

  // De kaart: slepen met vinger of muis, met richting-vergrendeling (verticaal = gewoon scrollen),
  // snelheid telt mee (een korte flick is ook een swipe), en de kaart vliegt weg voordat de volgende komt.
  const kaartEl = $("#sw-kaart"), stJa = $("#sw-stempel-ja"), stNee = $("#sw-stempel-nee");
  let bezigMet = false;
  function swZet(dx, animeer) {
    kaartEl.style.transition = animeer ? "transform .22s ease-out" : "none";
    kaartEl.style.transform = dx ? "translateX(" + dx + "px) rotate(" + (dx / 20) + "deg)" : "";
    const f = Math.min(Math.abs(dx) / 100, 1);
    stJa.style.opacity = dx > 0 ? f : 0; stNee.style.opacity = dx < 0 ? f : 0;
  }
  function swReset(animeer) { swZet(0, animeer); bezigMet = false; }
  function swVlieg(richting, daarna) {
    if (bezigMet || !SW || !SW.huidig) return;
    bezigMet = true;
    const breedte = Math.max(window.innerWidth, 400);
    swZet(richting * breedte, true);
    setTimeout(() => { daarna(); }, 200);
  }
  function swJa() {
    swVlieg(1, () => { const o = SW.huidig; swBeoordeel(o, "goed"); SW.keuze[SW.idx] = o.id ? o : null; SW.idx++; swStapVooruit(); renderSwipe(); });
  }
  function swNee() {
    swVlieg(-1, () => { const o = SW.huidig; swBeoordeel(o, "afgewezen"); (SW.gezien[SW.idx] = SW.gezien[SW.idx] || []).push(o.id); renderSwipe(); });
  }
  function swShuffle() {
    if (bezigMet || !SW || !SW.huidig) return;
    (SW.gezien[SW.idx] = SW.gezien[SW.idx] || []).push(SW.huidig.id); renderSwipe();
  }
  (function () {
    let start = null, sleept = false, dx = 0;
    kaartEl.addEventListener("pointerdown", e => {
      if (bezigMet || !SW || !SW.huidig || e.button > 0 || e.target.closest("a")) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; sleept = false; dx = 0;
    });
    kaartEl.addEventListener("pointermove", e => {
      if (!start || e.pointerId !== start.id) return;
      const ddx = e.clientX - start.x, ddy = e.clientY - start.y;
      if (!sleept) {
        if (Math.abs(ddy) > 10 && Math.abs(ddy) > Math.abs(ddx)) { start = null; return; } // verticaal: scrollen
        if (Math.abs(ddx) < 8) return;
        sleept = true; kaartEl.setPointerCapture(e.pointerId); kaartEl.classList.add("sleept");
      }
      e.preventDefault(); dx = ddx; swZet(dx, false);
    });
    const los = e => {
      if (!start || (e && e.pointerId !== start.id)) return;
      const tijd = Math.max(performance.now() - start.t, 1), snelheid = dx / tijd; // px per ms
      start = null; kaartEl.classList.remove("sleept");
      if (!sleept) return;
      sleept = false;
      if (dx > 90 || (dx > 30 && snelheid > 0.5)) swJa();
      else if (dx < -90 || (dx < -30 && snelheid < -0.5)) swNee();
      else swReset(true);
    };
    kaartEl.addEventListener("pointerup", los);
    kaartEl.addEventListener("pointercancel", () => { if (start) { start = null; sleept = false; kaartEl.classList.remove("sleept"); swReset(true); } });
  })();
  // pijltjestoetsen op de computer
  document.addEventListener("keydown", e => {
    if ($("[data-pane=swipe]").hidden || $("#sw-bezig").hidden || /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === "ArrowRight") swJa(); else if (e.key === "ArrowLeft") swNee();
  });
  $("#sw-ja").addEventListener("click", swJa);
  $("#sw-nee").addEventListener("click", swNee);
  $("#sw-shuffle").addEventListener("click", swShuffle);
  $$(".sw-n").forEach(b => b.addEventListener("click", () => {
    if (!SW) return;
    SW.n = Number(b.dataset.n); SW.idx = 0; SW.keuze = []; SW.gezien = {};
    $$(".sw-n").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderSwipe();
  }));
  $("#sw-opnieuw").addEventListener("click", () => {
    SW.idx = 0; SW.keuze = []; SW.gezien = {}; if (SW.modus === "trainer") { SW.keuzeKlaar = false; SW.disc = null; }
    $("#sw-msg").textContent = ""; renderSwipe();
  });

  // trainer, stap 2: aantal, groepen, thema
  $$(".sw-k").forEach(b => b.addEventListener("click", () => $$(".sw-k").forEach(x => x.setAttribute("aria-pressed", String(x === b)))));
  function renderTsThema() {
    // alleen thema's met oefeningen in de gekozen discipline
    const d = (SW && SW.disc) || DISC, al = $$(".sw-thema:checked").map(x => x.value);
    const met = THEMAS.filter(t => pubVan("kern", d).some(o => heeftThema(o, t.id)));
    $("#sw-themas").replaceChildren(...(met.length
      ? met.map(t => el("label", { class: "chk" }, el("input", { type: "checkbox", class: "sw-thema", value: t.id, checked: al.includes(t.id) ? "" : null }), t.naam))
      : [el("p", { class: "meta" }, "De oefeningen voor " + DISC_NAAM[d].toLowerCase() + " zijn nog niet ingedeeld in thema's. Je krijgt alle oefeningen te zien.")]));
  }
  $$(".sw-disc-knop").forEach(b => b.addEventListener("click", () => {
    if (!SW) return;
    SW.disc = b.dataset.disc; zetDisc(SW.disc);
    $("#sw-kop").textContent = DISC_NAAM[SW.disc];
    swStapVooruit(); renderSwipe();
  }));
  $("#sw-verder").addEventListener("click", () => {
    const gekozen = $$(".sw-grp:checked").map(x => Number(x.value));
    const groepen = gekozen.length ? gekozen : [1, 2, 3]; // niets aangevinkt = alle groepen
    $("#sw-keuze-msg").textContent = "";
    SW.n = Number(($$(".sw-k").find(x => x.getAttribute("aria-pressed") === "true") || { dataset: { n: 3 } }).dataset.n);
    SW.groepen = groepen;
    SW.themaIds = $$(".sw-thema:checked").map(x => x.value);
    SW.woorden = SW.themaIds.flatMap(id => woordenVan(themaNaam(id)));
    SW.keuze.length = 1; SW.gezien = { 0: SW.gezien[0] || [] };
    SW.keuzeKlaar = true;
    $("#sw-kop").textContent = DISC_NAAM[SW.disc] + " · " + (SW.themaIds.length ? SW.themaIds.map(themaNaam).join(", ") : "Alle thema's") + " · " + groepNaam(groepen);
    swStapVooruit(); renderSwipe();
  });

  // trainer: klaar met swipen
  const swGekozen = () => {
    const slots = swSlots();
    return { warm: SW.keuze[0], kernen: slots.map((s, i) => s.soort === "kern" ? SW.keuze[i] : null).filter(Boolean), cool: SW.keuze[slots.length - 1] || null };
  };
  const swThemaTekst = () => SW.themaIds && SW.themaIds.length ? SW.themaIds.map(themaNaam).join(", ") : swGekozen().kernen.map(o => o.titel).join(", ");
  $("#sw-pdf").addEventListener("click", async () => {
    const btn = $("#sw-pdf"), g = swGekozen(); btn.disabled = true; fout("");
    try {
      await maakPdf({
        datum: datumVeldTekst(), groepen: "Cat. 1 t/m 7: " + groepNaam(SW.groepen).toLowerCase(), thema: swThemaTekst(),
        succes: $("#succes").value.trim(), niet: $("#niet").value.trim(),
        warmId: g.warm.id, coolId: g.cool ? g.cool.id : null, gekozen: g.kernen.map(o => ({ id: o.id, duur: o.duur || "" })), discipline: SW.disc
      });
      const f = await insturen({
        discipline: SW.disc, datum: $("#datum").value || null, datum_tekst: datumVeldTekst(),
        titel: [$("#datum").value ? datumTekst($("#datum").value) : "", swThemaTekst()].filter(Boolean).join(" | "),
        thema: swThemaTekst(), thema_id: (SW.themaIds && SW.themaIds[0]) || null, groepen: groepNaam(SW.groepen), niveaus: SW.groepen || [],
        warm: { id: g.warm.id }, cool: g.cool ? { id: g.cool.id } : null, kernen: g.kernen.map(o => ({ id: o.id })),
        succes: $("#succes").value.trim(), niet: $("#niet").value.trim(), regels: gekozenRegels()
      });
      $("#sw-msg").textContent = f ? "De pdf is gemaakt, maar bewaren lukte niet: " + f : "Je training is bewaard. De admin kijkt hem na.";
    } catch (x) { fout("De pdf kon niet worden gemaakt: " + x.message); }
    btn.disabled = false;
  });
  $("#sw-aanpassen").addEventListener("click", () => {
    const g = swGekozen();
    vulBouwer({ disc: SW.disc, groepen: SW.groepen, thema: (SW.themaIds && SW.themaIds[0]) || null, warm: g.warm, kernen: g.kernen, cool: g.cool });
  });
  $("#ts-start").addEventListener("click", startTrainerSwipen);

  $("#sw-opslaan").addEventListener("click", async () => {
    const btn = $("#sw-opslaan"), msg = $("#sw-msg"), slots = swSlots();
    btn.disabled = true; msg.textContent = "Bezig met opslaan…";
    const rows = slots.map((s, i) => ({ planning_id: SW.p.id, positie: i, soort: s.soort, oefening_id: SW.keuze[i] ? SW.keuze[i].id : null }));
    const del = await sb.from("planning_onderdelen").delete().eq("planning_id", SW.p.id);
    const ins = del.error ? del : await sb.from("planning_onderdelen").insert(rows);
    btn.disabled = false;
    if (ins.error) { msg.textContent = "Opslaan lukte niet: " + ins.error.message; return; }
    msg.textContent = "Opgeslagen. De trainers zien deze training nu als voorgestelde training.";
    await loadData(); openTab("planning");
  });

  let bewerkId = null;
  function resetPlanForm() {
    bewerkId = null;
    ["p-datum", "p-start", "p-eind", "p-titel", "p-trefwoorden", "p-groep", "p-omschrijving"].forEach(k => $("#" + k).value = "");
    $("#p-gepubliceerd").checked = true; $("#p-discipline").value = DISC; $("#p-datum").value = volgendeTrainingsdag();
    $("#p-opslaan").textContent = "Opslaan in planning";
    $("#p-annuleer").hidden = true;
    $("#pf-kop").textContent = "Training inplannen";
  }
  function bewerkPlan(p) {
    bewerkId = p.id;
    $("#p-datum").value = p.datum; $("#p-start").value = (p.start_tijd || "").slice(0, 5); $("#p-eind").value = (p.eind_tijd || "").slice(0, 5);
    $("#p-titel").value = p.titel || ""; $("#p-trefwoorden").value = (p.trefwoorden || []).join(", "); $("#p-discipline").value = discVan(p);
    $("#p-groep").value = p.groep || ""; $("#p-omschrijving").value = p.omschrijving || "";
    $("#p-gepubliceerd").checked = p.gepubliceerd;
    $("#p-opslaan").textContent = "Wijziging opslaan"; $("#p-annuleer").hidden = false;
    $("#pf-kop").textContent = "Training bewerken";
    $("#p-msg").textContent = "";
    $("#plan-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  $("#p-annuleer").addEventListener("click", () => { resetPlanForm(); $("#p-msg").textContent = ""; });
  $("#p-opslaan").addEventListener("click", async () => {
    if (!isAdmin()) return;
    const msg = $("#p-msg"), btn = $("#p-opslaan");
    const row = {
      datum: $("#p-datum").value, start_tijd: $("#p-start").value || null, eind_tijd: $("#p-eind").value || null,
      titel: $("#p-titel").value.trim(), groep: $("#p-groep").value.trim() || null, discipline: $("#p-discipline").value,
      trefwoorden: $("#p-trefwoorden").value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean),
      omschrijving: $("#p-omschrijving").value.trim() || null, gepubliceerd: $("#p-gepubliceerd").checked
    };
    if (!row.datum || !row.titel) { msg.textContent = "Vul minimaal een datum en titel in."; return; }
    btn.disabled = true; msg.textContent = "Bezig met opslaan…";
    const q = bewerkId ? sb.from("planning").update(row).eq("id", bewerkId) : sb.from("planning").insert(row);
    const { error } = await q;
    btn.disabled = false;
    if (error) { msg.textContent = "Opslaan lukte niet: " + error.message; return; }
    msg.textContent = bewerkId ? "Wijziging opgeslagen." : "Toegevoegd aan de planning.";
    resetPlanForm(); await loadData();
  });
  async function zetZichtbaar(p, aan) {
    const { error } = await sb.from("planning").update({ gepubliceerd: aan }).eq("id", p.id);
    if (error) { fout("Aanpassen lukte niet: " + error.message); return; }
    await loadData();
  }
  async function verwijderPlan(p) {
    if (!confirm("Training van " + datumTekst(p.datum) + " uit de planning halen?")) return;
    const { error } = await sb.from("planning").delete().eq("id", p.id);
    if (error) { fout("Verwijderen lukte niet: " + error.message); return; }
    if (bewerkId === p.id) resetPlanForm();
    await loadData();
  }

  // logo: altijd naar de planning
  $("#logo").addEventListener("click", ev => { ev.preventDefault(); openTab("planning"); });

  // ---------- discipline wisselen ----------
  function zetDisc(d) {
    const nieuw = d === "weg" ? "weg" : "veldrit", zelfde = nieuw === DISC && state.slots.length;
    DISC = nieuw;
    try { localStorage.setItem("tm-discipline", DISC); } catch { /* geen opslag: alleen voor deze sessie */ }
    $$(".discipline__knop").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.disc === DISC)));
    document.body.dataset.discipline = DISC;
    $("#n-disc").value = DISC;
    if (!bewerkId) $("#p-discipline").value = DISC;
    if (zelfde) return; // niets gewisseld: keuzes blijven staan
    // keuzes uit de andere discipline vervallen
    if (state.cool && !inDisc(byId(state.cool))) state.cool = null;
    state.warm = null; state.warmOpties = []; nieuweWarm(null);
    state.slots = []; zorgSlots();
    renderThemaChips(); renderWarm(); renderCool(); renderSlots(); renderBieb(); renderTsThema(); updateTitel();
  }
  $$(".discipline__knop").forEach(b => b.addEventListener("click", () => {
    zetDisc(b.dataset.disc);
  }));
  $$(".discipline__knop").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.disc === DISC)));
  $("#n-disc").value = DISC; $("#p-discipline").value = DISC;

  // ---------- starten ----------
  (async () => {
    const { data } = await sb.auth.getSession();
    await bepaalRol(data.session);
    await loadData();
    if (!history.state && !location.hash) history.replaceState({ tab: "planning", swStap: 0 }, "", kaleUrl());
  })();
})();
