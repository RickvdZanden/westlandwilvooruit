// Wachtwoordslot van de Trainingsmaker.
//
// In de broncode staat GEEN wachtwoord en GEEN Supabase-adres of -sleutel.
// js/sleutels.json bevat alleen versleutelde gegevens (AES-GCM). De sleutel
// wordt in de browser afgeleid van het ingevoerde wachtwoord (PBKDF2-SHA256).
// Klopt het wachtwoord, dan komen de Supabase-gegevens en het gedeelde account
// vrij en start de app. Nieuwe sleutels maak je met tools/versleutel.html.
(function () {
  const OPSLAG = "tm-ontgrendeld";
  const $ = s => document.querySelector(s);
  const vanB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function leidSleutelAf(wachtwoord, salt, iteraties) {
    const basis = await crypto.subtle.importKey("raw", new TextEncoder().encode(wachtwoord), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: iteraties },
      basis, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
    );
  }

  // Probeert het wachtwoord op elke sleutel (bv. één voor trainers, één voor beheer).
  async function ontsleutel(wachtwoord) {
    const r = await fetch("js/sleutels.json", { cache: "no-store" });
    if (!r.ok) throw new Error("Sleutelbestand niet gevonden.");
    const bestand = await r.json();
    if (!bestand.sleutels || !bestand.sleutels.length) throw new Error("NIET_INGESTELD");
    const sleutel = await leidSleutelAf(wachtwoord, vanB64(bestand.salt), bestand.iteraties);
    for (const s of bestand.sleutels) {
      try {
        const platte = await crypto.subtle.decrypt({ name: "AES-GCM", iv: vanB64(s.iv) }, sleutel, vanB64(s.data));
        return JSON.parse(new TextDecoder().decode(platte));
      } catch (_) { /* niet deze sleutel, volgende proberen */ }
    }
    return null;
  }

  function leesOpgeslagen() {
    try { return JSON.parse(localStorage.getItem(OPSLAG) || "null"); } catch (_) { return null; }
  }

  function toonSlot(melding) {
    $("#slot").hidden = false;
    $("#app").hidden = true;
    const m = $("#slot-melding");
    m.textContent = melding || "";
    m.hidden = !melding;
    // Op telefoons niet meteen het toetsenbord openen, alleen bij een melding.
    if (melding || matchMedia("(min-width: 860px)").matches) $("#slot-wachtwoord").focus();
  }

  function start(cfg) {
    $("#slot").hidden = true;
    window.TM_START(cfg);
  }

  // Wordt door app.js aangeroepen bij vergrendelen of als het account niet meer werkt.
  window.TM_VERGRENDEL = function (melding) {
    try { localStorage.removeItem(OPSLAG); } catch (_) {}
    toonSlot(melding);
  };

  $("#slot-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const veld = $("#slot-wachtwoord");
    const knop = $("#slot-knop");
    const ww = veld.value;
    if (!ww) { toonSlot("Vul het wachtwoord in."); return; }
    knop.disabled = true; knop.setAttribute("aria-busy", "true");
    veld.removeAttribute("aria-invalid");
    try {
      const cfg = await ontsleutel(ww);
      if (!cfg) {
        veld.setAttribute("aria-invalid", "true");
        veld.select();
        toonSlot("Dat wachtwoord klopt niet.");
        return;
      }
      if ($("#slot-onthoud").checked) {
        try { localStorage.setItem(OPSLAG, JSON.stringify(cfg)); } catch (_) {}
      }
      veld.value = "";
      start(cfg);
    } catch (e) {
      toonSlot(e.message === "NIET_INGESTELD"
        ? "De Trainingsmaker is nog niet ingesteld. Vraag de beheerder om een wachtwoord in te stellen."
        : "Er ging iets mis: " + e.message);
    } finally {
      knop.disabled = false; knop.removeAttribute("aria-busy");
    }
  });

  const opgeslagen = leesOpgeslagen();
  if (opgeslagen) start(opgeslagen); else toonSlot();
})();
