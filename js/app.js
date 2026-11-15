// Trainingsmaker Westland Wil Vooruit Jeugd — voorkant op Supabase.
// Alle tekst van gebruikers wordt via textContent getoond (nooit innerHTML).
// Twee rollen: trainer (geen account, anoniem) en admin (inloggen met alleen een wachtwoord).
// Wat elke rol mag, staat in de database (Row Level Security); de knoppen hier zijn alleen gemak.
(function () {
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
  const MIN_KERN = 2, MAX_KERN = 4; // opbouw: warming-up + 2 tot 4 oefeningen + cooling-down

  // ---------- staat ----------
  let me = null;             // null = trainer (anoniem), anders {id, rol: "admin"}
  let PLAN = [];             // planningregels (trainers zien alleen gepubliceerde)
  const isAdmin = () => !!me && me.rol === "admin";
  let THEMAS = [];
  let OEF = [];              // alle zichtbare oefeningen (rijen uit de database)
  let ONDERDELEN = [];       // goedgekeurde voorstellen per planningregel
  let BEOORD = [];           // swipes (alleen admin)
  const state = { warm: null, cool: null, thema: null, gekozen: [] }; // gekozen: [{id, duur}]; cool null = trainerskeuze
  const customs = [];        // eigen kernen (alleen in deze sessie)
  const byId = id => OEF.find(o => o.id === id) || customs.find(o => o.id === id);
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
  function toonRol() {
    $("#admin-knop").hidden = isAdmin();
    $("#admin-actief").hidden = !isAdmin();
    $("#tab-beheer").hidden = !isAdmin();
    $$(".alleen-admin").forEach(x => x.hidden = !isAdmin());
  }
  async function bepaalRol(session) {
    me = null;
    if (session) {
      const { data } = await sb.from("profielen").select("rol").eq("id", session.user.id).maybeSingle();
      if (data && data.rol === "admin") me = { id: session.user.id, rol: "admin" };
      else await sb.auth.signOut({ scope: "local" }); // ingelogd maar geen admin: gewoon weer trainer
    }
    toonRol();
  }
  $("#admin-knop").addEventListener("click", () => { openTab("admin"); $("#admin-ww").focus(); });
  $("#admin-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const msg = $("#admin-msg"), btn = $("#admin-login"), ww = $("#admin-ww").value;
    if (!ww) { msg.textContent = "Vul het wachtwoord in."; return; }
    btn.disabled = true; msg.textContent = "Even geduld…";
    const { data, error } = await sb.auth.signInWithPassword({ email: CFG.adminEmail, password: ww });
    btn.disabled = false;
    if (error || !data.session) { msg.textContent = /rate|too many/i.test(error ? error.message : "") ? "Te veel pogingen. Probeer het over een paar minuten opnieuw." : "Dat wachtwoord klopt niet."; return; }
    await bepaalRol(data.session);
    if (!isAdmin()) { msg.textContent = "Dit account is geen admin."; return; }
    $("#admin-ww").value = ""; msg.textContent = "";
    await loadData(); openTab("planning");
  });
  $("#admin-uit").addEventListener("click", async () => {
    await sb.auth.signOut({ scope: "local" });
    me = null; toonRol(); resetPlanForm(); await loadData(); openTab("planning");
  });

  // ---------- tabbladen ----------
  $$(".tab").forEach(b => b.addEventListener("click", () => openTab(b.dataset.tab)));
  function openTab(name) {
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
    if (!state.thema && THEMAS[0]) state.thema = THEMAS[0].id;
    const warm = OEF.filter(x => x.soort === "warming-up");
    if (!state.warm || !byId(state.warm)) state.warm = (warm.find(w => w.status === "gepubliceerd") || warm[0] || {}).id || null;
    state.gekozen = state.gekozen.filter(g => byId(g.id));
    if (state.cool && !byId(state.cool)) state.cool = null;
    fillThemaSelects();
    renderWarm(); renderCool(); renderChips(); renderCards(); renderSel(); renderBieb();
  }
  function fillThemaSelects() {
    const f = $("#f-thema"), n = $("#n-thema"), fv = f.value, nv = n.value;
    f.replaceChildren(el("option", { value: "" }, "Alle thema's"), ...THEMAS.map(t => el("option", { value: t.id }, t.naam)));
    n.replaceChildren(el("option", { value: "" }, "Geen thema"), ...THEMAS.map(t => el("option", { value: t.id }, t.naam)));
    f.value = fv; n.value = nv || (THEMAS[0] ? THEMAS[0].id : "");
  }

  // ---------- training maken ----------
  const conceptBadge = o => o.status === "concept" ? el("span", { class: "badge concept" }, "concept") : null;
  function renderWarm() {
    const box = $("#warm"); box.replaceChildren();
    OEF.filter(o => o.soort === "warming-up").forEach(w => {
      const u = paras(w.uitleg)[0] || "";
      box.append(el("button", { class: "opt", "aria-pressed": String(state.warm === w.id), onclick: () => { state.warm = w.id; renderWarm(); } },
        el("b", {}, w.titel, conceptBadge(w)), el("span", { class: "meta" }, (w.duur || "") + " · " + u.slice(0, 110) + (u.length > 110 ? "…" : ""))));
    });
    if (!box.children.length) box.append(el("p", { class: "meta" }, "Nog geen warming-ups in de bibliotheek."));
    updateMake();
  }
  function renderCool() {
    const box = $("#cool"); box.replaceChildren();
    box.append(el("button", { class: "opt", "aria-pressed": String(!state.cool), onclick: () => { state.cool = null; renderCool(); } },
      el("b", {}, "Trainerskeuze"), el("span", { class: "meta" }, "De trainer kiest zelf hoe de training wordt afgesloten.")));
    OEF.filter(o => o.soort === "cooling-down").forEach(c => {
      const u = paras(c.uitleg)[0] || "";
      box.append(el("button", { class: "opt", "aria-pressed": String(state.cool === c.id), onclick: () => { state.cool = c.id; renderCool(); } },
        el("b", {}, c.titel, conceptBadge(c)), el("span", { class: "meta" }, (c.duur ? c.duur + " · " : "") + u.slice(0, 110) + (u.length > 110 ? "…" : ""))));
    });
  }
  function renderChips() {
    const box = $("#chips"); box.replaceChildren();
    THEMAS.forEach(t => box.append(el("button", { class: "chip", "aria-pressed": String(state.thema === t.id), onclick: () => { state.thema = t.id; renderChips(); renderCards(); } }, t.naam)));
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
  function renderCards() {
    const box = $("#cards"); box.replaceChildren();
    const t = THEMAS.find(x => x.id === state.thema);
    if (!t) return;
    box.append(el("p", { class: "meta" }, (t.kort ? t.kort + ". " : "") + "Klik op een voorbeeld om het toe te voegen of te verwijderen."));
    const lijst = OEF.filter(o => o.soort === "kern" && o.thema_id === state.thema);
    if (!lijst.length) box.append(el("p", { class: "meta" }, "Nog geen oefeningen bij dit thema."));
    lijst.forEach(o => {
      const on = state.gekozen.some(g => g.id === o.id);
      box.append(el("button", { class: "opt", "aria-pressed": String(on), onclick: ev => { if (ev.target.closest("details")) return; toggle(o.id); } },
        el("b", {}, o.titel, o.groepen ? el("span", { class: "badge" }, o.groepen) : null, conceptBadge(o), on ? el("span", { class: "badge" }, "gekozen") : null),
        el("span", { class: "meta" }, o.duur || ""), details(o)));
    });
  }
  function toggle(id) {
    const i = state.gekozen.findIndex(g => g.id === id);
    if (i >= 0) { state.gekozen.splice(i, 1); const c = customs.findIndex(o => o.id === id); if (c >= 0) customs.splice(c, 1); }
    else state.gekozen.push({ id, duur: byId(id).duur || "" });
    renderCards(); renderSel();
  }
  function move(i, d) { const j = i + d; if (j < 0 || j >= state.gekozen.length) return; [state.gekozen[i], state.gekozen[j]] = [state.gekozen[j], state.gekozen[i]]; renderSel(); }
  function renderSel() {
    const box = $("#sel"); box.replaceChildren();
    if (!state.gekozen.length) box.append(el("p", { class: "meta" }, "Nog geen oefeningen gekozen. Kies er 2 tot 4 bij stap 3."));
    state.gekozen.forEach((g, i) => {
      const o = byId(g.id);
      const dur = el("input", { type: "text", class: "dur", "aria-label": "Duur kern " + (i + 1), value: g.duur });
      dur.addEventListener("input", () => g.duur = dur.value);
      box.append(el("div", { class: "card" }, el("div", { class: "sel" },
        el("div", {}, el("b", {}, "Kern " + (i + 1) + ": " + o.titel), o.groepen ? el("span", { class: "badge" }, o.groepen) : null, o.eigen ? el("span", { class: "badge" }, "eigen kern") : null, el("br"), dur),
        el("div", { class: "ctl" },
          el("button", { title: "Omhoog", "aria-label": "Omhoog", onclick: () => move(i, -1) }, "↑"),
          el("button", { title: "Omlaag", "aria-label": "Omlaag", onclick: () => move(i, 1) }, "↓"),
          el("button", { title: "Verwijderen", "aria-label": "Verwijderen", onclick: () => toggle(g.id) }, "✕")))));
    });
    const n = state.gekozen.length;
    $("#hint").textContent = n === 1 ? "Kies nog minimaal één oefening (2 tot 4)." : n > MAX_KERN ? "Maximaal " + MAX_KERN + " oefeningen. Haal er " + (n - MAX_KERN) + " weg." : "";
    if (!$("#thema").dataset.edited) $("#thema").value = state.gekozen.map(g => byId(g.id).titel).join(", ");
    updateMake();
  }
  function updateMake() { const n = state.gekozen.length; $("#make").disabled = n < MIN_KERN || n > MAX_KERN || !state.warm; }
  $("#thema").addEventListener("input", () => $("#thema").dataset.edited = "1");
  window.TB_PDF.RULES.forEach(r => $("#rules").append(el("li", {}, r)));

  // eigen kern
  let ekImg = null;
  $("#ek-img").addEventListener("change", async e => {
    const f = e.target.files[0]; const prev = $("#ek-prev");
    ekImg = null; prev.hidden = true; $("#ek-msg").textContent = "";
    if (!f) return;
    const err = checkFile(f);
    if (err) { $("#ek-msg").textContent = err; e.target.value = ""; return; }
    try { ekImg = await measure(await blobToData(f)); prev.src = ekImg.data; prev.hidden = false; }
    catch (x) { $("#ek-msg").textContent = x.message; e.target.value = ""; }
  });
  $("#ek-add").addEventListener("click", () => {
    const titel = $("#ek-titel").value.trim(), uitleg = $("#ek-uitleg").value.trim();
    if (!titel || !uitleg) { $("#ek-msg").textContent = "Vul minimaal de naam en de samenvatting in."; return; }
    if (state.gekozen.length >= MAX_KERN) { $("#ek-msg").textContent = "Je hebt al " + MAX_KERN + " oefeningen. Haal er eerst een weg."; return; }
    const id = "eigen-" + Date.now();
    customs.push({
      id, eigen: true, soort: "kern", titel, groepen: "", duur: "Naar keuze van de trainer",
      uitleg, intensiteit: "Naar keuze van de trainer.", differentiatie: "", doel: $("#ek-doel").value.trim() || "de renner/renster de oefening veilig en netjes uitvoert.",
      materiaal: $("#ek-mat").value.trim(), coach: $("#ek-coach").value.trim(), img: ekImg
    });
    state.gekozen.push({ id, duur: byId(id).duur });
    ["titel", "uitleg", "doel", "mat", "coach", "img"].forEach(k => $("#ek-" + k).value = "");
    ekImg = null; $("#ek-prev").hidden = true;
    $("#ek-msg").textContent = "Toegevoegd bij 'Jouw training'.";
    renderSel();
  });

  function groepenTekst() {
    const g = $$(".grp:checked").map(x => x.value);
    const naam = { 1: "groep 1 (beginnend)", 2: "groep 2 (gevorderd)", 3: "groep 3 (pro)" };
    if (g.length === 3) return "Cat. 1 t/m 7 in 3 groepen: " + g.map(x => naam[x]).join(", ");
    return g.length ? "Cat. 1 t/m 7: " + g.map(x => naam[x]).join(", ") : "Cat. 1 t/m 7";
  }
  let headerImg = null;
  // Eén pdf-functie voor "Maak training" en voor "Gebruik deze training" op de homepage.
  // t: {datum, groepen, thema, succes, niet, warmId, gekozen: [{id, duur}]}
  async function maakPdf(t) {
    if (!headerImg) headerImg = await loadImg("asset:header.png");
    const w = byId(t.warmId);
    const kernen = [];
    for (const g of t.gekozen) {
      const o = byId(g.id);
      let img = o.img || null;
      if (!img && o.tekening_pad) { try { img = await loadImg(o.tekening_pad); } catch { img = null; } }
      kernen.push({
        titel: o.titel, groepen: o.groepen || "", duur: g.duur || o.duur || "", uitleg: paras(o.uitleg), intensiteit: o.intensiteit || "",
        differentiatie: lines(o.differentiatie), doel: lines(o.doel), materiaal: o.materiaal || "", coach: o.coach || "", img,
        video: ytId(o.youtube_url) ? o.youtube_url : ""
      });
    }
    const c = t.coolId ? byId(t.coolId) : null;
    const doc = window.TB_PDF.make({
      datum: t.datum, groepen: t.groepen, thema: t.thema, succes: t.succes, niet: t.niet, header: headerImg,
      warm: { titel: w.titel, uitleg: paras(w.uitleg), duur: w.duur, intensiteit: w.intensiteit, coach: w.coach }, kernen,
      cool: c ? { titel: c.titel, uitleg: paras(c.uitleg), duur: c.duur, coach: c.coach } : null
    });
    const naam = (t.datum || "Training").replace(/[^\w\- ]+/g, "").trim() || "Training";
    doc.save("Training - " + naam + ".pdf");
  }
  $("#make").addEventListener("click", async () => {
    const btn = $("#make"); btn.disabled = true; const label = btn.textContent; btn.textContent = "Pdf wordt gemaakt…"; fout("");
    try {
      await maakPdf({
        datum: $("#datum").value.trim(), groepen: groepenTekst(), thema: $("#thema").value.trim(),
        succes: $("#succes").value.trim(), niet: $("#niet").value.trim(), warmId: state.warm, coolId: state.cool, gekozen: state.gekozen
      });
    } catch (x) { fout("De pdf kon niet worden gemaakt: " + x.message); }
    btn.textContent = label; updateMake();
  });

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
      if (!state.gekozen.some(g => g.id === o.id)) state.gekozen.push({ id: o.id, duur: o.duur || "" });
      if (o.thema_id) state.thema = o.thema_id;
      renderChips(); renderCards(); renderSel(); openTab("bouwer");
    } }, "Gebruik in training"));
    else if (o.soort === "cooling-down") acts.append(el("button", { class: "chip", onclick: () => { state.cool = o.id; renderCool(); openTab("bouwer"); } }, "Kies als cooling-down"));
    else acts.append(el("button", { class: "chip", onclick: () => { state.warm = o.id; renderWarm(); openTab("bouwer"); } }, "Kies als warming-up"));
    if (extra) extra(acts);
    else if (isAdmin()) acts.append(el("button", { class: "chip danger", onclick: () => verwijder(o) }, "Verwijderen"));
    return el("div", { class: "card item" },
      el("h3", {}, o.titel, conceptBadge(o)),
      el("p", { class: "meta first" }, [{ kern: "Kern", "warming-up": "Warming-up", "cooling-down": "Cooling-down" }[o.soort], themaNaam(o.thema_id), o.groepen || ("Groep " + (o.niveaus || []).join(", ")), o.duur, o.discipline === "weg" ? "Weg" : ""].filter(Boolean).join(" · ")),
      details(o), acts);
  }
  function renderBieb() {
    const q = norm($("#zoek").value).split(/\s+/).filter(Boolean);
    const soort = $("#f-soort").value, thema = $("#f-thema").value, niv = Number($("#f-niveau").value);
    const lijst = OEF.filter(o => {
      if (soort && o.soort !== soort) return false;
      if (thema && o.thema_id !== thema) return false;
      if (niv && !(o.niveaus || []).includes(niv)) return false;
      const hay = norm([o.titel, o.uitleg, o.coach, o.materiaal, o.differentiatie, (o.tags || []).join(" "), themaNaam(o.thema_id)].join(" "));
      return q.every(w => hay.includes(w));
    });
    $("#bieb-n").textContent = lijst.length + " van " + OEF.length + " oefeningen";
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
        soort: $("#n-soort").value, discipline: $("#n-disc").value, titel, thema_id: $("#n-thema").value || null,
        groepen: $("#n-groepen").value.trim() || null, niveaus, duur: $("#n-duur").value.trim() || null, uitleg,
        intensiteit: $("#n-int").value.trim() || null, differentiatie: $("#n-diff").value.trim() || null, doel: $("#n-doel").value.trim() || null,
        materiaal: $("#n-mat").value.trim() || null, coach: $("#n-coach").value.trim() || null, tekening_pad: pad,
        tags: $("#n-tags").value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean), youtube_url: yt || null,
        status: "gepubliceerd", created_by: isAdmin() ? me.id : null
      };
      const { error } = await sb.from("oefeningen").insert(row);
      if (error) throw error;
      ["n-titel", "n-groepen", "n-duur", "n-uitleg", "n-int", "n-diff", "n-doel", "n-mat", "n-coach", "n-tags", "n-yt", "n-img"].forEach(k => $("#" + k).value = "");
      msg.textContent = "Opgeslagen. Je oefening staat nu in de bibliotheek.";
      await loadData();
    } catch (x) {
      if (pad) await sb.storage.from("tekeningen").remove([pad]);
      msg.textContent = "Opslaan lukte niet: " + x.message;
    }
    btn.disabled = false;
  });

  // ---------- beheer ----------
  function renderBeheer() {
    if (!isAdmin()) return;
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
    const titelW = woordenVan(o.titel), tagW = (o.tags || []).flatMap(woordenVan), themaW = woordenVan(themaNaam(o.thema_id));
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
  const pubVan = soort => OEF.filter(o => o.status === "gepubliceerd" && o.soort === soort);
  const rangschik = (lijst, woorden) => lijst.map(o => ({ o, s: score(o, woorden) })).sort((a, b) => b.s - a.s || a.o.titel.localeCompare(b.o.titel));
  function voorstel(p) {
    const vast = ONDERDELEN.filter(x => x.planning_id === p.id).sort((a, b) => a.positie - b.positie);
    if (vast.length) {
      const warm = vast.find(x => x.soort === "warming-up"), cool = vast.find(x => x.soort === "cooling-down");
      const kernen = vast.filter(x => x.soort === "kern").map(x => byId(x.oefening_id)).filter(Boolean);
      if (warm && byId(warm.oefening_id) && kernen.length >= MIN_KERN)
        return { warm: byId(warm.oefening_id), kernen, cool: cool && cool.oefening_id ? byId(cool.oefening_id) || null : null, goedgekeurd: true };
    }
    const woorden = planWoorden(p);
    const warm = rangschik(pubVan("warming-up"), woorden)[0];
    const kern = rangschik(pubVan("kern"), woorden);
    if (!warm || kern.length < MIN_KERN) return null;
    const gekozen = kern.filter(x => x.s > 0).slice(0, 3).map(x => x.o);
    const bij = (o) => { if (gekozen.length < MIN_KERN && !gekozen.includes(o)) gekozen.push(o); };
    if (gekozen[0]) kern.filter(x => x.o.thema_id === gekozen[0].thema_id).forEach(x => bij(x.o)); // aanvullen uit hetzelfde thema
    kern.forEach(x => bij(x.o));
    const cool = rangschik(pubVan("cooling-down"), woorden).find(x => x.s > 0);
    return { warm: warm.o, kernen: gekozen, cool: cool ? cool.o : null, goedgekeurd: false };
  }

  function maakTraining(p, vs) {
    $("#datum").value = datumTijd(p);
    if (p.titel) { $("#thema").value = p.titel; $("#thema").dataset.edited = "1"; }
    if (vs) {
      state.warm = vs.warm.id; state.cool = vs.cool ? vs.cool.id : null;
      customs.splice(0); state.gekozen = vs.kernen.map(o => ({ id: o.id, duur: o.duur || "" }));
      if (vs.kernen[0] && vs.kernen[0].thema_id) state.thema = vs.kernen[0].thema_id;
      renderWarm(); renderCool(); renderChips(); renderCards(); renderSel();
    }
    openTab("bouwer");
  }

  async function gebruikTraining(p, vs, btn) {
    btn.disabled = true; const label = btn.firstChild.textContent; btn.firstChild.textContent = "Pdf wordt gemaakt…"; fout("");
    try {
      await maakPdf({
        datum: datumTijd(p), groepen: p.groep ? "Cat. 1 t/m 7: " + p.groep : groepenTekst(), thema: p.titel || "",
        succes: $("#succes").value.trim(), niet: $("#niet").value.trim(),
        warmId: vs.warm.id, coolId: vs.cool ? vs.cool.id : null, gekozen: vs.kernen.map(o => ({ id: o.id, duur: o.duur || "" }))
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
    const kop = [afstand(p.datum), tijdTekst(p), p.groep, p.locatie].filter(Boolean).join(" · ");
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
  const PIJL = "https://westlandwilvooruit.nl/wp-content/uploads/2025/10/Pijl-zwart-1.svg";
  function eventRegel(p) {
    const d = alsDatum(p.datum);
    const dag = d.toLocaleDateString("nl-NL", { weekday: "long" });
    const maand = d.toLocaleDateString("nl-NL", { month: "short" }).replace(".", "");
    const meta = [hoofdletter(dag) + (tijdTekst(p) ? " " + tijdTekst(p) : ""), p.groep].filter(Boolean).join(" · ");
    const regel = el("button", { class: "event__knop", onclick: () => maakTraining(p, voorstel(p)), "aria-label": datumTekst(p.datum) + ": " + p.titel + ". Training maken" },
      el("span", { class: "event__datum", "aria-hidden": "true" }, el("span", { class: "event__dag" }, String(d.getDate())), el("span", { class: "event__maand" }, maand)),
      el("span", { class: "event__tekst" },
        el("span", { class: "event__titel" }, p.titel, p.gepubliceerd ? null : el("span", { class: "badge concept" }, "niet zichtbaar voor trainers")),
        el("span", { class: "event__meta" }, meta)),
      el("span", { class: "event__pijl", "aria-hidden": "true" }, el("img", { src: PIJL, alt: "", width: "22", height: "14" })));
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
    const komend = PLAN.filter(p => p.datum >= t);
    const vorig = PLAN.filter(p => p.datum < t).reverse();
    const eerste = komend.length ? komend.filter(p => p.datum === komend[0].datum) : []; // meerdere trainingen op één dag
    $("#plan-volgende").replaceChildren(...(eerste.length ? eerste.map(p => planRegel(p, true)) : [el("p", { class: "meta" }, "Er staat nog geen training gepland.")]));
    vulLijst("komend", komend.slice(eerste.length), komend.length ? "Daarna nog niets gepland." : "Nog niets gepland.");
    $("#plan-vorig-n").textContent = "(" + vorig.length + ")";
    vulLijst("vorig", vorig, "Nog geen afgelopen trainingen.");
  }

  // ---------- admin: voorstel swipen ----------
  // Per plek (warming-up, oefeningen, cooling-down) een kandidaat. Rechts = in de training,
  // links = afgewezen en een andere, shuffle = een andere zonder oordeel. Elke swipe wordt opgeslagen.
  let SW = null;
  function startSwipen(p) {
    SW = { p, woorden: planWoorden(p), n: 3, idx: 0, keuze: [], gezien: {} };
    $$(".sw-n").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.n) === SW.n)));
    $("#sw-kop").textContent = datumTijd(p) + (p.groep ? " · " + p.groep : "");
    $("#sw-msg").textContent = "";
    openTab("swipe"); renderSwipe();
  }
  const swSlots = () => [{ soort: "warming-up", label: "Warming-up" }, ...Array.from({ length: SW.n }, (_, i) => ({ soort: "kern", label: "Oefening " + (i + 1) })), { soort: "cooling-down", label: "Cooling-down" }];
  function swKandidaten(i) {
    const slot = swSlots()[i];
    const al = SW.keuze.filter(Boolean).map(o => o.id);
    let lijst = rangschik(pubVan(slot.soort).filter(o => !al.includes(o.id)), SW.woorden).map(x => x.o);
    if (slot.soort === "cooling-down") lijst.push(Object.assign({ id: null }, TRAINERSKEUZE));
    const gezien = SW.gezien[i] || (SW.gezien[i] = []);
    let over = lijst.filter(o => !gezien.includes(o.id));
    if (!over.length && lijst.length) { SW.gezien[i] = []; over = lijst; } // alles gezien: opnieuw rond
    return over;
  }
  function renderSwipe() {
    const slots = swSlots(), klaar = SW.idx >= slots.length;
    $("#sw-voortgang").replaceChildren(...slots.map((s, i) => el("span", { class: i < SW.idx ? "af" : i === SW.idx ? "nu" : "" })));
    $("#sw-bezig").hidden = klaar; $("#sw-klaar").hidden = !klaar;
    if (klaar) {
      $("#sw-stap").textContent = "Alle " + slots.length + " onderdelen gekozen.";
      $("#sw-lijst").replaceChildren(...slots.map((s, i) => el("li", {}, el("span", { class: "voorstel__soort" }, s.label), el("b", {}, SW.keuze[i] ? SW.keuze[i].titel : "Trainerskeuze"))));
      return;
    }
    const slot = slots[SW.idx], kand = swKandidaten(SW.idx);
    SW.huidig = kand[0] || null;
    $("#sw-stap").textContent = "Onderdeel " + (SW.idx + 1) + " van " + slots.length + ": " + slot.label;
    const kaart = $("#sw-kaart");
    kaart.style.transform = ""; kaart.className = "sw-kaart";
    if (!SW.huidig) { kaart.replaceChildren(el("p", { class: "meta" }, "Er staan nog geen oefeningen van deze soort in de bibliotheek.")); return; }
    const o = SW.huidig;
    kaart.replaceChildren(el("div", {}, el("span", { class: "voorstel__soort" }, slot.label),
      (o.tags || []).length ? el("div", { class: "trefwoorden" }, o.tags.map(t => el("span", { class: "trefwoord" + (raakt(SW.woorden, norm(t)) ? " raak" : "") }, t))) : null,
      onderdeelInfo(o)));
  }
  async function swBeoordeel(oordeel) {
    const o = SW.huidig;
    if (!o || !o.id) return;
    const { error } = await sb.from("voorstel_beoordelingen").insert({ planning_id: SW.p.id, oefening_id: o.id, oordeel, trefwoorden: SW.p.trefwoorden || [] });
    if (!error) BEOORD.push({ oefening_id: o.id, oordeel, trefwoorden: SW.p.trefwoorden || [] });
  }
  function swJa() { if (!SW || !SW.huidig) return; swBeoordeel("goed"); SW.keuze[SW.idx] = SW.huidig.id ? SW.huidig : null; SW.idx++; renderSwipe(); }
  function swNee() { if (!SW || !SW.huidig) return; swBeoordeel("afgewezen"); (SW.gezien[SW.idx] = SW.gezien[SW.idx] || []).push(SW.huidig.id); renderSwipe(); }
  function swShuffle() { if (!SW || !SW.huidig) return; (SW.gezien[SW.idx] = SW.gezien[SW.idx] || []).push(SW.huidig.id); renderSwipe(); }
  $("#sw-ja").addEventListener("click", swJa);
  $("#sw-nee").addEventListener("click", swNee);
  $("#sw-shuffle").addEventListener("click", swShuffle);
  $$(".sw-n").forEach(b => b.addEventListener("click", () => {
    if (!SW) return;
    SW.n = Number(b.dataset.n); SW.idx = 0; SW.keuze = []; SW.gezien = {};
    $$(".sw-n").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderSwipe();
  }));
  $("#sw-opnieuw").addEventListener("click", () => { SW.idx = 0; SW.keuze = []; SW.gezien = {}; $("#sw-msg").textContent = ""; renderSwipe(); });
  // slepen met de vinger of muis
  (function () {
    const k = $("#sw-kaart"); let x0 = null, dx = 0;
    k.addEventListener("pointerdown", e => { if (!SW || !SW.huidig) return; x0 = e.clientX; dx = 0; k.setPointerCapture(e.pointerId); k.classList.add("sleept"); });
    k.addEventListener("pointermove", e => {
      if (x0 === null) return;
      dx = e.clientX - x0;
      k.style.transform = "translateX(" + dx + "px) rotate(" + (dx / 18) + "deg)";
      k.classList.toggle("naar-rechts", dx > 40); k.classList.toggle("naar-links", dx < -40);
    });
    const los = () => {
      if (x0 === null) return;
      x0 = null; k.classList.remove("sleept");
      if (dx > 100) swJa(); else if (dx < -100) swNee();
      else { k.style.transform = ""; k.classList.remove("naar-rechts", "naar-links"); }
    };
    k.addEventListener("pointerup", los); k.addEventListener("pointercancel", los);
  })();
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
    $("#p-gepubliceerd").checked = true;
    $("#p-opslaan").textContent = "Opslaan in planning";
    $("#p-annuleer").hidden = true;
    $("#pf-kop").textContent = "Training inplannen";
  }
  function bewerkPlan(p) {
    bewerkId = p.id;
    $("#p-datum").value = p.datum; $("#p-start").value = (p.start_tijd || "").slice(0, 5); $("#p-eind").value = (p.eind_tijd || "").slice(0, 5);
    $("#p-titel").value = p.titel || ""; $("#p-trefwoorden").value = (p.trefwoorden || []).join(", ");
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
      titel: $("#p-titel").value.trim(), groep: $("#p-groep").value.trim() || null,
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

  // ---------- starten ----------
  (async () => {
    const { data } = await sb.auth.getSession();
    await bepaalRol(data.session);
    await loadData();
  })();
})();
