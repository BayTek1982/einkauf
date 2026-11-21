"use strict";
/* Bayazit Einkauf – Einkaufsliste mit Angeboten */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const load = (k, d) => { try{ const v = JSON.parse(localStorage.getItem("einkauf." + k)); return v ?? d; }catch(e){ return d; } };
const save = (k, v) => { try{ localStorage.setItem("einkauf." + k, JSON.stringify(v)); }catch(e){} };
const uid = () => Math.random().toString(36).slice(2, 10);

const TAGE = ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."];
const EINHEITEN = ["Stück", "Pack", "g", "kg", "l"];
const pad = n => String(n).padStart(2, "0");
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseDay = s => { const [y,m,d] = String(s).split("-").map(Number); return new Date(y, (m||1)-1, d||1); };
const kurz = s => { const d = parseDay(s); return `${TAGE[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth()+1)}.`; };
const datum = s => { const d = parseDay(s); return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${String(d.getFullYear()).slice(2)}`; };
const euro = n => (typeof n === "number" && isFinite(n)) ? n.toFixed(2).replace(".", ",") + " €" : "";
// Preis pro kg bzw. Liter: aus "grundpreis" oder aus "menge" (z. B. "500 g", "10 x 0,2 l") berechnet
function grundpreis(o){
  if(o.grundpreis) return String(o.grundpreis);
  if(typeof o.preis !== "number" || !o.menge) return "";
  const t = String(o.menge).toLowerCase().replace(/,/g, ".");
  const r = t.match(/^(?:(?:kasten\s+)?(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|ml|l)$/);
  if(!r) return "";
  const anz = r[1] ? Number(r[1]) : 1; let w = Number(r[2]) * anz; const e = r[3];
  if(!(w > 0)) return "";
  if(e === "g" || e === "ml") w /= 1000;
  return euro(o.preis / w) + (e === "g" || e === "kg" ? "/kg" : "/l");
}
const heute = () => isoDay(new Date());
const tageBis = s => Math.round((parseDay(s) - parseDay(heute())) / 86400000);

let MAERKTE = [], PRODUKTE = [], KATS = [], ANGEBOTE = [], META = {};
let liste = load("liste", []);
if(!Array.isArray(liste)) liste = [];
let meineMaerkte = load("maerkte", null);
let offFilter = load("filter", "liste");
let openProd = null, editId = null;
let offSort = load("sort", "produkt"), offMarkt = load("omarkt", "alle");
let sucheA = "", sucheV = "";

const WUNSCH_URL = "https://ntfy.sh/kompassapps-einkauf-38fb2649f869a822";
let WUENSCHE = [];
const FALLBACK_KAT = {id:"sonst", name:"Sonstiges", emoji:"🛍️", farbe:"#f3f4f6"};

/* ---------- Daten laden ---------- */
async function getJSON(url){
  const r = await fetch(url + "?t=" + Date.now(), {cache:"no-store"});
  if(!r.ok) throw new Error(url);
  return r.json();
}
function setData(m, p, a){
  MAERKTE = Array.isArray(m.maerkte) ? m.maerkte.filter(x => x && x.id && x.name) : [];
  PRODUKTE = Array.isArray(p.produkte) ? p.produkte.filter(x => x && x.id && x.name) : [];
  KATS = Array.isArray(p.kategorien) && p.kategorien.length ? p.kategorien.filter(x => x && x.id && x.name) : [FALLBACK_KAT];
  if(!KATS.some(k => k.id === "sonst")) KATS.push(FALLBACK_KAT);
  ANGEBOTE = Array.isArray(a.angebote) ? a.angebote.filter(x => x && x.produkt && x.markt && x.von && x.bis && typeof x.preis === "number") : [];
}
async function init(){
  try{
    const [m, p, a] = await Promise.all([getJSON("data/maerkte.json"), getJSON("data/produkte.json"), getJSON("data/angebote.json")]);
    try{ const w = await getJSON("data/wuensche.json"); WUENSCHE = Array.isArray(w.wuensche) ? w.wuensche : []; }catch(e){}
    setData(m, p, a); META = {stand: a.stand, naechste: a.naechste_suche};
    try{ localStorage.setItem("einkauf.cache", JSON.stringify({m, p, a})); }catch(e){}
  }catch(e){
    const c = load("cache", null);
    if(c){ setData(c.m, c.p, c.a); META = {stand: c.a.stand, naechste: c.a.naechste_suche, offline: true}; }
  }
  if(!Array.isArray(meineMaerkte)) meineMaerkte = MAERKTE.map(x => x.id);
  // ältere Einträge nachträglich erkennen
  liste.forEach(i => { if(!i.produktFest) i.produkt = erkenne(i.text + " " + (i.marke || ""), i.code, i.code && !i.katManuell ? i.kat : null); });
  save("liste", liste);
  renderStand(); renderAll(); checkImport(); nachladen(); offeneWuenscheNachsenden();
}
// Gescannte Einträge ohne Foto (z. B. aus der ersten Version) nachträglich ergänzen
async function nachladen(){
  const offen = liste.filter(i => i.code && ((!i.bild && !i.geprueft) || !i.katV3));
  const infos = {};
  for(let n = 0; n < offen.length; n += 6){
    const teil = offen.slice(n, n + 6);
    const res = await Promise.all(teil.map(i => offLaden(i.code)));
    teil.forEach((i, k) => infos[i.id] = res[k]);
  }
  for(const it of offen){
    it.geprueft = true; it.katV3 = true;
    const info = infos[it.id];
    if(!info) continue;
    const marke = String(info.brands || "").split(",")[0].trim().slice(0, 60);
    if(!it.marke && marke){
      it.marke = marke;
      if(it.text.toLowerCase().startsWith(marke.toLowerCase())) it.text = it.text.slice(marke.length).trim() || it.text;
    }
    const inhalt = String(info.quantity || "").trim();
    if(inhalt && !it.inhalt){ it.inhalt = inhalt.slice(0, 30); if(it.text.toLowerCase().includes(inhalt.toLowerCase())) it.text = it.text.replace(inhalt, "").trim() || it.text; }
    if(!it.bild) it.bild = safeImg(info.image_front_small_url) || "";
    if(!it.katManuell){ const k = katAusOFF(info.categories_tags); if(k) it.kat = k; else delete it.kat; }
    if(!it.produktFest) it.produkt = erkenne(it.text + " " + (it.marke || ""), it.code, it.katManuell ? null : (it.kat || null));
    }
  if(offen.length){ save("liste", liste); renderAll(); offeneWuenscheNachsenden(); }
}
async function offLaden(code){
  try{
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name_de,product_name,generic_name_de,brands,quantity,image_front_small_url,categories_tags`);
    const j = await r.json();
    return (j && j.status === 1 && j.product) ? j.product : null;
  }catch(e){ return null; }
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
const kat = id => KATS.find(k => k.id === id) || KATS.find(k => k.id === "sonst") || FALLBACK_KAT;
const safeColor = c => /^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : "#64748b";
const safeUrl = u => /^https:\/\//.test(u || "") ? u : null;
const safeImg = u => (typeof u === "string" && /^https:\/\/(images|static)\.openfoodfacts\.org\//.test(u)) ? u : null;
const itemKat = i => (i.katManuell && i.kat) || (i.produkt && produkt(i.produkt) && produkt(i.produkt).kategorie) || i.kat || "sonst";

function tile(i){
  const k = kat(itemKat(i)); const p = i.produkt ? produkt(i.produkt) : null;
  const img = safeImg(i.bild);
  if(img) return `<span class="tile" style="background:#fff"><img src="${esc(img)}" alt="" loading="lazy"></span>`;
  return `<span class="tile" style="background:${safeColor(k.farbe)}">${esc((p && p.emoji) || k.emoji || "🛍️")}</span>`;
}
function prodTile(p){
  const k = kat(p.kategorie);
  return `<span class="tile" style="background:${safeColor(k.farbe)}">${esc(p.emoji || k.emoji)}</span>`;
}
function mengeText(i){
  const m = Number(i.menge) || 1;
  if(i.einheit) return `${String(m).replace(".", ",")} ${i.einheit}`;
  return m > 1 ? `${m}×` : "";
}
function erkenne(text, code, katHinweis){
  if(code){ const pc = PRODUKTE.find(p => Array.isArray(p.codes) && p.codes.includes(String(code))); if(pc) return pc.id; }
  const t = " " + String(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim() + " ";
  const woerter = t.trim().split(" ");
  let best = null, bestLen = 0;
  for(const p of PRODUKTE){
    // Bei gescannten Produkten passt nur ein Produkt aus demselben Bereich (Schoko-Banane ist kein Obst)
    if(katHinweis && p.kategorie && p.kategorie !== katHinweis) continue;
    for(const w0 of [p.name.toLowerCase(), ...(p.woerter || [])]){
      const w = String(w0).trim().toLowerCase(); if(!w) continue;
      let treffer;
      if(w.includes(" ")) treffer = t.includes(" " + w + " ");
      // Ganzes Wort, oder Ende eines zusammengesetzten Worts: „Alpenmilch“ = Milch, aber „Apfel-Zimt-Müsli“ ≠ Apfel
      else treffer = woerter.some(x => x === w || (w.length >= 4 && x.endsWith(w) && !x.endsWith("-" + w) ));
      if(treffer && w.length > bestLen){ best = p.id; bestLen = w.length; }
    }
  }
  return best;
}
function relevante(pid){
  const h = heute();
  return ANGEBOTE.filter(o => o.produkt === pid && o.bis >= h && meineMaerkte.includes(o.markt))
    .sort((a,b) => (a.von <= h ? 0 : 1) - (b.von <= h ? 0 : 1) || a.preis - b.preis);
}
function wann(o){
  if(o.von > heute()) return {txt:`ab ${kurz(o.von)}`, soon:true};
  const n = tageBis(o.bis);
  if(n === 0) return {txt:"nur noch heute", soon:false};
  if(n === 1) return {txt:"bis morgen", soon:false};
  return {txt:`bis ${kurz(o.bis)}`, soon:false};
}
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").trim();
const prodPasst = (p, q) => !q || [p.name, ...(p.woerter || [])].some(w => norm(w).includes(q));
const offPasst = (o, q) => !q || norm(titel(o)).includes(q);
const titel = o => (o.marke ? o.marke + " " : "") + o.artikel;
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 2300); }

