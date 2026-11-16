// Admin-inlog voor de Trainingsmaker: e-mail + wachtwoord, daarna altijd een TOTP-code.
// Supabase Auth controleert wachtwoord en code (met eigen rem op te veel pogingen).
// Pas na de code is de sessie "aal2"; alleen dan geeft de database adminrechten
// (private.is_admin()). Een wachtwoord alleen is dus nooit genoeg.
(function () {
  if (window.top !== window.self) { document.documentElement.hidden = true; return; } // geen clickjacking
  const CFG = window.TB_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const $ = s => document.querySelector(s);
  const msg = t => { $("#msg").textContent = t || ""; };
  const toon = id => ["#stap-ww", "#stap-koppel", "#stap-code"].forEach(x => { $(x).hidden = x !== id; });
  const naarApp = () => location.replace("../");
  const zesCijfers = v => /^\d{6}$/.test(v);
  let factorId = null;

  async function isAdmin() {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return false;
    const { data } = await sb.from("profielen").select("rol").eq("id", s.session.user.id).maybeSingle();
    return !!data && data.rol === "admin";
  }

  // Bepaal de volgende stap na een geldig wachtwoord (of bij een bestaande sessie).
  async function volgendeStap() {
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.currentLevel === "aal2") return klaar();
    const { data: f, error } = await sb.auth.mfa.listFactors();
    if (error) throw error;
    const totp = (f.totp || []).find(x => x.status === "verified");
    if (totp) { factorId = totp.id; toon("#stap-code"); $("#code").focus(); return; }
    // Nog geen authenticator gekoppeld: oude, niet afgemaakte koppelingen opruimen en een nieuwe starten.
    for (const x of (f.all || []).filter(x => x.factor_type === "totp" && x.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: x.id });
    const { data: e, error: ee } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Trainingsmaker " + new Date().toISOString().slice(0, 16) });
    if (ee) throw ee;
    factorId = e.id;
    const qr = e.totp.qr_code || "";
    $("#qr").src = qr.startsWith("data:") ? qr : "data:image/svg+xml;utf-8," + encodeURIComponent(qr);
    $("#geheim").textContent = e.totp.secret;
    toon("#stap-koppel"); $("#koppel-code").focus();
  }

  async function klaar() {
    if (await isAdmin()) return naarApp();
    await sb.auth.signOut({ scope: "local" });
    toon("#stap-ww"); msg("Dit account heeft geen toegang.");
  }

  async function controleerCode(veld, knop) {
    const code = $(veld).value.trim();
    if (!zesCijfers(code)) { msg("Vul de 6 cijfers uit de app in."); return; }
    $(knop).disabled = true; msg("Even geduld…");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
    $(knop).disabled = false; $(veld).value = "";
    if (error) { msg(/rate|too many/i.test(error.message) ? "Te veel pogingen. Wacht een paar minuten." : "Die code klopt niet (of is verlopen). Probeer de nieuwe code."); return; }
    msg(""); await klaar();
  }

  $("#stap-ww").addEventListener("submit", async ev => {
    ev.preventDefault();
    const email = $("#email").value.trim(), ww = $("#ww").value;
    if (!email || !ww) { msg("Vul je e-mailadres en wachtwoord in."); return; }
    $("#ww-knop").disabled = true; msg("Even geduld…");
    const { data, error } = await sb.auth.signInWithPassword({ email, password: ww });
    $("#ww-knop").disabled = false; $("#ww").value = "";
    // Eén algemene melding: verraadt niet of het e-mailadres bestaat.
    if (error || !data.session) { msg(/rate|too many/i.test(error ? error.message : "") ? "Te veel pogingen. Probeer het over een paar minuten opnieuw." : "E-mailadres of wachtwoord klopt niet."); return; }
    msg("");
    try { await volgendeStap(); } catch (x) { await sb.auth.signOut({ scope: "local" }); toon("#stap-ww"); msg("Inloggen lukte niet: " + x.message); }
  });
  $("#stap-koppel").addEventListener("submit", ev => { ev.preventDefault(); controleerCode("#koppel-code", "#koppel-knop"); });
  $("#stap-code").addEventListener("submit", ev => { ev.preventDefault(); controleerCode("#code", "#code-knop"); });

  // Al (half) ingelogd? Dan meteen door naar de juiste stap.
  (async () => {
    const { data } = await sb.auth.getSession();
    if (!data.session) { toon("#stap-ww"); $("#email").focus(); return; }
    try { await volgendeStap(); } catch { await sb.auth.signOut({ scope: "local" }); toon("#stap-ww"); }
  })();
})();
