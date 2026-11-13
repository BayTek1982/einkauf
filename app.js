"use strict";
/* Bayazit Einkauf – Einkaufsliste mit Angeboten */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const load = (k, d) => { try{ const v = JSON.parse(localStorage.getItem("einkauf." + k)); return v ?? d; }catch(e){ return d; } };
const save = (k, v) => { try{ localStorage.setItem("einkauf." + k, JSON.stringify(v)); }catch(e){} };
const uid = () => Math.random().toString(36).slice(2, 10);

const TAGE = ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."];
const pad = n => String(n).padStart(2, "0");
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseDay = s => { const [y,m,d] = String(s).split("-").map(Number); return new Date(y, (m||1)-1, d||1); };
const kurz = s => { const d = parseDay(s); return `${TAGE[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth()+1)}.`; };
const datum = s => { const d = parseDay(s); return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${String(d.getFullYear()).slice(2)}`; };
const euro = n => (typeof n === "number" && isFinite(n)) ? n.toFixed(2).replace(".", ",") + " €" : "";
const tageBis = s => Math.round((parseDay(s) - parseDay(isoDay(new Date()))) / 86400000);

let MAERKTE = [], PRODUKTE = [], ANGEBOTE = [], META = {};
let liste = load("liste", []);
if(!Array.isArray(liste)) liste = [];
let meineMaerkte = load("maerkte", null);
let offFilter = load("filter", "liste");
let openProd = null;

/* ---------- Daten laden ---------- */
async function getJSON(url){
  const r = await fetch(url + "?t=" + Date.now(), {cache:"no-store"});
  if(!r.ok) throw new Error(url);
  return r.json();
}
async function init(){
  try{
    const [m, p, a] = await Promise.all([getJSON("data/maerkte.json"), getJSON("data/produkte.json"), getJSON("data/angebote.json")]);
    MAERKTE = Array.isArray(m.maerkte) ? m.maerkte.filter(x => x && x.id && x.name) : [];
    PRODUKTE = Array.isArray(p.produkte) ? p.produkte.filter(x => x && x.id && x.name) : [];
    ANGEBOTE = Array.isArray(a.angebote) ? a.angebote.filter(x => x && x.produkt && x.markt && x.von && x.bis && typeof x.preis === "number") : [];
    META = {stand: a.stand, naechste: a.naechste_suche};
    try{ localStorage.setItem("einkauf.cache", JSON.stringify({m, p, a})); }catch(e){}
  }catch(e){
    const c = load("cache", null);
    if(c){ MAERKTE = c.m.maerkte || []; PRODUKTE = c.p.produkte || []; ANGEBOTE = c.a.angebote || []; META = {stand: c.a.stand, naechste: c.a.naechste_suche, offline: true}; }
  }
  if(!Array.isArray(meineMaerkte)) meineMaerkte = MAERKTE.map(x => x.id);
  renderStand(); renderAll(); checkImport();
}

function renderStand(){
  if(!META.stand){ $("#stand").textContent = "Keine Angebotsdaten erreichbar."; return; }
  const d = new Date(META.stand);
  let t = `Angebote vom ${TAGE[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth()+1)}., ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
  if(META.naechste) t += ` · nächste Suche ${kurz(META.naechste)}`;
  if(META.offline) t += " · offline";
  $("#stand").textContent = t;
}

/* ---------- Hilfen ---------- */
const markt = id => MAERKTE.find(m => m.id === id) || {id, name:id, farbe:"#64748b"};
const produkt = id => PRODUKTE.find(p => p.id === id);
const safeColor = c => /^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : "#64748b";
const safeUrl = u => /^https:\/\//.test(u || "") ? u : null;

function erkenne(text){
  const t = " " + String(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ") + " ";
  let best = null, bestLen = 0;
  for(const p of PRODUKTE){
    for(const w0 of (p.woerter || [p.name.toLowerCase()])){
      const w = String(w0).trim().toLowerCase(); if(!w) continue;
      if(t.includes(" " + w) && w.length > bestLen){ best = p.id; bestLen = w.length; }
    }
  }
  return best;
}
function relevante(pid){
  const heute = isoDay(new Date());
  return ANGEBOTE.filter(o => o.produkt === pid && o.bis >= heute && meineMaerkte.includes(o.markt))
    .sort((a,b) => (a.von <= heute ? 0 : 1) - (b.von <= heute ? 0 : 1) || a.preis - b.preis);
}
function wann(o){
  const heute = isoDay(new Date());
  if(o.von > heute) return {txt:`ab ${kurz(o.von)}`, soon:true};
  const n = tageBis(o.bis);
  if(n === 0) return {txt:"nur noch heute", soon:false};
  if(n === 1) return {txt:"bis morgen", soon:false};
  return {txt:`bis ${kurz(o.bis)}`, soon:false};
}
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 2200); }