/* ---------- Liste ---------- */
function addItem(text, extra = {}){
  text = String(text || "").trim().slice(0, 80);
  if(!text) return null;
  const dup = liste.find(i => !i.done && i.text.toLowerCase() === text.toLowerCase() && (i.marke || "") === (extra.marke || ""));
  if(dup){ dup.menge = (Number(dup.menge) || 1) + 1; save("liste", liste); renderAll(); toast(`${text}: jetzt ${mengeText(dup) || "2×"}`); return dup; }
  const it = {id: uid(), text, done:false, menge:1, einheit:"", marke:"", notiz:"", produkt: erkenne(text + " " + (extra.marke || ""), extra.code, extra.code ? extra.kat : null), ...extra};
  if(extra.produkt) it.produktFest = true;
  delete it.suche;
  liste.unshift(it);
  save("liste", liste); renderAll();
  if(!it.produkt) wunschSenden(it);
  return it;
}
function itemRow(i){
  let deal = "";
  if(!i.done && i.produkt){
    const o = relevante(i.produkt)[0];
    if(o){ const w = wann(o); deal = `<span class="deal ${w.soon ? "soon" : ""}">🏷️ ${esc(euro(o.preis))} · ${esc(markt(o.markt).name)} · ${esc(w.txt)}</span>`; }
  }
  if(!i.done && !i.produkt){
    const st = wunschStatus(i);
    if(st === "offen" || st === "gesendet") deal = `<span class="deal soon">🔎 Angebote werden gesucht …</span>`;
    else if(st === "erledigt") deal = `<span class="deal" style="background:var(--bg); color:var(--muted)">🔎 gerade kein Angebot – wird weiter beobachtet</span>`;
  }
  const sub = [];
  if(i.marke) sub.push(`<span class="brand">${esc(i.marke)}</span>`);
  if(i.inhalt) sub.push(esc(i.inhalt));
  if(i.notiz) sub.push("📝 " + esc(i.notiz));
  const mt = mengeText(i);
  return `<li class="${i.done ? "done" : ""}" data-id="${esc(i.id)}">
    <button class="chk" data-a="toggle" aria-label="abhaken">${i.done ? "✓" : ""}</button>
    ${tile(i)}
    <div class="li-main"><div class="li-name">${mt ? `<span class="qty">${esc(mt)}</span>` : ""}${esc(i.text)}</div>
      ${sub.length ? `<div class="li-sub">${sub.join(" · ")}</div>` : ""}${deal}</div>
    <span class="go">›</span></li>`;
}
function renderListe(){
  const offen = liste.filter(i => !i.done), fertig = liste.filter(i => i.done);
  let html = "";
  if(!liste.length){
    html = `<div class="card empty" style="margin-top:14px"><div class="big">🧺</div>Die Liste ist leer.<br>Tippe oben, was ihr braucht, oder scanne einen Barcode.</div>`;
  } else {
    // nach Bereichen im Laden sortiert
    for(const k of KATS){
      const items = offen.filter(i => itemKat(i) === k.id);
      if(!items.length) continue;
      html += `<div class="grp"><div class="grp-h">${esc(k.emoji)} ${esc(k.name)}<span class="n">${items.length}</span></div><ul class="list">${items.map(itemRow).join("")}</ul></div>`;
    }
    const rest = offen.filter(i => !KATS.some(k => k.id === itemKat(i)));
    if(rest.length) html += `<div class="grp"><ul class="list">${rest.map(itemRow).join("")}</ul></div>`;
    if(fertig.length) html += `<div class="grp"><div class="grp-h">✅ Im Wagen<span class="n">${fertig.length}</span></div><ul class="list">${fertig.map(itemRow).join("")}</ul></div>`;
  }
  $("#list").innerHTML = html;
  const act = [];
  if(offen.length) act.push(`<button class="btn" id="btnShare">📤 Liste schicken</button>`);
  if(fertig.length) act.push(`<button class="btn ghost" id="btnClear">🧹 Erledigte löschen</button>`);
  $("#listActions").innerHTML = act.join("");
  if($("#btnShare")) $("#btnShare").onclick = shareList;
  if($("#btnClear")) $("#btnClear").onclick = () => { liste = liste.filter(i => !i.done); save("liste", liste); renderAll(); };
  renderSugg(); renderStats();
}
$("#list").addEventListener("click", e => {
  const li = e.target.closest("li[data-id]"); if(!li) return;
  const it = liste.find(i => i.id === li.dataset.id); if(!it) return;
  if(e.target.closest("button[data-a=toggle]")){
    it.done = !it.done; save("liste", liste); renderAll();
    if(it.done && navigator.vibrate) navigator.vibrate(15);
  } else openEdit(it.id);
});

