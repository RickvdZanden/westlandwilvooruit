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

  // ---------- staat ----------
  let me = null;             // null = trainer (anoniem), anders {id, rol: "admin"}
  let PLAN = [];             // planningregels (trainers zien alleen gepubliceerde)
  const isAdmin = () => !!me && me.rol === "admin";
  let THEMAS = [];
  let OEF = [];              // alle zichtbare oefeningen (rijen uit de database)
  const state = { warm: null, thema: null, gekozen: [] }; // gekozen: [{id, duur}]
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
    const [t, o, p] = await Promise.all([
      sb.from("themas").select("id, naam, kort, volgorde").order("volgorde"),
      sb.from("oefeningen").select("*").order("titel"),
      sb.from("planning").select("*").order("datum").order("start_tijd", { nullsFirst: true })
    ]);
    if (p.error) fout("Kon de planning niet laden: " + p.error.message);
    else { PLAN = p.data; renderPlanning(); }
    if (t.error || o.error) { fout("Kon de bibliotheek niet laden: " + (t.error || o.error).message); return; }
    THEMAS = t.data; OEF = o.data;
    if (!state.thema && THEMAS[0]) state.thema = THEMAS[0].id;
    const warm = OEF.filter(x => x.soort === "warming-up");
    if (!state.warm || !byId(state.warm)) state.warm = (warm.find(w => w.status === "gepubliceerd") || warm[0] || {}).id || null;
    state.gekozen = state.gekozen.filter(g => byId(g.id));
    fillThemaSelects();
    renderWarm(); renderChips(); renderCards(); renderSel(); renderBieb();
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
  function renderChips() {
    const box = $("#chips"); box.replaceChildren();
    THEMAS.forEach(t => box.append(el("button", { class: "chip", "aria-pressed": String(state.thema === t.id), onclick: () => { state.thema = t.id; renderChips(); renderCards(); } }, t.naam)));
  }
  function details(o) {
    const d = el("details", {}, el("summary", {}, "Bekijk uitleg"),
      el("p", {}, paras(o.uitleg).join("\n\n")),
      o.differentiatie ? el("p", { class: "meta" }, "Differentiatie:\n" + lines(o.differentiatie).join("\n")) : null,
      o.coach ? el("p", { class: "meta" }, "Waar coach je op? " + o.coach) : null);
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
    if (!state.gekozen.length) box.append(el("p", { class: "meta" }, "Nog geen kernen gekozen. Kies er 2 of 3 bij stap 3."));
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
    $("#hint").textContent = state.gekozen.length > 3 ? "Let op: dit zijn veel kernen voor één training. Liever 2 sterke kernen dan 3 halve." : "";
    if (!$("#thema").dataset.edited) $("#thema").value = state.gekozen.map(g => byId(g.id).titel).join(", ");
    updateMake();
  }
  function updateMake() { $("#make").disabled = !state.gekozen.length || !state.warm; }
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
    if (!titel || !uitleg) { $("#ek-msg").textContent = "Vul minimaal een titel en uitleg in."; return; }
    const id = "eigen-" + Date.now();
    customs.push({
      id, eigen: true, soort: "kern", titel, groepen: $("#ek-groepen").value.trim(), duur: $("#ek-duur").value.trim() || "Naar keuze van de trainer",
      uitleg, intensiteit: "Naar keuze van de trainer.", differentiatie: $("#ek-diff").value, doel: "de renner/renster de oefening veilig en netjes uitvoert.",
      materiaal: $("#ek-mat").value.trim(), coach: $("#ek-coach").value.trim(), img: ekImg
    });
    state.gekozen.push({ id, duur: byId(id).duur });
    ["titel", "groepen", "duur", "uitleg", "diff", "mat", "coach", "img"].forEach(k => $("#ek-" + k).value = "");
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
  $("#make").addEventListener("click", async () => {
    const btn = $("#make"); btn.disabled = true; const label = btn.textContent; btn.textContent = "Pdf wordt gemaakt…"; fout("");
    try {
      if (!headerImg) headerImg = await loadImg("asset:header.png");
      const w = byId(state.warm);
      const kernen = [];
      for (const g of state.gekozen) {
        const o = byId(g.id);
        let img = o.img || null;
        if (!img && o.tekening_pad) { try { img = await loadImg(o.tekening_pad); } catch { img = null; } }
        kernen.push({
          titel: o.titel, groepen: o.groepen || "", duur: g.duur || o.duur || "", uitleg: paras(o.uitleg), intensiteit: o.intensiteit || "",
          differentiatie: lines(o.differentiatie), doel: lines(o.doel), materiaal: o.materiaal || "", coach: o.coach || "", img
        });
      }
      const doc = window.TB_PDF.make({
        datum: $("#datum").value.trim(), groepen: groepenTekst(), thema: $("#thema").value.trim(),
        succes: $("#succes").value.trim(), niet: $("#niet").value.trim(), header: headerImg,
        warm: { titel: w.titel, uitleg: paras(w.uitleg), duur: w.duur, intensiteit: w.intensiteit, coach: w.coach }, kernen
      });
      const naam = ($("#datum").value || "Training").replace(/[^\w\- ]+/g, "").trim() || "Training";
      doc.save("Training - " + naam + ".pdf");
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
    else acts.append(el("button", { class: "chip", onclick: () => { state.warm = o.id; renderWarm(); openTab("bouwer"); } }, "Kies als warming-up"));
    if (extra) extra(acts);
    else if (o.status === "concept" && isAdmin()) acts.append(el("button", { class: "chip danger", onclick: () => verwijder(o) }, "Verwijderen"));
    return el("div", { class: "card item" },
      el("h3", {}, o.titel, conceptBadge(o)),
      el("p", { class: "meta first" }, [o.soort === "kern" ? "Kern" : "Warming-up", themaNaam(o.thema_id), o.groepen || ("Groep " + (o.niveaus || []).join(", ")), o.duur, o.discipline === "weg" ? "Weg" : ""].filter(Boolean).join(" · ")),
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
  $("#n-soort").addEventListener("input", () => { if ($("#n-soort").value === "warming-up") $("#n-thema").value = ""; });
  $("#n-save").addEventListener("click", async () => {
    const msg = $("#n-msg"), btn = $("#n-save");
    const titel = $("#n-titel").value.trim(), uitleg = $("#n-uitleg").value.trim();
    const niveaus = $$(".n-niv:checked").map(x => Number(x.value));
    if (!titel || !uitleg) { msg.textContent = "Vul minimaal een titel en uitleg in."; return; }
    if (!niveaus.length) { msg.textContent = "Kies minimaal één groep."; return; }
    if (/\bhij\b/i.test(uitleg + " " + $("#n-doel").value + " " + $("#n-coach").value)) { msg.textContent = "Schrijf \"de renner/renster\" in plaats van \"hij\"."; return; }
    const f = isAdmin() ? $("#n-img").files[0] : null, ferr = checkFile(f);
    if (ferr) { msg.textContent = ferr; return; }
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
        tags: $("#n-tags").value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean), status: "concept", created_by: isAdmin() ? me.id : null
      };
      const { error } = await sb.from("oefeningen").insert(row);
      if (error) throw error;
      ["n-titel", "n-groepen", "n-duur", "n-uitleg", "n-int", "n-diff", "n-doel", "n-mat", "n-coach", "n-tags", "n-img"].forEach(k => $("#" + k).value = "");
      msg.textContent = isAdmin() ? "Opgeslagen als concept. Publiceer hem bij Beheer." : "Opgeslagen. Je voorstel staat in de bibliotheek zodra de admin het heeft goedgekeurd.";
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

  function maakTraining(p) {
    $("#datum").value = datumTekst(p.datum) + (p.start_tijd ? ", " + p.start_tijd.slice(0, 5) : "");
    if (p.titel) { $("#thema").value = p.titel; $("#thema").dataset.edited = "1"; }
    openTab("bouwer");
  }

  function planRegel(p, groot) {
    const acts = el("div", { class: "acts" });
    acts.append(el("button", { class: groot ? "knop knop--klein" : "chip", onclick: () => maakTraining(p) },
      el("span", {}, "Maak training voor deze dag"),
      groot ? el("span", { class: "knop__pijl", "aria-hidden": "true" }, el("img", { src: "https://westlandwilvooruit.nl/wp-content/uploads/2025/10/Pijl-zwart-1.svg", alt: "", width: "22", height: "14" })) : null));
    if (isAdmin()) {
      acts.append(
        el("button", { class: "chip", onclick: () => bewerkPlan(p) }, "Bewerken"),
        el("button", { class: "chip", onclick: () => zetZichtbaar(p, !p.gepubliceerd) }, p.gepubliceerd ? "Verbergen" : "Zichtbaar maken"),
        el("button", { class: "chip danger", onclick: () => verwijderPlan(p) }, "Verwijderen"));
    }
    const kop = [afstand(p.datum), tijdTekst(p), p.groep, p.locatie].filter(Boolean).join(" · ");
    return el("div", { class: "card plan" + (groot ? " plan--groot" : "") + (p.gepubliceerd ? "" : " plan--verborgen") },
      el("p", { class: "plan__datum" }, datumTekst(p.datum)),
      el(groot ? "h2" : "h3", { class: "plan__titel" }, p.titel, p.gepubliceerd ? null : el("span", { class: "badge concept" }, "niet zichtbaar voor trainers")),
      el("p", { class: "meta first" }, kop),
      p.omschrijving ? el("p", { class: "plan__tekst" }, p.omschrijving) : null,
      acts);
  }

  function renderPlanning() {
    const t = vandaag();
    $("#vandaag").textContent = "Vandaag: " + datumTekst(t, true);
    const komend = PLAN.filter(p => p.datum >= t);
    const vorig = PLAN.filter(p => p.datum < t).reverse();
    const leeg = tekst => el("p", { class: "meta" }, tekst);
    $("#plan-volgende").replaceChildren(komend[0] ? planRegel(komend[0], true) : leeg("Er staat nog geen training gepland."));
    $("#plan-komend").replaceChildren(...(komend.length > 1 ? komend.slice(1).map(p => planRegel(p)) : [leeg(komend.length ? "Daarna nog niets gepland." : "Nog niets gepland.")]));
    $("#plan-vorig-n").textContent = "(" + vorig.length + ")";
    $("#plan-vorig").replaceChildren(...(vorig.length ? vorig.map(p => planRegel(p)) : [leeg("Nog geen vorige trainingen.")]));
  }

  let bewerkId = null;
  function resetPlanForm() {
    bewerkId = null;
    ["p-datum", "p-start", "p-eind", "p-titel", "p-groep", "p-omschrijving"].forEach(k => $("#" + k).value = "");
    $("#p-gepubliceerd").checked = true;
    $("#p-opslaan").textContent = "Opslaan in planning";
    $("#p-annuleer").hidden = true;
    $("#pf-kop").textContent = "Training inplannen";
  }
  function bewerkPlan(p) {
    bewerkId = p.id;
    $("#p-datum").value = p.datum; $("#p-start").value = (p.start_tijd || "").slice(0, 5); $("#p-eind").value = (p.eind_tijd || "").slice(0, 5);
    $("#p-titel").value = p.titel || ""; $("#p-groep").value = p.groep || ""; $("#p-omschrijving").value = p.omschrijving || "";
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
