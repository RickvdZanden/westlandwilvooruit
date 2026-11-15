// Pdf in de huisstijl: kopbalk met logo, voettekst met clubadres.
// Alles gebeurt in de browser; er wordt niets verstuurd.
window.TB_PDF = (function () {
  const RULES = [
    "Houd ruime afstand tussen de renners/rensters.",
    "Geen lichamelijk contact (duwen, wielcontact). Inhalen mag overal.",
    "Bij gevaar of duwen direct neutraliseren.",
    "Niemand blijft stilstaan op een klim of in een bocht.",
    "Plezier en spel staan centraal. Sluit af met een kort evaluatiemoment."
  ];
  const BETWEEN = "Tussen de kernen: 1 ronde rustig uitrijden over het dernyrondje.";
  const ADRES = "Westland Wil Vooruit · Broekpolderlaan 14 · 2675 LJ Honselersdijk";

  // t: {datum, groepen, thema, succes, niet, warm, kernen[], header:{data,w,h}}
  // kern: {titel, groepen, duur, uitleg[], intensiteit, differentiatie[], doel[], materiaal, coach, img?:{data,w,h,fmt}, video?}
  // cool: null (trainerskeuze) of {titel, uitleg[], duur, coach}
  function make(t) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210, M = 15, BLUE = [0, 85, 160], GRAY = [110, 120, 130], INK = [30, 40, 50], TOP = 30, BOT = 282;
    let y = TOP;
    const need = h => { if (y + h > BOT) { doc.addPage(); y = TOP; } };
    // need(26): een kop blijft altijd bij minstens een paar regels inhoud (geen losse kop onderaan een pagina)
    const head = s => { need(26); doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...BLUE); doc.text(s, M, y + 5); y += 11; };
    const sub = s => { need(8); doc.setFont("helvetica", "bolditalic"); doc.setFontSize(10); doc.setTextColor(...BLUE); doc.text(s, M, y + 4); y += 6; };
    const para = (s, o = {}) => {
      doc.setFont("helvetica", o.italic ? "italic" : "normal"); doc.setFontSize(10); doc.setTextColor(...(o.color || INK));
      doc.splitTextToSize(s || "-", W - 2 * M).forEach(l => { need(5); doc.text(l, M, y + 4); y += 5; });
      y += o.gap ?? 1.5;
    };
    const bullets = (arr, numbered) => arr.forEach((s, i) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...INK);
      doc.splitTextToSize(s, W - 2 * M - 7).forEach((l, j) => { need(5); if (j === 0) doc.text(numbered ? (i + 1) + "." : "-", M + 1, y + 4); doc.text(l, M + 7, y + 4); y += 5; });
    });
    const table = rows => {
      doc.autoTable({
        startY: y, margin: { top: TOP - 2, bottom: 20, left: M, right: M }, theme: "grid", body: rows,
        styles: { font: "helvetica", fontSize: 9.5, cellPadding: 2.6, lineColor: [205, 212, 220], lineWidth: .2, textColor: INK, valign: "top" },
        columnStyles: { 0: { cellWidth: 38, fontStyle: "italic", textColor: BLUE }, 1: { cellWidth: W - 2 * M - 38 } }
      });
      y = doc.lastAutoTable.finalY + 6;
    };
    const image = img => {
      const maxW = 120, maxH = 110;
      let w = maxW, h = w * img.h / img.w;
      if (h > maxH) { h = maxH; w = h * img.w / img.h; }
      need(h + 4); doc.addImage(img.data, img.fmt || "PNG", (W - w) / 2, y, w, h); y += h + 4;
    };
    const cap = s => s.replace(/^de renner\/renster/, "De renner/renster");

    head("INLEIDING");
    table([["Datum + tijd", t.datum || "-"], ["Categorieën / niveau", t.groepen], ["Thema", t.thema || "-"]]);

    head("DOEL VAN TRAINING");
    sub("Aan het einde kan/laat de renner/renster zien dat");
    const doelen = [];
    t.kernen.forEach(k => k.doel.forEach(d => { if (!doelen.includes(d)) doelen.push(d); }));
    bullets((doelen.length ? doelen : ["de renner/renster de oefeningen veilig en netjes uitvoert."]).slice(0, 6).map(cap));
    y += 2; sub("Succescriteria"); para(t.succes);
    sub("Wat je níet nastreeft vandaag"); para(t.niet);

    const wu = t.warm;
    head("WARMING-UP: " + wu.titel.toUpperCase());
    table([["Uitleg", wu.uitleg.join("\n\n")], ["Duur/herhaling", wu.duur || "Ca. 10 min"], ["Intensiteit", wu.intensiteit || "Rustig, opbouwend."]]);
    if (wu.coach) { sub("Waar coach je op?"); para(wu.coach); }

    t.kernen.forEach((k, i) => {
      need(30); para(BETWEEN, { italic: true, color: GRAY, gap: 2 });
      head("KERN " + (i + 1) + (k.groepen ? " (" + k.groepen.toUpperCase() + ")" : "") + ": " + k.titel.toUpperCase());
      table([
        ["Uitleg", k.uitleg.join("\n\n")],
        ["Duur/herhaling", k.duur || "-"],
        ["Intensiteit", k.intensiteit || "Naar keuze van de trainer."],
        ["Differentiatie\n(makkelijker / moeilijker / extra opdracht)", (k.differentiatie.length ? k.differentiatie : ["Naar keuze van de trainer."]).join("\n")]
      ]);
      if (k.img) image(k.img);
      if (k.doel.length) { sub("Doel van deze kern"); para("Aan het einde van deze kern kan/laat de renner/renster zien dat…", { gap: .5 }); bullets(k.doel, true); y += 2; }
      sub("Wat heb je nodig?"); para(k.materiaal || "Naar keuze van de trainer.");
      sub("Waar moet je op letten?"); para(k.coach || "Veiligheid, afstand houden en plezier.");
      if (k.video) { sub("Filmpje"); para(k.video, { color: GRAY }); }
    });

    if (t.cool) {
      head("COOLING-DOWN: " + t.cool.titel.toUpperCase());
      table([["Uitleg", t.cool.uitleg.join("\n\n")], ["Duur/herhaling", t.cool.duur || "Ca. 10 min"]]);
      if (t.cool.coach) { sub("Waar moet je op letten?"); para(t.cool.coach); }
    } else { head("COOLING-DOWN"); para("Trainerskeuze."); }
    head("TRAININGSREGELS"); bullets(RULES); y += 3;
    head("WAT IS ER NODIG VOOR DEZE TRAINING?");
    const mat = [];
    t.kernen.forEach(k => { if (k.materiaal && !mat.includes(k.materiaal)) mat.push(k.materiaal); });
    bullets(mat.length ? mat : ["Pionnen."]);

    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p);
      if (t.header) doc.addImage(t.header.data, "PNG", 0, 0, W, W * t.header.h / t.header.w);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(150, 155, 160);
      doc.text(ADRES, W / 2, 290, { align: "center" });
      doc.text(p + " / " + n, W - M, 290, { align: "right" });
    }
    return doc;
  }
  return { make, RULES };
})();