function renderStats(){
  const offen = liste.filter(i => !i.done);
  const mitDeal = offen.filter(i => i.produkt && relevante(i.produkt).length);
  let spar = 0;
  for(const i of mitDeal){ const o = relevante(i.produkt)[0]; if(o && typeof o.statt === "number" && o.statt > o.preis) spar += (o.statt - o.preis) * (i.einheit ? 1 : (Number(i.menge) || 1)); }
  const s = [`<span class="stat">🧺 <b>${offen.length}</b> auf der Liste</span>`];
  if(mitDeal.length) s.push(`<span class="stat">🏷️ <b>${mitDeal.length}</b> im Angebot</span>`);
  if(spar >= 0.5) s.push(`<span class="stat">💰 bis <b>${esc(euro(spar))}</b> sparen</span>`);
  $("#stats").innerHTML = s.join("");
}

function renderSugg(){
  const q = $("#newItem").value.trim().toLowerCase();
  const auf = new Set(liste.filter(i => !i.done).map(i => i.produkt).filter(Boolean));
  let vorschl;
  if(q) vorschl = PRODUKTE.filter(p => !auf.has(p.id) && (p.name.toLowerCase().includes(q) || (p.woerter||[]).some(w => w.startsWith(q)))).slice(0, 8);
  else vorschl = PRODUKTE.filter(p => !auf.has(p.id) && relevante(p.id).length).slice(0, 10);
  $("#sugg").innerHTML = vorschl.map(p => { const hot = relevante(p.id).length;
    return `<button data-p="${esc(p.id)}" class="${hot ? "hot" : ""}">${esc(p.emoji || "")} ${esc(p.name)}${hot ? " 🏷️" : ""}</button>`; }).join("");
}
$("#sugg").addEventListener("click", e => {
  const b = e.target.closest("button[data-p]"); if(!b) return;
  const p = produkt(b.dataset.p); if(!p) return;
  addItem(p.name, {produkt: p.id}); $("#newItem").value = ""; renderSugg(); toast(`✓ ${p.name}`);
});
$("#btnAdd").onclick = () => { addItem($("#newItem").value); $("#newItem").value = ""; $("#newItem").placeholder = "Was brauchst du?"; $("#newItem").focus(); renderSugg(); };
$("#newItem").addEventListener("keydown", e => { if(e.key === "Enter") $("#btnAdd").click(); });
$("#newItem").addEventListener("input", renderSugg);