/* ---------- Liste ---------- */
function addItem(text, extra = {}){
  text = String(text || "").trim().slice(0, 80);
  if(!text) return;
  if(liste.some(i => !i.done && i.text.toLowerCase() === text.toLowerCase())){ toast("Steht schon auf der Liste"); return; }
  liste.unshift({id: uid(), text, done:false, produkt: erkenne(text), ...extra});
  save("liste", liste); renderAll();
}
function renderListe(){
  const ul = $("#list");
  const offen = liste.filter(i => !i.done), fertig = liste.filter(i => i.done);
  if(!liste.length){
    ul.innerHTML = `<li class="empty" style="display:block"><div class="big">🧺</div>Die Liste ist leer.<br>Tippe oben, was du brauchst, oder scanne einen Barcode.</li>`;
  } else {
    ul.innerHTML = [...offen, ...fertig].map(i => {
      let deal = "";
      if(!i.done && i.produkt){
        const o = relevante(i.produkt)[0];
        if(o){ const w = wann(o); deal = `<span class="deal ${w.soon ? "soon" : ""}">🏷️ ${esc(euro(o.preis))} ${esc(markt(o.markt).name)} · ${esc(w.txt)}</span>`; }
      }
      return `<li class="${i.done ? "done" : ""}" data-id="${esc(i.id)}">
        <button class="chk" data-a="toggle" aria-label="abhaken">${i.done ? "✓" : ""}</button>
        <div class="li-main"><div class="li-name">${esc(i.text)}</div>${deal}</div>
        <button class="del" data-a="del" aria-label="löschen">✕</button></li>`;
    }).join("");
  }
  const act = [];
  if(offen.length) act.push(`<button class="btn" id="btnShare">📤 Liste schicken</button>`);
  if(fertig.length) act.push(`<button class="btn ghost" id="btnClear">🧹 Erledigte löschen (${fertig.length})</button>`);
  $("#listActions").innerHTML = act.join("");
  if($("#btnShare")) $("#btnShare").onclick = shareList;
  if($("#btnClear")) $("#btnClear").onclick = () => { liste = liste.filter(i => !i.done); save("liste", liste); renderAll(); };
  renderSugg();
}
$("#list").addEventListener("click", e => {
  const b = e.target.closest("button[data-a]"); const li = e.target.closest("li[data-id]");
  if(!li) return;
  const it = liste.find(i => i.id === li.dataset.id); if(!it) return;
  if(!b || b.dataset.a === "toggle"){ it.done = !it.done; }
  else if(b.dataset.a === "del"){ liste = liste.filter(i => i !== it); }
  save("liste", liste); renderAll();
});

function renderSugg(){
  const q = $("#newItem").value.trim().toLowerCase();
  const auf = new Set(liste.filter(i => !i.done).map(i => i.produkt).filter(Boolean));
  let vorschl;
  if(q){
    vorschl = PRODUKTE.filter(p => !auf.has(p.id) && (p.name.toLowerCase().includes(q) || (p.woerter||[]).some(w => w.startsWith(q)))).slice(0, 6);
  } else {
    // Ohne Eingabe: Produkte mit aktuellem Angebot, die noch nicht auf der Liste stehen
    vorschl = PRODUKTE.filter(p => !auf.has(p.id) && relevante(p.id).length).slice(0, 6);
  }
  $("#sugg").innerHTML = vorschl.map(p => `<button data-p="${esc(p.id)}">${esc(p.emoji || "")} ${esc(p.name)}${!q && relevante(p.id).length ? " 🏷️" : ""}</button>`).join("");
}
$("#sugg").addEventListener("click", e => {
  const b = e.target.closest("button[data-p]"); if(!b) return;
  const p = produkt(b.dataset.p); if(!p) return;
  addItem(p.name); $("#newItem").value = ""; renderSugg();
});
$("#btnAdd").onclick = () => { addItem($("#newItem").value); $("#newItem").value = ""; $("#newItem").focus(); renderSugg(); };
$("#newItem").addEventListener("keydown", e => { if(e.key === "Enter"){ $("#btnAdd").click(); } });
$("#newItem").addEventListener("input", renderSugg);

