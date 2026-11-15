// Maakt js/sleutels.json voor het wachtwoordslot van de Trainingsmaker.
// Formaat: één salt + PBKDF2-SHA256 (iteraties) → AES-GCM-256, per rol een eigen IV + data.
// Moet overeenkomen met js/slot.js.
(function () {
  const ITERATIES = 600000;
  const $ = s => document.querySelector(s);
  const naarB64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
  const willekeurig = n => crypto.getRandomValues(new Uint8Array(n));
  const sterkWachtwoord = () => naarB64(willekeurig(24)).replace(/[+/=]/g, "");

  const ROLLEN = [
    { id: "trainer", naam: "Trainers", mail: "trainingsmaker-trainer@westlandwilvooruit.nl" },
    { id: "beheer", naam: "Beheer (optioneel)", mail: "trainingsmaker-beheer@westlandwilvooruit.nl" }
  ];
  $("#rollen").append(...ROLLEN.map(r => {
    const f = document.createElement("fieldset");
    f.innerHTML = `
      <legend></legend>
      <label>Toegangswachtwoord (dit typen de gebruikers)</label>
      <input type="text" data-veld="toegang" autocomplete="off">
      <label>E-mail van het gedeelde Supabase-account</label>
      <input type="email" data-veld="email" autocomplete="off">
      <label>Wachtwoord van dat Supabase-account (niemand hoeft dit te kennen)</label>
      <div class="rij"><input type="text" data-veld="accountww" autocomplete="off"><button type="button" class="lijn" data-genereer>Genereer</button></div>`;
    f.querySelector("legend").textContent = r.naam;
    f.querySelector("[data-veld=email]").placeholder = r.mail;
    f.dataset.rol = r.id;
    f.querySelector("[data-genereer]").addEventListener("click", () => {
      f.querySelector("[data-veld=accountww]").value = sterkWachtwoord();
    });
    return f;
  }));

  const status = (t, fout) => { const s = $("#status"); s.textContent = t; s.className = fout ? "fout" : ""; };

  $("#maak").addEventListener("click", async () => {
    const supabaseUrl = $("#url").value.trim().replace(/\/+$/, "");
    const supabaseKey = $("#key").value.trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) return status("Vul een geldige Project URL in (https://….supabase.co).", true);
    if (!supabaseKey.startsWith("sb_publishable_") && !supabaseKey.startsWith("eyJ")) return status("Vul de publishable key in. Gebruik NOOIT de secret of service-role key.", true);
    if (supabaseKey.startsWith("sb_secret_")) return status("Dat is een secret key. Gebruik de publishable key.", true);

    const rollen = [];
    for (const f of document.querySelectorAll("#rollen fieldset")) {
      const v = n => f.querySelector(`[data-veld=${n}]`).value.trim();
      const toegang = f.querySelector("[data-veld=toegang]").value; // niet trimmen: precies wat de gebruiker typt
      if (!toegang && !v("email") && !v("accountww")) continue;
      if (toegang.length < 12) return status(`Toegangswachtwoord voor "${f.dataset.rol}" is te kort (minimaal 12 tekens).`, true);
      if (!v("email") || !v("accountww")) return status(`Vul e-mail en accountwachtwoord in voor "${f.dataset.rol}".`, true);
      rollen.push({ rol: f.dataset.rol, toegang, email: v("email"), wachtwoord: v("accountww") });
    }
    if (!rollen.length) return status("Vul minimaal één toegangswachtwoord in.", true);
    if (new Set(rollen.map(r => r.toegang)).size !== rollen.length) return status("Gebruik voor elke rol een ander toegangswachtwoord.", true);

    status("Bezig met versleutelen…");
    const salt = willekeurig(16);
    const sleutels = [];
    for (const r of rollen) {
      const basis = await crypto.subtle.importKey("raw", new TextEncoder().encode(r.toegang), "PBKDF2", false, ["deriveKey"]);
      const sleutel = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIES }, basis, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
      const iv = willekeurig(12);
      const platte = new TextEncoder().encode(JSON.stringify({ supabaseUrl, supabaseKey, email: r.email, wachtwoord: r.wachtwoord, rol: r.rol }));
      const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sleutel, platte);
      sleutels.push({ iv: naarB64(iv), data: naarB64(data) });
    }
    // Volgorde husselen, zodat niet te zien is welke regel bij welke rol hoort.
    sleutels.sort(() => Math.random() - 0.5);
    $("#uit").value = JSON.stringify({ versie: 1, kdf: "PBKDF2-SHA256 / AES-GCM-256", iteraties: ITERATIES, salt: naarB64(salt), sleutels }, null, 2) + "\n";
    status("Klaar. Zet dit in js/sleutels.json, commit en push.");
  });

  $("#kopieer").addEventListener("click", async () => {
    if (!$("#uit").value) return;
    await navigator.clipboard.writeText($("#uit").value);
    status("Gekopieerd.");
  });
  $("#download").addEventListener("click", () => {
    if (!$("#uit").value) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([$("#uit").value], { type: "application/json" }));
    a.download = "sleutels.json";
    a.click();
  });
})();