/* ---------- Angebotssuche für neue Produkte anfragen ---------- */
function wunschStatus(it){
  const t = it.text.toLowerCase();
  const w = WUENSCHE.filter(x => (x.text || "").toLowerCase() === t || (it.code && x.code === it.code)).pop();
  if(w) return w.status || "offen";
  return it.angefragt ? "gesendet" : null;
}
async function wunschSenden(it, nochmal){
  const gesendet = load("gesendet", {});
  const key = it.text.toLowerCase() + "|" + (it.code || "");
  if(gesendet[key] && !nochmal){ it.angefragt = true; save("liste", liste); return; }
  try{
    await fetch(WUNSCH_URL, {method:"POST", body: JSON.stringify({t: it.text, b: it.marke || "", c: it.code || ""})});
    gesendet[key] = Date.now(); save("gesendet", gesendet);
    it.angefragt = true; save("liste", liste); renderListe();
    toast("🔎 Angebotssuche für „" + it.text.slice(0, 30) + "“ angefragt");
  }catch(e){ /* offline – beim nächsten Öffnen erneut */ }
}
function offeneWuenscheNachsenden(){
  liste.filter(i => !i.done && !i.produkt && !i.angefragt).slice(0, 40).forEach(i => wunschSenden(i));
}

/* ---------- Eintrag bearbeiten ---------- */
function openEdit(id){
  editId = id; renderEdit(); $("#editSheet").classList.add("on");
}
function closeEdit(){
  const it = liste.find(i => i.id === editId);
  if(it){
    const n = $("#edName"); if(n && n.value.trim()) it.text = n.value.trim().slice(0, 80);
    it.marke = ($("#edMarke")?.value || "").trim().slice(0, 60);
    it.notiz = ($("#edNotiz")?.value || "").trim().slice(0, 200);
    if(!it.produktFest) it.produkt = erkenne(it.text + " " + (it.marke || ""), it.code, it.code && !it.katManuell ? it.kat : null) || null;
    if(!it.produkt && !it.angefragt) setTimeout(() => wunschSenden(it), 0);
    save("liste", liste);
  }
  editId = null; $("#editSheet").classList.remove("on"); renderAll();
}
function renderEdit(){
  const it = liste.find(i => i.id === editId); if(!it){ $("#editSheet").classList.remove("on"); return; }
  const offs = it.produkt ? relevante(it.produkt).slice(0, 3) : [];
  const ik = itemKat(it);
  $("#editBox").innerHTML = `<div class="grab"></div>
    <div class="ed-top">${tile(it)}<input id="edName" value="${esc(it.text)}" maxlength="80" aria-label="Name"></div>
    <span class="lbl">Menge</span>
    <div class="stepper"><button data-s="-1" aria-label="weniger">−</button><span class="num" id="edNum">${esc(String(Number(it.menge) || 1).replace(".", ","))}</span><button data-s="1" aria-label="mehr">＋</button></div>
    <div class="units" style="margin-top:8px">${["", ...EINHEITEN].map(u => `<button data-u="${esc(u)}" class="${(it.einheit || "") === u ? "on" : ""}">${u ? esc(u) : "–"}</button>`).join("")}</div>
    <span class="lbl">Marke <span style="text-transform:none; font-weight:500">(leer = egal)</span></span>
    <input class="field" id="edMarke" value="${esc(it.marke || "")}" placeholder="z. B. Weihenstephan" maxlength="60">
    <span class="lbl">Notiz</span>
    <textarea class="field" id="edNotiz" maxlength="200" placeholder="z. B. laktosefrei, für den Kuchen am Sonntag">${esc(it.notiz || "")}</textarea>
    <span class="lbl">Bereich im Laden</span>
    <div class="kats">${KATS.map(k => `<button data-k="${esc(k.id)}" class="${ik === k.id ? "on" : ""}">${esc(k.emoji)} ${esc(k.name)}</button>`).join("")}</div>
    ${!it.produkt ? `<div class="banner" style="border-width:1px; margin-top:14px; font-size:.9rem">🔎 Für „${esc(it.text)}“ ist die Angebotssuche angefragt. Das Ergebnis kommt meist innerhalb von 1–3 Stunden, danach wird es jede Woche automatisch mitgesucht.
      <div style="margin-top:8px"><button class="btn ghost small" id="edWunsch">Nochmal anfragen</button></div></div>` : ""}
    ${offs.length ? `<span class="lbl">🏷️ Angebote dafür</span><div class="ed-deals">${offs.map(offRow).join("")}</div>` : ""}
    ${it.inhalt || it.code ? `<p class="note">${it.inhalt ? "Inhalt: " + esc(it.inhalt) : ""}${it.code ? ` · Barcode ${esc(it.code)}` : ""}</p>` : ""}
    <div class="ed-actions"><button class="btn danger" id="edDel">🗑️ Löschen</button><button class="btn" id="edOk">Fertig</button></div>`;
}
$("#editBox").addEventListener("click", e => {
  const it = liste.find(i => i.id === editId); if(!it) return;
  const s = e.target.closest("button[data-s]"), u = e.target.closest("button[data-u]"), k = e.target.closest("button[data-k]");
  if(s){
    const step = ["g"].includes(it.einheit) ? 100 : (["kg", "l"].includes(it.einheit) ? 0.5 : 1);
    it.menge = Math.max(step, Math.round(((Number(it.menge) || 1) + step * Number(s.dataset.s)) * 10) / 10);
    $("#edNum").textContent = String(it.menge).replace(".", ","); save("liste", liste);
  } else if(u){
    it.einheit = u.dataset.u;
    if(it.einheit === "g" && it.menge < 50) it.menge = 500;
    if(it.einheit !== "g" && it.menge >= 50) it.menge = 1;
    keepInputs(it); renderEdit(); save("liste", liste);
  } else if(k){
    it.kat = k.dataset.k; it.katManuell = true; keepInputs(it); renderEdit(); save("liste", liste);
  } else if(e.target.id === "edOk"){ closeEdit(); }
  else if(e.target.id === "edWunsch"){ keepInputs(it); wunschSenden(it, true); }
  else if(e.target.id === "edDel"){ liste = liste.filter(i => i !== it); save("liste", liste); editId = null; $("#editSheet").classList.remove("on"); renderAll(); toast("Gelöscht"); }
});
function keepInputs(it){
  const n = $("#edName"); if(n && n.value.trim()) it.text = n.value.trim().slice(0, 80);
  it.marke = ($("#edMarke")?.value || "").trim().slice(0, 60);
  it.notiz = ($("#edNotiz")?.value || "").trim().slice(0, 200);
}
$("#editSheet").addEventListener("click", e => { if(e.target.id === "editSheet") closeEdit(); });