/* ---------- Teilen ---------- */
function b64enc(str){ return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64dec(s){ s = s.replace(/-/g, "+").replace(/_/g, "/"); while(s.length % 4) s += "="; return decodeURIComponent(escape(atob(s))); }
async function shareList(){
  const offen = liste.filter(i => !i.done).map(i => i.text);
  const link = location.origin + location.pathname + "#liste=" + b64enc(JSON.stringify(offen));
  const text = "🛒 Einkaufsliste\n" + offen.map(t => "• " + t).join("\n") + "\n\nIn der App übernehmen:\n" + link;
  if(navigator.share){
    try{ await navigator.share({title:"Einkaufsliste", text}); return; }catch(e){ if(e && e.name === "AbortError") return; }
  }
  try{ await navigator.clipboard.writeText(text); toast("Liste kopiert – jetzt z. B. in WhatsApp einfügen"); }
  catch(e){ window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener"); }
}
function checkImport(){
  const m = location.hash.match(/^#liste=([A-Za-z0-9_-]{1,6000})$/);
  if(!m) return;
  let items = [];
  try{ items = JSON.parse(b64dec(m[1])); }catch(e){}
  items = Array.isArray(items) ? items.filter(x => typeof x === "string" && x.trim()).map(x => x.trim().slice(0, 80)).slice(0, 100) : [];
  history.replaceState(null, "", location.pathname);
  if(!items.length) return;
  $("#importBanner").innerHTML = `<div class="banner"><b>📥 Du hast eine Einkaufsliste bekommen</b> (${items.length} Einträge):<div class="note" style="margin:4px 0 10px">${items.slice(0, 8).map(esc).join(", ")}${items.length > 8 ? " …" : ""}</div>
    <div class="row-actions" style="margin:0"><button class="btn" id="impYes">Übernehmen</button><button class="btn ghost" id="impNo">Nein danke</button></div></div>`;
  $("#impYes").onclick = () => {
    let n = 0;
    for(const t of items.reverse()){
      if(!liste.some(i => !i.done && i.text.toLowerCase() === t.toLowerCase())){ liste.unshift({id: uid(), text: t, done:false, produkt: erkenne(t)}); n++; }
    }
    save("liste", liste); $("#importBanner").innerHTML = ""; renderAll(); toast(`${n} Einträge übernommen`);
  };
  $("#impNo").onclick = () => { $("#importBanner").innerHTML = ""; };
}

/* ---------- Angebote ---------- */
function renderAngebote(){
  document.querySelectorAll("#offFilter button").forEach(b => b.classList.toggle("on", b.dataset.f === offFilter));
  const aufListe = new Set(liste.filter(i => !i.done).map(i => i.produkt).filter(Boolean));
  let prods = PRODUKTE.filter(p => relevante(p.id).length);
  if(offFilter === "liste") prods = prods.filter(p => aufListe.has(p.id));
  const heute = isoDay(new Date());
  const jetzt = prods.filter(p => relevante(p.id).some(o => o.von <= heute));
  const bald = prods.filter(p => !jetzt.includes(p));
  const card = p => {
    const offs = relevante(p.id); const min = Math.min(...offs.map(o => o.preis));
    return `<div class="card"><h3><span class="em">${esc(p.emoji || "")}</span>${esc(p.name)}${aufListe.has(p.id) ? '<span class="onlist">AUF DER LISTE</span>' : ""}</h3>
      ${offs.map(o => { const w = wann(o); const m = markt(o.markt); const q = safeUrl(o.quelle);
        return `<div class="off ${o.preis === min && offs.length > 1 ? "best" : ""}">
          <span class="mk" style="background:${safeColor(m.farbe)}">${esc(m.name)}</span>
          <div class="off-main">${esc(o.artikel)}${o.menge ? ` <span class="note">· ${esc(o.menge)}</span>` : ""}
            <div class="when ${w.soon ? "soon" : ""}">${esc(w.txt)}${o.hinweis ? " · " + esc(o.hinweis) : ""}${q ? ` · <a href="${esc(q)}" target="_blank" rel="noopener">Quelle</a>` : ""}</div></div>
          <div class="price">${esc(euro(o.preis))}${o.statt ? `<s>${esc(euro(o.statt))}</s>` : ""}</div></div>`; }).join("")}
    </div>`;
  };
  let html = "";
  if(jetzt.length) html += `<div class="sec-title">Jetzt im Angebot</div>` + jetzt.map(card).join("");
  if(bald.length) html += `<div class="sec-title">Demnächst</div>` + bald.map(card).join("");
  if(!html){
    html = offFilter === "liste"
      ? `<div class="empty"><div class="big">🔎</div>Für deine Liste gibt es gerade keine Angebote.<br><br><button class="btn ghost small" id="showAll">Alle Angebote zeigen</button></div>`
      : `<div class="empty"><div class="big">🔎</div>Gerade keine Angebote gefunden.</div>`;
  }
  $("#offers").innerHTML = html;
  if($("#showAll")) $("#showAll").onclick = () => { offFilter = "alle"; save("filter", offFilter); renderAngebote(); };
  // Zähler in der Navigation: Angebote für Dinge auf der Liste
  const n = PRODUKTE.filter(p => aufListe.has(p.id) && relevante(p.id).length).length;
  if(n) $("#dealBadge").dataset.n = n; else delete $("#dealBadge").dataset.n;
}
$("#offFilter").addEventListener("click", e => {
  const b = e.target.closest("button[data-f]"); if(!b) return;
  offFilter = b.dataset.f; save("filter", offFilter); renderAngebote();
});

/* ---------- Verlauf / Produkte ---------- */
function rhythmus(pid){
  const alle = ANGEBOTE.filter(o => o.produkt === pid && meineMaerkte.includes(o.markt));
  // Wochen mit Angebot (Montag der Startwoche)
  const wochen = [...new Set(alle.map(o => { const d = parseDay(o.von); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); }))].sort();
  if(wochen.length < 3) return null;
  const abst = []; for(let i = 1; i < wochen.length; i++) abst.push((parseDay(wochen[i]) - parseDay(wochen[i-1])) / 86400000);
  abst.sort((a,b) => a-b);
  const median = abst[Math.floor(abst.length / 2)];
  const w = Math.max(1, Math.round(median / 7));
  const naechste = parseDay(wochen[wochen.length - 1]); naechste.setDate(naechste.getDate() + w * 7);
  return {wochen: w, naechste: isoDay(naechste)};
}
function renderProdukte(){
  const heute = isoDay(new Date());
  $("#products").innerHTML = PRODUKTE.map(p => {
    const hist = ANGEBOTE.filter(o => o.produkt === p.id && meineMaerkte.includes(o.markt)).sort((a,b) => b.von.localeCompare(a.von));
    const akt = relevante(p.id)[0];
    const letzt = hist.find(o => o.bis < heute);
    let sub;
    if(akt){ const w = wann(akt); sub = `🏷️ ${euro(akt.preis)} bei ${markt(akt.markt).name} · ${w.txt}`; }
    else if(letzt){ sub = `Zuletzt im Angebot: ${datum(letzt.von)}`; }
    else sub = "Noch kein Angebot gefunden";
    let det = "";
    if(openProd === p.id){
      const r = rhythmus(p.id);
      const tief = hist.length ? hist.reduce((a,b) => a.preis <= b.preis ? a : b) : null;
      det = `<div class="detail"><div class="facts">
        <div class="fact"><span class="k">Letztes Angebot</span><span>${letzt ? `${esc(datum(letzt.von))} · ${esc(markt(letzt.markt).name)} · ${esc(euro(letzt.preis))}` : "–"}</span></div>
        <div class="fact"><span class="k">${akt && akt.von <= heute ? "Jetzt im Angebot" : "Nächstes Angebot"}</span><span>${akt ?`<b>${esc(wann(akt).txt)}</b> · ${esc(markt(akt.markt).name)}` : r ? `etwa ab ${esc(kurz(r.naechste))} (geschätzt)` : "noch unbekannt"}</span></div>
        <div class="fact"><span class="k">Rhythmus</span><span>${r ? `meist etwa alle ${r.wochen} Woche${r.wochen > 1 ? "n" : ""} im Angebot` : "Noch zu wenig Daten. Wird jede Woche genauer."}</span></div>
        ${tief ? `<div class="fact"><span class="k">Bester Preis bisher</span><span>${esc(euro(tief.preis))} · ${esc(tief.artikel)} (${esc(markt(tief.markt).name)})</span></div>` : ""}
      </div>
      ${hist.length ? `<table>${hist.slice(0, 25).map(o => `<tr><td>${esc(datum(o.von))}</td><td>${esc(markt(o.markt).name)}<br><span class="note">${esc(o.artikel)}${o.menge ? " · " + esc(o.menge) : ""}</span></td><td class="r">${esc(euro(o.preis))}</td></tr>`).join("")}</table>` : ""}
      </div>`;
    }
    return `<div class="card" data-p="${esc(p.id)}"><div class="prod"><span class="em">${esc(p.emoji || "")}</span>
      <div class="pm"><b>${esc(p.name)}</b><span>${esc(sub)}</span></div><span class="arr">${openProd === p.id ? "▲" : "▼"}</span></div>${det}</div>`;
  }).join("");
}
$("#products").addEventListener("click", e => {
  if(e.target.closest("a")) return;
  const c = e.target.closest(".card[data-p]"); if(!c) return;
  openProd = openProd === c.dataset.p ? null : c.dataset.p; renderProdukte();
});

/* ---------- Märkte ---------- */
function renderMaerkte(){
  $("#mkSet").innerHTML = MAERKTE.map(m => `<label><input type="checkbox" value="${esc(m.id)}" ${meineMaerkte.includes(m.id) ? "checked" : ""}>${esc(m.name)}</label>`).join("");
}
$("#mkSet").addEventListener("change", () => {
  meineMaerkte = [...document.querySelectorAll("#mkSet input:checked")].map(i => i.value);
  save("maerkte", meineMaerkte); renderListe(); renderAngebote(); renderProdukte();
});

/* ---------- Navigation ---------- */
function show(v){
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  window.scrollTo({top:0});
}
document.querySelector("nav").addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if(b) show(b.dataset.v); });
function renderAll(){ renderListe(); renderAngebote(); renderProdukte(); renderMaerkte(); }