/* ---------- Teilen ---------- */
function b64enc(str){ return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64dec(s){ s = s.replace(/-/g, "+").replace(/_/g, "/"); while(s.length % 4) s += "="; return decodeURIComponent(escape(atob(s))); }
async function shareList(){
  const offen = liste.filter(i => !i.done);
  const daten = offen.map(i => { const o = {t: i.text}; if((Number(i.menge) || 1) !== 1) o.m = i.menge; if(i.einheit) o.e = i.einheit; if(i.marke) o.b = i.marke; if(i.notiz) o.n = i.notiz; if(i.kat) o.k = i.kat; return o; });
  const link = location.origin + location.pathname + "#liste=" + b64enc(JSON.stringify(daten));
  const zeile = i => { const mt = mengeText(i); return "• " + (mt ? mt + " " : "") + i.text + (i.marke ? ` (${i.marke})` : "") + (i.notiz ? ` – ${i.notiz}` : ""); };
  const text = "🛒 Einkaufsliste\n" + offen.map(zeile).join("\n") + "\n\nIn der App übernehmen:\n" + link;
  if(navigator.share){
    try{ await navigator.share({title:"Einkaufsliste", text}); return; }catch(e){ if(e && e.name === "AbortError") return; }
  }
  try{ await navigator.clipboard.writeText(text); toast("Liste kopiert – jetzt z. B. in WhatsApp einfügen"); }
  catch(e){ window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener"); }
}
function checkImport(){
  const m = location.hash.match(/^#liste=([A-Za-z0-9_-]{1,12000})$/);
  if(!m) return;
  let roh = [];
  try{ roh = JSON.parse(b64dec(m[1])); }catch(e){}
  history.replaceState(null, "", location.pathname);
  if(!Array.isArray(roh)) return;
  const items = roh.slice(0, 100).map(x => {
    if(typeof x === "string") x = {t: x};
    if(!x || typeof x.t !== "string" || !x.t.trim()) return null;
    const menge = Number(x.m); const einheit = EINHEITEN.includes(x.e) ? x.e : "";
    return {text: x.t.trim().slice(0, 80), menge: menge > 0 && menge < 100000 ? menge : 1, einheit,
      marke: typeof x.b === "string" ? x.b.slice(0, 60) : "", notiz: typeof x.n === "string" ? x.n.slice(0, 200) : "",
      kat: typeof x.k === "string" && KATS.some(k => k.id === x.k) ? x.k : undefined};
  }).filter(Boolean);
  if(!items.length) return;
  $("#importBanner").innerHTML = `<div class="banner"><b>📥 Du hast eine Einkaufsliste bekommen</b> (${items.length} Einträge)<div class="note" style="margin:4px 0 10px">${items.slice(0, 8).map(i => esc(i.text)).join(", ")}${items.length > 8 ? " …" : ""}</div>
    <div class="row-actions" style="margin:0"><button class="btn" id="impYes">Übernehmen</button><button class="btn ghost" id="impNo">Nein danke</button></div></div>`;
  $("#impYes").onclick = () => {
    let n = 0;
    for(const x of items.reverse()){
      if(liste.some(i => !i.done && i.text.toLowerCase() === x.text.toLowerCase())) continue;
      const it = {id: uid(), done:false, ...x, produkt: erkenne(x.text)}; if(!it.kat) delete it.kat;
      liste.unshift(it); n++;
    }
    save("liste", liste); $("#importBanner").innerHTML = ""; renderAll(); toast(`${n} Einträge übernommen`);
  };
  $("#impNo").onclick = () => { $("#importBanner").innerHTML = ""; };
}

/* ---------- Angebote ---------- */
function mkBadge(m){
  const u = safeUrl(m.prospekt);
  return u ? `<a class="mk" href="${esc(u)}" target="_blank" rel="noopener" style="background:${safeColor(m.farbe)}" title="Prospekt von ${esc(m.name)} öffnen">${esc(m.name)}<small>Prospekt ↗</small></a>`
           : `<span class="mk" style="background:${safeColor(m.farbe)}">${esc(m.name)}</span>`;
}
function prospektLink(o, m){
  const u = safeUrl(o.link) || safeUrl(m.prospekt);
  if(!u && !o.seite) return "";
  const txt = o.seite ? `📄 Im Prospekt Seite ${esc(String(o.seite).slice(0, 10))}` : "📄 Zum Prospekt";
  return u ? `<a class="plink" href="${esc(u)}" target="_blank" rel="noopener">${txt} ↗</a>` : `<span class="plink">${txt}</span>`;
}
function renderProspekte(){
  $("#prospekte").innerHTML = MAERKTE.filter(m => meineMaerkte.includes(m.id) && safeUrl(m.prospekt))
    .map(m => `<a href="${esc(m.prospekt)}" target="_blank" rel="noopener"><span class="dot" style="background:${safeColor(m.farbe)}"></span>${esc(m.name)} ↗</a>`).join("");
}
function offRow(o, best){
  const w = wann(o); const m = markt(o.markt); const q = safeUrl(o.quelle);
  return `<div class="off ${best ? "best" : ""}">
    ${mkBadge(m)}
    <div class="off-main">${o.marke ? `<span class="brand">${esc(o.marke)}</span> ` : ""}${esc(o.artikel)}${o.menge ? ` <span class="note">· ${esc(o.menge)}</span>` : ""}
      ${prospektLink(o, m)}
      <div class="when ${w.soon ? "soon" : ""}">${esc(w.txt)}${o.hinweis ? " · " + esc(o.hinweis) : ""}${q ? ` · <a href="${esc(q)}" target="_blank" rel="noopener">Quelle</a>` : ""}</div></div>
    ${preisHtml(o)}</div>`;
}
function preisHtml(o){
  const pct = typeof o.statt === "number" && o.statt > o.preis ? Math.round((1 - o.preis / o.statt) * 100) : 0;
  return `<div class="price">${pct >= 5 ? `<span class="pct">−${pct} %</span><br>` : ""}${esc(euro(o.preis))}${o.statt ? `<s>${esc(euro(o.statt))}</s>` : ""}${grundpreis(o) ? `<span class="gp">${esc(grundpreis(o))}</span>` : ""}</div>`;
}
function renderAngebote(){
  document.querySelectorAll("#offFilter button").forEach(b => b.classList.toggle("on", b.dataset.f === offFilter));
  const aufListe = new Set(liste.filter(i => !i.done).map(i => i.produkt).filter(Boolean));
  document.querySelectorAll("#offSort button").forEach(b => b.classList.toggle("on", b.dataset.s === offSort));
  let prods = PRODUKTE.filter(p => relevante(p.id).length);
  if(offFilter === "liste") prods = prods.filter(p => aufListe.has(p.id));
  const q = norm(sucheA);
  const h = heute();
  const n0 = PRODUKTE.filter(p => aufListe.has(p.id) && relevante(p.id).length).length;
  if(n0) $("#dealBadge").dataset.n = n0; else delete $("#dealBadge").dataset.n;
  $("#prospTitel").style.display = $("#prospekte").style.display = offSort === "markt" ? "none" : "";
  if(offSort === "markt"){ renderNachMarkt(prods, aufListe, q); return; }
  $("#mkPick").innerHTML = "";
  if(q) prods = prods.filter(p => prodPasst(p, q) || relevante(p.id).some(o => offPasst(o, q)));
  const jetzt = prods.filter(p => relevante(p.id).some(o => o.von <= h));
  const bald = prods.filter(p => !jetzt.includes(p));
  const card = p => {
    const offs = relevante(p.id); const min = Math.min(...offs.map(o => o.preis));
    return `<div class="card"><h3>${prodTile(p)}${esc(p.name)}${aufListe.has(p.id) ? '<span class="onlist">AUF DER LISTE</span>' : ""}</h3>
      ${offs.map(o => offRow(o, o.preis === min && offs.length > 1)).join("")}</div>`;
  };
  let html = "";
  if(jetzt.length) html += `<div class="sec-title">🟢 Jetzt im Angebot</div>` + jetzt.map(card).join("");
  if(bald.length) html += `<div class="sec-title">🟠 Demnächst</div>` + bald.map(card).join("");
  if(!html && q) html = `<div class="card empty"><div class="big">🔍</div>Nichts gefunden für „${esc(sucheA)}“.${offFilter === "liste" ? `<br><br><button class="btn ghost small" id="showAll">In allen Angeboten suchen</button>` : ""}</div>`;
  if(!html){
    html = offFilter === "liste"
      ? `<div class="card empty"><div class="big">🔎</div>Für deine Liste gibt es gerade keine Angebote.<br><br><button class="btn ghost small" id="showAll">Alle Angebote zeigen</button></div>`
      : `<div class="card empty"><div class="big">🔎</div>Gerade keine Angebote gefunden.</div>`;
  }
  $("#offers").innerHTML = html;
  if($("#showAll")) $("#showAll").onclick = () => { offFilter = "alle"; save("filter", offFilter); renderAngebote(); };
}
function renderNachMarkt(prods, aufListe, q){
  const h = heute();
  // alle passenden Angebote, je Geschäft
  const offs = [];
  for(const p of prods){
    const pp = prodPasst(p, q);
    for(const o of relevante(p.id)) if(pp || offPasst(o, q)) offs.push({o, p});
  }
  const proMarkt = {};
  offs.forEach(x => (proMarkt[x.o.markt] = proMarkt[x.o.markt] || []).push(x));
  const maerkte = MAERKTE.filter(m => proMarkt[m.id]);
  if(offMarkt !== "alle" && !MAERKTE.some(m => m.id === offMarkt)) offMarkt = "alle";
  $("#mkPick").innerHTML = `<button data-m="alle" class="${offMarkt === "alle" ? "on" : ""}" style="${offMarkt === "alle" ? "background:var(--acc)" : ""}">🏪 Alle <span class="n">${offs.length}</span></button>` +
    MAERKTE.filter(m => meineMaerkte.includes(m.id)).map(m => { const on = offMarkt === m.id; const n = (proMarkt[m.id] || []).length;
      return `<button data-m="${esc(m.id)}" class="${on ? "on" : ""}" style="${on ? `background:${safeColor(m.farbe)}` : ""}"><span class="dot" style="background:${on ? "#fff" : safeColor(m.farbe)}"></span>${esc(m.name)} <span class="n">${n}</span></button>`; }).join("");
  const katPos = id => { const i = KATS.findIndex(k => k.id === id); return i < 0 ? 99 : i; };
  const sortiere = a => a.sort((x, y) => katPos(x.p.kategorie) - katPos(y.p.kategorie) || x.p.name.localeCompare(y.p.name, "de") || x.o.preis - y.o.preis);
  const zeile = ({o, p}) => { const w = wann(o); const m = markt(o.markt);
    return `<div class="off">${prodTile(p)}<div class="off-main"><b>${esc(p.name)}</b>${aufListe.has(p.id) ? ' <span class="qty">auf der Liste</span>' : ""}<br>${o.marke ? `<span class="brand">${esc(o.marke)}</span> ` : ""}${esc(o.artikel)}${o.menge ? ` <span class="note">· ${esc(o.menge)}</span>` : ""}
      ${prospektLink(o, m)}<div class="when ${w.soon ? "soon" : ""}">${esc(w.txt)}${o.hinweis ? " · " + esc(o.hinweis) : ""}</div></div>${preisHtml(o)}</div>`; };
  const zeige = offMarkt === "alle" ? maerkte : maerkte.filter(m => m.id === offMarkt);
  let html = zeige.map(m => {
    const alle = proMarkt[m.id]; const jetzt = sortiere(alle.filter(x => x.o.von <= h)); const bald = sortiere(alle.filter(x => x.o.von > h));
    const pu = safeUrl(m.prospekt);
    return `<div class="card"><div class="mkhead"><span class="mkname" style="background:${safeColor(m.farbe)}">${esc(m.name)}</span><span class="cnt">${alle.length} Angebot${alle.length === 1 ? "" : "e"}</span>${pu ? `<a href="${esc(pu)}" target="_blank" rel="noopener">Prospekt ↗</a>` : ""}</div>
      ${jetzt.map(zeile).join("")}${bald.length ? `<div class="subh">🟠 Demnächst</div>${bald.map(zeile).join("")}` : ""}</div>`;
  }).join("");
  if(!html){
    const wo = offMarkt === "alle" ? "" : ` bei ${esc(markt(offMarkt).name)}`;
    const was = q ? `für „${esc(sucheA)}“ ` : "";
    html = `<div class="card empty"><div class="big">🔎</div>${offFilter === "liste" ? `Für deine Liste ${was}gibt es${wo} gerade keine Angebote.<br><br><button class="btn ghost small" id="showAll">Alle Angebote zeigen</button>` : `Gerade keine Angebote ${was}${wo} gefunden.`}</div>`;
  }
  $("#offers").innerHTML = html;
  if($("#showAll")) $("#showAll").onclick = () => { offFilter = "alle"; save("filter", offFilter); renderAngebote(); };
}
$("#offSort").addEventListener("click", e => {
  const b = e.target.closest("button[data-s]"); if(!b) return;
  offSort = b.dataset.s; save("sort", offSort); renderAngebote();
});
$("#mkPick").addEventListener("click", e => {
  const b = e.target.closest("button[data-m]"); if(!b) return;
  offMarkt = b.dataset.m; save("omarkt", offMarkt); renderAngebote();
});
function suchFeld(boxId, setze){
  const box = $(boxId), inp = box.querySelector("input");
  inp.addEventListener("input", () => { box.classList.toggle("voll", !!inp.value); setze(inp.value); });
  inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
  box.querySelector(".x").onclick = () => { inp.value = ""; box.classList.remove("voll"); setze(""); inp.focus(); };
}
suchFeld("#suchA", v => { sucheA = v; renderAngebote(); });
suchFeld("#suchV", v => { sucheV = v; renderProdukte(); });
$("#offFilter").addEventListener("click", e => {
  const b = e.target.closest("button[data-f]"); if(!b) return;
  offFilter = b.dataset.f; save("filter", offFilter); renderAngebote();
});

/* ---------- Verlauf ---------- */
function rhythmus(pid){
  const alle = ANGEBOTE.filter(o => o.produkt === pid && meineMaerkte.includes(o.markt));
  const wochen = [...new Set(alle.map(o => { const d = parseDay(o.von); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); }))].sort();
  if(wochen.length < 3) return null;
  const abst = []; for(let i = 1; i < wochen.length; i++) abst.push((parseDay(wochen[i]) - parseDay(wochen[i-1])) / 86400000);
  abst.sort((a,b) => a-b);
  const w = Math.max(1, Math.round(abst[Math.floor(abst.length / 2)] / 7));
  const naechste = parseDay(wochen[wochen.length - 1]); naechste.setDate(naechste.getDate() + w * 7);
  return {wochen: w, naechste: isoDay(naechste)};
}
function renderProdukte(){
  const h = heute();
  const q = norm(sucheV);
  const liste0 = PRODUKTE.filter(p => prodPasst(p, q));
  if(!liste0.length){ $("#products").innerHTML = `<div class="card empty"><div class="big">🔍</div>Kein Produkt gefunden für „${esc(sucheV)}“.<br><span class="note">Trag es einfach auf deiner Liste ein – dann wird es ab jetzt mitgesucht.</span></div>`; return; }
  $("#products").innerHTML = liste0.map(p => {
    const hist = ANGEBOTE.filter(o => o.produkt === p.id && meineMaerkte.includes(o.markt)).sort((a,b) => b.von.localeCompare(a.von));
    const akt = relevante(p.id)[0];
    const letzt = hist.find(o => o.bis < h);
    let sub, hot = false;
    if(akt){ const w = wann(akt); sub = `🏷️ ${euro(akt.preis)} bei ${markt(akt.markt).name} · ${w.txt}`; hot = true; }
    else if(letzt) sub = `Zuletzt im Angebot: ${datum(letzt.von)}`;
    else sub = "Noch kein Angebot gefunden";
    let det = "";
    if(openProd === p.id){
      const r = rhythmus(p.id);
      const tief = hist.length ? hist.reduce((a,b) => a.preis <= b.preis ? a : b) : null;
      const jetztLabel = akt && akt.von <= h ? "Jetzt im Angebot" : "Nächstes Angebot";
      det = `<div class="detail"><div class="facts">
        <div class="fact"><span class="k">Letztes Angebot</span><span class="v">${letzt ? `${esc(datum(letzt.von))}<br>${esc(markt(letzt.markt).name)} · ${esc(euro(letzt.preis))}` : "–"}</span></div>
        <div class="fact"><span class="k">${jetztLabel}</span><span class="v">${akt ? `${esc(wann(akt).txt)}<br>${esc(markt(akt.markt).name)} · ${esc(euro(akt.preis))}` : r ? `etwa ab ${esc(kurz(r.naechste))}<br><span class="note">geschätzt</span>` : "noch unbekannt"}</span></div>
        <div class="fact"><span class="k">Rhythmus</span><span class="v">${r ? `etwa alle ${r.wochen} Woche${r.wochen > 1 ? "n" : ""}` : `<span class="note">noch zu wenig Daten</span>`}</span></div>
        <div class="fact"><span class="k">Bester Preis</span><span class="v">${tief ? `${esc(euro(tief.preis))}<br><span class="note">${esc(titel(tief))}</span>` : "–"}</span></div>
      </div>
      ${hist.length ? `<table>${hist.slice(0, 25).map(o => `<tr><td>${esc(datum(o.von))}</td><td>${esc(markt(o.markt).name)}<br><span class="note">${esc(titel(o))}${o.menge ? " · " + esc(o.menge) : ""}</span></td><td class="r">${esc(euro(o.preis))}${grundpreis(o) ? `<br><span class="note">${esc(grundpreis(o))}</span>` : ""}</td></tr>`).join("")}</table>` : ""}
      </div>`;
    }
    return `<div class="card" data-p="${esc(p.id)}"><div class="prod">${prodTile(p)}
      <div class="pm"><b>${esc(p.name)}</b><span class="${hot ? "hot" : ""}">${esc(sub)}</span></div><span class="go">${openProd === p.id ? "▴" : "▾"}</span></div>${det}</div>`;
  }).join("");
}
$("#products").addEventListener("click", e => {
  if(e.target.closest("a")) return;
  const c = e.target.closest(".card[data-p]"); if(!c) return;
  openProd = openProd === c.dataset.p ? null : c.dataset.p; renderProdukte();
});

/* ---------- Märkte ---------- */
function renderMaerkte(){
  $("#mkSet").innerHTML = MAERKTE.map(m => `<label><span class="dot" style="background:${safeColor(m.farbe)}"></span>${esc(m.name)}<input type="checkbox" value="${esc(m.id)}" ${meineMaerkte.includes(m.id) ? "checked" : ""}></label>`).join("");
}
$("#mkSet").addEventListener("change", () => {
  meineMaerkte = [...document.querySelectorAll("#mkSet input:checked")].map(i => i.value);
  save("maerkte", meineMaerkte); renderListe(); renderAngebote(); renderProdukte(); renderProspekte();
});

/* ---------- Navigation ---------- */
function show(v){
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  window.scrollTo({top:0});
}
document.querySelector("nav").addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if(b) show(b.dataset.v); });
function renderAll(){ renderListe(); renderAngebote(); renderProdukte(); renderMaerkte(); renderProspekte(); }

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
function katAusOFF(tags){
  // Oberbegriffe wie „plant-based-foods-and-beverages“ führen in die Irre und werden ignoriert
  const weg = /^(en:)?(plant-based-foods-and-beverages|plant-based-foods|foods-and-beverages|beverages-and-beverages-preparations|groceries|meals)$/;
  const t = " " + (tags || []).map(x => String(x).toLowerCase()).filter(x => !weg.test(x)).join(" ") + " ";
  const hat = re => re.test(t);
  if(hat(/frozen/)) return "tk";
  if(hat(/(^| )(en:)?(beverages|sodas|waters|juices|fruit-juices|coffees|teas|beers|wines|energy-drinks|soft-drinks|carbonated-drinks|plant-based-milk|milk-substitutes)( |$)/) || hat(/coffee|-drinks /)) return "getraenke";
  if(hat(/meats|sausages|hams|poultr|chicken|beef|pork|fishes|seafood/)) return "fleisch";
  if(hat(/dairies|cheeses|yogurts|milks|butters|creams|eggs|quarks|desserts|margarines|spreadable-fats/)) return "kuehl";
  if(hat(/breads|pastries|viennoiseries|toasts|rolls/)) return "brot";
  if(hat(/chocolates|sweet-snacks|biscuits|cakes|candies|confectioner|cocoa|hazelnut-spreads|salty-snacks|chips|crisps|snacks|cereal-bars/)) return "suess";
  if(hat(/pastas|rices|flours|sugars|oils|cereals|canned|sauces|condiments|ketchup|mustards|mayonnaises|salts|spreads|legumes|spices|soups|vinegars|honeys|jams|fats|baking/)) return "vorrat";
  if(hat(/fresh-fruits|fresh-vegetables|fruits|vegetables|potatoes|salads/)) return "obstgemuese";
  return null;
}
async function onCode(code){
  if(busy) return; busy = true;
  code = String(code).replace(/\D/g, "");
  await stopScan();
  if(code.length < 8 || code.length > 14){ busy = false; toast("Barcode nicht erkannt"); return; }
  toast("Suche Produkt …");
  const info = await offLaden(code);
  busy = false;
  if(info){
    const marke = String(info.brands || "").split(",")[0].trim().slice(0, 60);
    let name = String(info.product_name_de || info.product_name || info.generic_name_de || "").trim();
    if(marke && name.toLowerCase().startsWith(marke.toLowerCase())) name = name.slice(marke.length).trim() || name;
    const inhalt = String(info.quantity || "").trim();
    if(inhalt && name.toLowerCase().includes(inhalt.toLowerCase())) name = name.replace(new RegExp(inhalt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").trim();
    name = name.replace(/\s+\d+([.,]\d+)?\s*(x\s*\d+([.,]\d+)?\s*)?(g|kg|ml|l|cl|stück|stk)\b.*$/i, "").trim() || name;
    if(!name) name = marke || "Produkt " + code;
    const k = katAusOFF(info.categories_tags);
    const extra = {code, katV3: true, marke, inhalt: String(info.quantity || "").trim().slice(0, 30), bild: safeImg(info.image_front_small_url) || "", suche: (info.categories_tags || []).join(" ").replace(/en:|de:|-/g, " ")};
    if(k) extra.kat = k;
    const it = addItem(name, extra);
    toast("✓ " + (marke ? marke + " " : "") + name.slice(0, 40));
    if(it) setTimeout(() => openEdit(it.id), 350);
  } else {
    $("#newItem").value = ""; $("#newItem").placeholder = "Nicht gefunden – Namen eintippen"; $("#newItem").focus();
    toast("Produkt nicht in der Datenbank – bitte Namen eintippen");
  }
}
$("#btnScan").onclick = startScan;
$("#btnScanClose").onclick = stopScan;

init();