/* ---------- Scanner ---------- */
let scanner = null, scanning = false, busy = false;
async function startScan(){
  $("#scanSheet").classList.add("on");
  if(typeof Html5Qrcode === "undefined"){ $("#scanMsg").textContent = "Scanner konnte nicht geladen werden. Bitte den Namen eintippen."; return; }
  $("#scanMsg").textContent = "Halte den Barcode in den Rahmen …";
  const F = Html5QrcodeSupportedFormats;
  scanner = scanner || new Html5Qrcode("reader", {formatsToSupport:[F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E], verbose:false, experimentalFeatures:{useBarCodeDetectorIfSupported:true}});
  try{
    await scanner.start({facingMode:"environment"}, {fps:10, qrbox:{width:260, height:140}}, onCode);
    scanning = true;
  }catch(e){
    $("#scanMsg").textContent = "Kein Kamerazugriff. Bitte die Kamera erlauben oder den Namen eintippen.";
  }
}
async function stopScan(){
  try{ if(scanner && scanning) await scanner.stop(); }catch(e){}
  scanning = false; $("#scanSheet").classList.remove("on");
}
async function onCode(code){
  if(busy) return; busy = true;
  code = String(code).replace(/\D/g, "");
  await stopScan();
  if(code.length < 8 || code.length > 14){ busy = false; toast("Barcode nicht erkannt"); return; }
  toast("Suche Produkt …");
  let name = "";
  try{
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name_de,product_name,brands,quantity`);
    const j = await r.json();
    if(j && j.status === 1 && j.product){
      const pr = j.product;
      const marke = String(pr.brands || "").split(",")[0].trim();
      const n = String(pr.product_name_de || pr.product_name || "").trim();
      name = [marke && !n.toLowerCase().includes(marke.toLowerCase()) ? marke : "", n, pr.quantity ? String(pr.quantity).trim() : ""].filter(Boolean).join(" ");
    }
  }catch(e){}
  busy = false;
  if(name){ addItem(name, {code}); toast("✓ " + name.slice(0, 40)); }
  else{
    $("#newItem").value = ""; $("#newItem").placeholder = "Produkt nicht gefunden – Namen eintippen"; $("#newItem").focus();
    toast("Produkt nicht in der Datenbank – bitte Namen eintippen");
  }
}
$("#btnScan").onclick = startScan;
$("#btnScanClose").onclick = stopScan;

init();
