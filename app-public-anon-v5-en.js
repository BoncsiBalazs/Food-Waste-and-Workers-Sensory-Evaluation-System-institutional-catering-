
"use strict";

const DATA = window.ZW_DATA;
const APP_VERSION = "5.0.0-en";
const DB_NAME = "zerowaste-entry-public-anon-v5-en";
const DB_VERSION = 1;
const STORE_SUBMISSIONS = "submissions";
const STORE_INSTITUTIONS = "institutions";
const STORE_DISHES = "userDishes";

const ATTRS = [
  ["appearance", "Appearance"],
  ["smell", "Aroma"],
  ["taste", "Taste"],
  ["texture", "Texture"],
  ["overall", "Overall liking"]
];

const stepTitles = [
  "1. Basic details",
  "2. Soup – measurements",
  "3. Soup – sensory evaluation",
  "4. Main course – measurements",
  "5. Main course – sensory evaluation",
  "6. Review"
];

let db;
let currentStep = 0;
let deferredInstallPrompt = null;

const sensoryState = {
  soup: {},
  main: {}
};

const photoState = {
  soup: null,
  main: null
};

const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

function bindById(id, eventName, handler) {
  const el = $(id);
  if (!el) {
    console.warn(`[ZeroWaste Entry] Missing UI element: #${id}; event: ${eventName}`);
    return false;
  }
  el.addEventListener(eventName, handler);
  return true;
}

function bindElement(el, eventName, handler, label = "dinamikus elem") {
  if (!el) {
    console.warn(`[ZeroWaste Entry] Missing ${label}; event: ${eventName}`);
    return false;
  }
  el.addEventListener(eventName, handler);
  return true;
}

function todayISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function localIsoWithOffset(date = new Date()) {
  const pad = (n) => String(Math.abs(Math.trunc(n))).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const offMin = -date.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(offMin) / 60));
  const om = pad(Math.abs(offMin) % 60);
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}${sign}${oh}:${om}`;
}

function fmtNumber(x, digits = 2) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "–";
  return Number(x).toLocaleString("en-GB", { maximumFractionDigits: digits });
}

function safeText(x) {
  return String(x ?? "").trim();
}

function parseDecimal(value) {
  const raw = String(value ?? "").trim().replace(/\s+/g, "").replace(",", ".");
  if (!raw) return NaN;
  const x = Number(raw);
  return Number.isFinite(x) ? x : NaN;
}

function numberValue(id) {
  const el = $(id);
  if (!el) return NaN;
  return parseDecimal(el.value);
}

function selectedAge() {
  return DATA.ageGroups.find(x => x.label === $("ageGroup").value) || null;
}

function getMasterDishes(course) {
  return DATA.dishes.filter(x => x.course === course).map(x => x.dish_name);
}

async function getUserDishes(course) {
  const rows = await idbGetAll(STORE_DISHES);
  return rows.filter(x => x.course === course).map(x => x.dishName);
}

function descriptorOptions(attribute, score = null) {
  return DATA.sensoryDescriptors
    .filter(x => x.attribute === attribute)
    .filter(x => x.descriptor !== "Appropriate" || Number(score) === 5)
    .map(x => x.descriptor);
}

function findDishPortion(course, dish, regAge) {
  return DATA.dishPortions.find(
    x => x.course === course && x.dish_name === dish && x.reg_age_group === regAge
  ) || null;
}

function findPortionGuide(portionKey, regAge) {
  return DATA.portionGuide.find(
    x => x.portion_key === portionKey && x.reg_age_group === regAge
  ) || null;
}

function dishComponentsFor(dish) {
  return DATA.dishComponents.filter(
    x => x.course === "Második fogás" && x.dish === dish
  );
}

function showToast(message, ms = 2800) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.add("hidden"), ms);
}

/* IndexedDB-adattárolás */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_SUBMISSIONS)) {
        const store = database.createObjectStore(STORE_SUBMISSIONS, { keyPath: "submissionId" });
        store.createIndex("mealDate", "mealDate", { unique: false });
        store.createIndex("institutionName", "institutionName", { unique: false });
      }
      if (!database.objectStoreNames.contains(STORE_INSTITUTIONS)) {
        database.createObjectStore(STORE_INSTITUTIONS, { keyPath: "institutionName" });
      }
      if (!database.objectStoreNames.contains(STORE_DISHES)) {
        database.createObjectStore(STORE_DISHES, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function seedReferenceInstitutions() {
  const current = await idbGetAll(STORE_INSTITUTIONS);
  const referenceNames = new Set(DATA.institutions.map(x => x.institution_name));

  // A korábbi verzióban tévesen bekerült referencia-intézményeket
  // eltávolítjuk, de a felhasználó által kézzel felvett intézményeket megtartjuk.
  for (const row of current) {
    if ((row.source === "reference" || row.source === "jelenlegi kutatási adatállomány") &&
        !referenceNames.has(row.institutionName)) {
      await idbDelete(STORE_INSTITUTIONS, row.institutionName);
    }
  }

  const refreshed = await idbGetAll(STORE_INSTITUTIONS);
  const names = new Set(refreshed.map(x => x.institutionName));

  for (const row of DATA.institutions) {
    if (!names.has(row.institution_name)) {
      await idbPut(STORE_INSTITUTIONS, {
        institutionName: row.institution_name,
        sheetName: row.sheet_name || makeSheetName(row.institution_name),
        source: "reference",
        active: true,
        createdAt: localIsoWithOffset()
      });
    } else {
      const existing = refreshed.find(x => x.institutionName === row.institution_name);
      if (existing && existing.source === "reference" && existing.sheetName !== row.sheet_name) {
        await idbPut(STORE_INSTITUTIONS, {
          ...existing,
          sheetName: row.sheet_name || makeSheetName(row.institution_name)
        });
      }
    }
  }
}

/* A felhasználói felület előkészítése */
async function populateAgeGroups() {
  const sel = $("ageGroup");
  DATA.ageGroups.forEach(x => {
    const o = document.createElement("option");
    o.value = x.label;
    o.textContent = x.label;
    sel.appendChild(o);
  });
}

function populateRecorders() {
  // Az adatrögzítő neve szabad szöveges mező: nincs előre rögzített névlista.
}

async function refreshInstitutionSelectors() {
  const rows = (await idbGetAll(STORE_INSTITUTIONS))
    .filter(x => x.active !== false)
    .sort((a, b) => a.institutionName.localeCompare(b.institutionName, "hu"));

  for (const id of ["institution", "exportInstitution"]) {
    const sel = $(id);
    const first = id === "institution"
      ? `<option value="">Select institution…</option>`
      : `<option value="">All institutions</option>`;
    sel.innerHTML = first;
    rows.forEach(x => {
      const o = document.createElement("option");
      o.value = x.institutionName;
      o.textContent = x.institutionName;
      sel.appendChild(o);
    });
  }
  renderInstitutionList(rows);
}

async function refreshDishLists() {
  const soup = [...new Set([
    ...getMasterDishes("Leves"),
    ...(await getUserDishes("Leves"))
  ])].sort((a, b) => a.localeCompare(b, "en"));

  const main = [...new Set([
    ...getMasterDishes("Második fogás"),
    ...(await getUserDishes("Második fogás"))
  ])].sort((a, b) => a.localeCompare(b, "en"));

  $("soupDishList").innerHTML = soup.map(x => `<option value="${escapeHtml(x)}"></option>`).join("");
  $("mainDishList").innerHTML = main.map(x => `<option value="${escapeHtml(x)}"></option>`).join("");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSensory(prefix, containerId) {
  const container = $(containerId);
  container.innerHTML = "";

  for (const [key, label] of ATTRS) {
    sensoryState[prefix][key] = { score: null, descriptors: [] };
    const listId = `${prefix}-${key}-descriptor-list`;

    const card = document.createElement("div");
    card.className = "sensory-card";
    card.dataset.prefix = prefix;
    card.dataset.attr = key;
    card.innerHTML = `
      <h3>${label} <b class="required-star">*</b></h3>
      <div class="score-row" aria-label="${label} score">
        ${[1,2,3,4,5].map(n => `<button class="score-btn" data-score="${n}" type="button">${n}</button>`).join("")}
      </div>
      <div class="sensory-rule-note">“Appropriate” may be selected only for a score of 5; scores 1–4 require negative descriptors.</div>
      <div class="descriptor-required-label">CATA descriptor(s) <b>*</b> <span>– select all that apply</span></div>
      <div class="descriptor-row">
        <input class="descriptor-input" list="${listId}" placeholder="Select from the list first…" autocomplete="off">
        <button class="secondary-btn add-desc-btn" type="button">Add</button>
      </div>
      <datalist id="${listId}"></datalist>
      <div class="chips"></div>
      <button class="secondary-btn small add-other-btn" type="button">Other descriptor</button>
      <div class="descriptor-row other-row hidden">
        <input class="other-descriptor" type="text" placeholder="Only use this if the descriptor is not listed">
        <button class="secondary-btn add-other-confirm-btn" type="button">Add</button>
      </div>
    `;
    container.appendChild(card);

    const descriptorInput = qs(".descriptor-input", card);
    const descriptorList = document.getElementById(listId);
    const chips = qs(".chips", card);
    const otherRow = qs(".other-row", card);
    const otherInput = qs(".other-descriptor", card);

    function refreshDescriptorList() {
      const score = sensoryState[prefix][key].score;
      descriptorList.innerHTML = descriptorOptions(label, score)
        .map(x => `<option value="${escapeHtml(x)}"></option>`).join("");
    }

    function renderChips() {
      const st = sensoryState[prefix][key];
      chips.innerHTML = st.descriptors.map((d, i) =>
        `<span class="chip">${escapeHtml(d)}<button type="button" data-i="${i}" aria-label="${escapeHtml(d)} remove">×</button></span>`
      ).join("");
      qsa(".chip button", chips).forEach(btn => {
        btn.addEventListener("click", () => {
          st.descriptors.splice(Number(btn.dataset.i), 1);
          renderChips();
          updateFinalState();
        });
      });
    }

    qsa(".score-btn", card).forEach(btn => {
      btn.addEventListener("click", () => {
        qsa(".score-btn", card).forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        const score = Number(btn.dataset.score);
        const st = sensoryState[prefix][key];
        st.score = score;
        if (score !== 5 && st.descriptors.includes("Appropriate")) {
          st.descriptors = st.descriptors.filter(x => x !== "Appropriate");
          showToast("The “Appropriate” descriptor may only be used with a score of 5.", 3600);
        }
        refreshDescriptorList();
        renderChips();
        updateFinalState();
      });
    });

    bindElement(qs(".add-desc-btn", card), "click", () => {
      const value = safeText(descriptorInput.value);
      if (!value) return;
      const score = sensoryState[prefix][key].score;
      if (score === null) {
        showToast("Select a sensory score first.", 3400);
        return;
      }
      const allowed = new Set(descriptorOptions(label, score));
      if (!allowed.has(value)) {
        showToast("First select from the provided CATA list. If no descriptor applies, choose “Other descriptor”.", 4600);
        return;
      }
      const st = sensoryState[prefix][key];
      if (!st.descriptors.includes(value)) st.descriptors.push(value);
      descriptorInput.value = "";
      renderChips();
      updateFinalState();
    });

    bindElement(descriptorInput, "keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        qs(".add-desc-btn", card).click();
      }
    });

    bindElement(qs(".add-other-btn", card), "click", () => {
      otherRow.classList.toggle("hidden");
      if (!otherRow.classList.contains("hidden")) otherInput.focus();
    });

    bindElement(qs(".add-other-confirm-btn", card), "click", () => {
      const value = safeText(otherInput.value);
      if (!value) return;
      const score = sensoryState[prefix][key].score;
      if (score === null) {
        showToast("Select a sensory score first.", 3400);
        return;
      }
      if (value.toLocaleLowerCase("en") === "appropriate" && score !== 5) {
        showToast("The “Appropriate” descriptor may only be added with a score of 5.", 3800);
        return;
      }
      const st = sensoryState[prefix][key];
      if (!st.descriptors.includes(value)) st.descriptors.push(value);
      otherInput.value = "";
      otherRow.classList.add("hidden");
      renderChips();
      updateFinalState();
    });

    bindElement(otherInput, "keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        qs(".add-other-confirm-btn", card).click();
      }
    });

    refreshDescriptorList();
  }
}

function sensoryComplete(prefix) {
  return ATTRS.every(([key]) => {
    const s = sensoryState[prefix][key];
    // Kötelező: score és legalább egy, a tulajdonságlistából kiválasztott tulajdonságleíró.
    // Az „Other descriptor” mező továbbra is opcionális, és nem helyettesíti a listás választást.
    return s.score !== null && s.descriptors.length > 0;
  });
}

function sensoryFlat(prefix) {
  const out = {};
  for (const [key] of ATTRS) {
    const s = sensoryState[prefix][key];
    out[key] = s.score;
    out[`${key}Desc`] = [...s.descriptors].join(" | ");
  }
  return out;
}

/* Fényképek kezelése – helyi tömörítés az IndexedDB-be történő mentés előtt */
function compressPhoto(file, maxSide = 1280, quality = 0.78) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!file.type.startsWith("image/")) return reject(new Error("Only image files can be uploaded."));

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("The photo could not be processed."));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handlePhoto(prefix, file) {
  const preview = $(`${prefix}PhotoPreview`);
  if (!file) {
    photoState[prefix] = null;
    preview.textContent = "No photo selected.";
    return;
  }

  try {
    preview.textContent = "Processing photo…";
    const dataUrl = await compressPhoto(file);
    photoState[prefix] = dataUrl;
    preview.innerHTML = `<img src="${dataUrl}" alt="Photo of the served dish">`;
  } catch (err) {
    photoState[prefix] = null;
    preview.textContent = "The photo could not be loaded.";
    showToast(err.message || "Photo processing error.", 4200);
  }
}

/* Az étel adatainak állapota */
async function updateDishStatus(kind) {
  const course = kind === "soup" ? "Leves" : "Második fogás";
  const inputId = kind === "soup" ? "soupDish" : "mainDish";
  const statusId = kind === "soup" ? "soupDishStatus" : "mainDishStatus";
  const value = safeText($(inputId).value);
  if (!value) {
    $(statusId).textContent = "";
    return;
  }
  const master = new Set(getMasterDishes(course));
  const user = new Set(await getUserDishes(course));
  $(statusId).textContent = master.has(value) || user.has(value) ? "Dish in reference list" : "New dish – added to the local reference list on submission";
}

/* Mértékegységek átváltása */
function renderExtraField(containerId, type, id, label, defaultValue = "") {
  const box = $(containerId);
  if (!type) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `
    <label class="field">
      <span>${label} <b>*</b></span>
      <input id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="pl. 1,0" value="${String(defaultValue).replace(".", ",")}">
    </label>
  `;
  bindById(id, "input", updateConversions);
}

function updateConversionExtras() {
  const age = selectedAge();
  const mainDish = safeText($("mainDish").value);

  // A leves kitálalt mennyisége
  const su = $("soupServedUnit").value;
  if (su === "kg") renderExtraField("soupServedExtra", "density", "soupServedDensity", "Soup density (kg/L)", "1");
  else if (su === "darab") renderExtraField("soupServedExtra", "piece", "soupServedMlPiece", "Average volume per piece (mL/piece)");
  else $("soupServedExtra").innerHTML = "";

  // A második fogás kitálalt mennyisége
  const mu = $("mainServedUnit").value;
  if (mu === "liter") renderExtraField("mainServedExtra", "density", "mainServedDensity", "Density (kg/L)", "1");
  else if (mu === "darab") renderExtraField("mainServedExtra", "piece", "mainServedGPiece", "Average mass per piece (g/piece)");
  else if (mu === "adag") {
    const guide = age ? findDishPortion("Második fogás", mainDish, age.reg_age_group) : null;
    if (guide) {
      $("mainServedExtra").innerHTML = `<div class="info-box">Automatic portion size: <strong>${fmtNumber(guide.mid_g,1)} g/portion</strong> (guide range: ${fmtNumber(guide.min_g,1)}–${fmtNumber(guide.max_g,1)} g).</div>`;
    } else {
      renderExtraField("mainServedExtra", "portion", "mainServedManualGPortion", "Actual mass per portion (g/portion)");
    }
  } else $("mainServedExtra").innerHTML = "";

  // A leves visszamért hulladéka
  const swu = $("soupWasteUnit").value;
  if (swu === "liter") renderExtraField("soupWasteExtra", "density", "soupWasteDensity", "Waste density (kg/L)", "1");
  else if (swu === "darab") renderExtraField("soupWasteExtra", "piece", "soupWasteGPiece", "Average mass per piece (g/piece)");
  else if (swu === "adag") {
    const g = age ? findPortionGuide("SOUP", age.reg_age_group) : null;
    if (g) {
      $("soupWasteExtra").innerHTML = `<div class="info-box">Automatic portion size: <strong>${fmtNumber(g.mid_g,1)} g/portion</strong>.</div>`;
    } else renderExtraField("soupWasteExtra", "portion", "soupWasteGPortion", "Estimated mass per portion (g/portion)");
  } else $("soupWasteExtra").innerHTML = "";

  // A második fogás visszamért hulladéka
  const mwu = $("mainWasteUnit").value;
  if (mwu === "liter") renderExtraField("mainWasteExtra", "density", "mainWasteDensity", "Waste density (kg/L)", "1");
  else if (mwu === "darab") renderExtraField("mainWasteExtra", "piece", "mainWasteGPiece", "Average mass per piece (g/piece)");
  else if (mwu === "adag") {
    const g = age ? findDishPortion("Második fogás", mainDish, age.reg_age_group) : null;
    if (g) {
      $("mainWasteExtra").innerHTML = `<div class="info-box">Automatic portion size: <strong>${fmtNumber(g.mid_g,1)} g/portion</strong>.</div>`;
    } else renderExtraField("mainWasteExtra", "portion", "mainWasteGPortion", "Estimated mass per portion (g/portion)");
  } else $("mainWasteExtra").innerHTML = "";
}

function inputNumIfExists(id) {
  const el = $(id);
  if (!el || el.value === "") return NaN;
  return parseDecimal(el.value);
}

function convertSoupServed() {
  const value = numberValue("soupServed");
  const unit = $("soupServedUnit").value;
  const age = selectedAge();
  if (!(value > 0)) return { ok: false, value: NaN, basis: "Enter a quantity greater than zero." };
  if (unit === "liter") return { ok: true, value, basis: "Direct conversion in litres" };
  if (unit === "kg") {
    const density = inputNumIfExists("soupServedDensity");
    if (!(density > 0)) return { ok: false, value: NaN, basis: "Density is required to convert kg to L." };
    return { ok: true, value: value / density, basis: `kg → L; density = ${density} kg/L` };
  }
  if (unit === "darab") {
    const ml = inputNumIfExists("soupServedMlPiece");
    if (!(ml > 0)) return { ok: false, value: NaN, basis: "Volume per piece is required to convert pieces to litres." };
    return { ok: true, value: value * ml / 1000, basis: `${ml} mL/piece` };
  }
  if (unit === "adag") {
    if (!age) return { ok: false, value: NaN, basis: "Select an age group." };
    const g = findPortionGuide("SOUP", age.reg_age_group);
    if (!g) return { ok: false, value: NaN, basis: "No soup portion guide is available for this age group." };
    // Az adagolási útmutató `mid_value` értéke deciliterben van megadva.
    const literPerPortion = Number(g.mid_value) / 10;
    return { ok: true, value: value * literPerPortion, basis: `${fmtNumber(literPerPortion,3)} L/portion; ${age.reg_age_group}` };
  }
  return { ok: false, value: NaN, basis: "Unknown unit." };
}

function convertMainServed() {
  const value = numberValue("mainServed");
  const unit = $("mainServedUnit").value;
  const age = selectedAge();
  const dish = safeText($("mainDish").value);
  if (!(value > 0)) return { ok: false, value: NaN, basis: "Enter a quantity greater than zero." };
  if (unit === "kg") return { ok: true, value, basis: "Direct conversion in kg" };
  if (unit === "liter") {
    const density = inputNumIfExists("mainServedDensity");
    if (!(density > 0)) return { ok: false, value: NaN, basis: "Density is required to convert L to kg." };
    return { ok: true, value: value * density, basis: `L → kg; density = ${density} kg/L` };
  }
  if (unit === "darab") {
    const g = inputNumIfExists("mainServedGPiece");
    if (!(g > 0)) return { ok: false, value: NaN, basis: "Mass per piece is required to convert pieces to kg." };
    return { ok: true, value: value * g / 1000, basis: `${g} g/piece` };
  }
  if (unit === "adag") {
    if (!age) return { ok: false, value: NaN, basis: "Select an age group." };
    const guide = findDishPortion("Második fogás", dish, age.reg_age_group);
    const g = guide ? Number(guide.mid_g) : inputNumIfExists("mainServedManualGPortion");
    if (!(g > 0)) return { ok: false, value: NaN, basis: "Mass per portion is required to convert portions to kg." };
    return { ok: true, value: value * g / 1000, basis: `${fmtNumber(g,1)} g/portion; ${age.reg_age_group}` };
  }
  return { ok: false, value: NaN, basis: "Unknown unit." };
}

function wasteFactor(unit, prefix, course) {
  const age = selectedAge();
  const dish = course === "main" ? safeText($("mainDish").value) : safeText($("soupDish").value);

  if (unit === "kg") return { ok: true, factor: 1, basis: "Direct conversion in kg" };
  if (unit === "liter") {
    const density = inputNumIfExists(`${prefix}Density`);
    if (!(density > 0)) return { ok: false, factor: NaN, basis: "Density is required to convert L to kg." };
    return { ok: true, factor: density, basis: `${density} kg/L` };
  }
  if (unit === "darab") {
    const g = inputNumIfExists(`${prefix}GPiece`);
    if (!(g > 0)) return { ok: false, factor: NaN, basis: "Mass per piece is required to convert pieces to kg." };
    return { ok: true, factor: g / 1000, basis: `${g} g/piece` };
  }
  if (unit === "adag") {
    if (!age) return { ok: false, factor: NaN, basis: "Select an age group." };
    let g;
    if (course === "soup") {
      const guide = findPortionGuide("SOUP", age.reg_age_group);
      g = guide ? Number(guide.mid_g) : inputNumIfExists(`${prefix}GPortion`);
    } else {
      const guide = findDishPortion("Második fogás", dish, age.reg_age_group);
      g = guide ? Number(guide.mid_g) : inputNumIfExists(`${prefix}GPortion`);
    }
    if (!(g > 0)) return { ok: false, factor: NaN, basis: "Mass per portion is required to convert portions to kg." };
    return { ok: true, factor: g / 1000, basis: `${fmtNumber(g,1)} g/portion` };
  }
  return { ok: false, factor: NaN, basis: "Unknown unit." };
}

function convertSoupWaste() {
  const value = numberValue("soupWaste");
  const f = wasteFactor($("soupWasteUnit").value, "soupWaste", "soup");
  if (!(value >= 0) || !f.ok) return { ok: false, value: NaN, basis: f.basis };
  return { ok: true, value: value * f.factor, basis: f.basis };
}

function convertMainWaste() {
  const values = {
    total: numberValue("mainWaste"),
    primary: numberValue("mainWastePrimary"),
    side: numberValue("mainWasteSide"),
    other: numberValue("mainWasteOther")
  };
  const f = wasteFactor($("mainWasteUnit").value, "mainWaste", "main");
  if (!Object.values(values).every(v => v >= 0) || !f.ok) {
    return { ok: false, values: {}, basis: f.basis, componentValid: false };
  }
  const kg = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v * f.factor]));
  const componentSum = kg.primary + kg.side + kg.other;
  return {
    ok: true,
    values: kg,
    basis: f.basis,
    componentValid: componentSum <= kg.total + 1e-9,
    componentSum
  };
}

function updateConversions() {
  const sc = convertSoupServed();
  $("soupServedPreview").innerHTML = `<strong>Standardisedised quantity:</strong> ${sc.ok ? `${fmtNumber(sc.value,3)} L` : "not calculable"}<br><small>${escapeHtml(sc.basis)}</small>`;

  const mc = convertMainServed();
  $("mainServedPreview").innerHTML = `<strong>Standardisedised quantity:</strong> ${mc.ok ? `${fmtNumber(mc.value,3)} kg` : "not calculable"}<br><small>${escapeHtml(mc.basis)}</small>`;

  const sw = convertSoupWaste();
  $("soupWastePreview").innerHTML = `<strong>Standardisedised quantity:</strong> ${sw.ok ? `${fmtNumber(sw.value,3)} kg` : "not calculable"}<br><small>${escapeHtml(sw.basis)}</small>`;

  const mw = convertMainWaste();
  $("mainWastePreview").innerHTML = `<strong>Standardisedised total waste:</strong> ${mw.ok ? `${fmtNumber(mw.values.total,3)} kg` : "not calculable"}<br><small>${escapeHtml(mw.basis || "")}</small>${mw.ok && !mw.componentValid ? `<div class="validation-box bad">The sum of component waste (${fmtNumber(mw.componentSum,3)} kg) exceeds the total waste (${fmtNumber(mw.values.total,3)} kg).</div>` : ""}`;

  updateFinalState();
}

function updateTemp(prefix) {
  const val = Number($(`${prefix}Temp`).value);
  $(`${prefix}TempValue`).textContent = `${val} °C`;
  const status = $(`${prefix}TempStatus`);

  if (val < 63) {
    status.className = "temp-status bad";
    status.textContent = "Reheating required!";
  } else if (val <= 68) {
    status.className = "temp-status warn";
    status.textContent = "Reheating may soon be required";
  } else if (val <= 80) {
    status.className = "temp-status good";
    status.textContent = "Acceptable!";
  } else {
    status.className = "temp-status hot";
    status.textContent = "Very hot – check sensory acceptability";
  }
}

/* Adatellenőrzés */
function stepErrors(stepIndex) {
  const errors = [];
  const requireText = (id, label) => { if (!safeText($(id).value)) errors.push(label); };
  const requireNonNeg = (id, label, positive = false) => {
    const v = numberValue(id);
    if (Number.isNaN(v) || (positive ? v <= 0 : v < 0)) errors.push(label);
  };

  if (stepIndex === 0) {
    requireText("recorderName", "Recorder ID");
    requireText("mealDate", "Date");
    requireText("ageGroup", "Age group");
    requireText("institution", "Institution");
  }

  if (stepIndex === 1) {
    requireText("soupDish", "Leves neve");
    requireNonNeg("soupServed", "Soup served quantity", true);
    if (!convertSoupServed().ok) errors.push("Soup served-quantity conversion");
    requireNonNeg("soupWaste", "Total soup waste");
    if (!convertSoupWaste().ok) errors.push("Soup waste conversion");
  }

  if (stepIndex === 2) {
    if (!sensoryComplete("soup")) errors.push("Soup sensory evaluation");
    requireText("soupImprovement", "Soup improvement suggestion");
    requireText("soupNote", "Soup comments");
  }

  if (stepIndex === 3) {
    requireText("mainDish", "Main-course name");
    requireNonNeg("mainServed", "Main-course served quantity", true);
    if (!convertMainServed().ok) errors.push("Main-course served-quantity conversion");
    ["mainWaste","mainWastePrimary","mainWasteSide","mainWasteOther"].forEach((id, i) =>
      requireNonNeg(id, ["Total waste","Main-component waste","Side-dish waste","Other-component waste"][i])
    );
    const mw = convertMainWaste();
    if (!mw.ok) errors.push("Main-course waste conversion");
    if (mw.ok && !mw.componentValid) errors.push("Component waste cannot exceed total waste");
  }

  if (stepIndex === 4) {
    if (!sensoryComplete("main")) errors.push("Main-course sensory evaluation");
    requireText("mainImprovement", "Main-course improvement suggestion");
    requireText("mainNote", "Main-course comments");
  }

  return [...new Set(errors)];
}

function allErrors() {
  return [0,1,2,3,4].flatMap(stepErrors);
}

function setFieldInvalid(id, invalid = true) {
  const el = $(id);
  if (!el) return;
  el.classList.toggle("is-invalid", !!invalid);
  const field = el.closest(".field");
  if (field) field.classList.toggle("field-invalid", !!invalid);
}

function setBoxInvalid(id, invalid = true) {
  const el = $(id);
  if (!el) return;
  el.classList.toggle("box-invalid", !!invalid);
}

function markSensoryCard(prefix, key, invalid = true) {
  const card = document.querySelector(`.sensory-card[data-prefix="${prefix}"][data-attr="${key}"]`);
  if (card) card.classList.toggle("card-invalid", !!invalid);
}

function clearValidationHighlights() {
  qsa(".is-invalid").forEach(el => el.classList.remove("is-invalid"));
  qsa(".field-invalid").forEach(el => el.classList.remove("field-invalid"));
  qsa(".box-invalid").forEach(el => el.classList.remove("box-invalid"));
  qsa(".card-invalid").forEach(el => el.classList.remove("card-invalid"));
}

function applyValidationHighlights() {
  clearValidationHighlights();

  const activeSteps = currentStep === 5 ? [0,1,2,3,4] : [currentStep];
  const requireTextField = (id) => setFieldInvalid(id, !safeText($(id)?.value));
  const requireNumberField = (id, positive = false) => {
    const v = numberValue(id);
    setFieldInvalid(id, Number.isNaN(v) || (positive ? v <= 0 : v < 0));
  };

  if (activeSteps.includes(0)) {
    ["recorderName","mealDate","ageGroup","institution"].forEach(requireTextField);
  }

  if (activeSteps.includes(1)) {
    requireTextField("soupDish");
    requireNumberField("soupServed", true);
    setFieldInvalid("soupServedUnit", !safeText($("soupServedUnit")?.value));
    const sc = convertSoupServed();
    if (!sc.ok) {
      setFieldInvalid("soupServed", true);
      ["soupServedDensity","soupServedMlPiece"].forEach(id => { if ($(id)) setFieldInvalid(id, true); });
      setBoxInvalid("soupServedPreview", true);
    }
    requireNumberField("soupWaste", false);
    setFieldInvalid("soupWasteUnit", !safeText($("soupWasteUnit")?.value));
    const sw = convertSoupWaste();
    if (!sw.ok) {
      setFieldInvalid("soupWaste", true);
      ["soupWasteDensity","soupWasteGPiece","soupWasteGPortion"].forEach(id => { if ($(id)) setFieldInvalid(id, true); });
      setBoxInvalid("soupWastePreview", true);
    }
  }

  if (activeSteps.includes(2)) {
    ATTRS.forEach(([key]) => {
      const s = sensoryState.soup[key];
      markSensoryCard("soup", key, !(s && s.score !== null && s.descriptors.length > 0));
    });
    requireTextField("soupImprovement");
    requireTextField("soupNote");
  }

  if (activeSteps.includes(3)) {
    requireTextField("mainDish");
    requireNumberField("mainServed", true);
    setFieldInvalid("mainServedUnit", !safeText($("mainServedUnit")?.value));
    const mc = convertMainServed();
    if (!mc.ok) {
      setFieldInvalid("mainServed", true);
      ["mainServedDensity","mainServedGPiece","mainServedManualGPortion"].forEach(id => { if ($(id)) setFieldInvalid(id, true); });
      setBoxInvalid("mainServedPreview", true);
    }
    ["mainWaste","mainWastePrimary","mainWasteSide","mainWasteOther"].forEach(id => requireNumberField(id, false));
    setFieldInvalid("mainWasteUnit", !safeText($("mainWasteUnit")?.value));
    const mw = convertMainWaste();
    if (!mw.ok) {
      ["mainWaste","mainWastePrimary","mainWasteSide","mainWasteOther"].forEach(id => setFieldInvalid(id, true));
      ["mainWasteDensity","mainWasteGPiece","mainWasteGPortion"].forEach(id => { if ($(id)) setFieldInvalid(id, true); });
      setBoxInvalid("mainWastePreview", true);
    }
    if (mw.ok && !mw.componentValid) {
      ["mainWaste","mainWastePrimary","mainWasteSide","mainWasteOther"].forEach(id => setFieldInvalid(id, true));
      setBoxInvalid("mainWastePreview", true);
    }
  }

  if (activeSteps.includes(4)) {
    ATTRS.forEach(([key]) => {
      const s = sensoryState.main[key];
      markSensoryCard("main", key, !(s && s.score !== null && s.descriptors.length > 0));
    });
    requireTextField("mainImprovement");
    requireTextField("mainNote");
  }
}

function updateStepValidationBox() {
  const box = $("stepValidation");
  if (!box) return;
  const errors = currentStep === 5 ? allErrors() : stepErrors(currentStep);
  if (errors.length === 0) {
    box.className = "validation-strip ok";
    box.innerHTML = currentStep === 5
      ? "<strong>Ready to submit.</strong> All required fields are complete."
      : "<strong>Complete.</strong> All required information on this page has been entered.";
  } else {
    box.className = "validation-strip bad";
    box.innerHTML = `<strong>Incomplete fields on this page:</strong><ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
  }
}

function updateFinalState() {
  if (currentStep === 5) renderReview();
  const errors = allErrors();
  const submitBtn = $("submitBtn");
  if (submitBtn) submitBtn.disabled = errors.length > 0;
  const box = $("finalValidation");
  if (box) {
    if (errors.length === 0) {
      box.className = "validation-box ok";
      box.textContent = "All required fields have been completed correctly.";
    } else {
      box.className = "validation-box bad";
      box.innerHTML = `<strong>Still required for submission:</strong><ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
    }
  }
  applyValidationHighlights();
  updateStepValidationBox();
}

function goToStep(next) {
  next = Math.max(0, Math.min(5, next));
  if (next > currentStep) {
    const errors = stepErrors(currentStep);
    if (errors.length) {
      applyValidationHighlights();
      updateStepValidationBox();
      showToast(`Incomplete: ${errors.join(", ")}`, 4200);
      return;
    }
  }
  currentStep = next;
  qsa(".step").forEach((el, i) => el.classList.toggle("active", i === currentStep));
  const observationIntro = $("observationIntro");
  if (observationIntro) observationIntro.classList.toggle("hidden", currentStep !== 0);
  $("stepTitle").textContent = stepTitles[currentStep];
  $("stepCounter").textContent = `${currentStep + 1} / 6`;
  $("progressBar").style.width = `${((currentStep + 1) / 6) * 100}%`;
  $("prevBtn").style.visibility = currentStep === 0 ? "hidden" : "visible";
  $("nextBtn").classList.toggle("hidden", currentStep === 5);
  if (currentStep === 5) renderReview();
  updateFinalState();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* Áttekintés és mentés */
function currentInstitutionRow() {
  return idbGetAll(STORE_INSTITUTIONS).then(rows =>
    rows.find(x => x.institutionName === $("institution").value) || null
  );
}

function reviewLine(label, value) {
  return `<div class="review-line"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

function renderReview() {
  const sc = convertSoupServed();
  const sw = convertSoupWaste();
  const mc = convertMainServed();
  const mw = convertMainWaste();

  $("reviewContent").innerHTML = `
    <div class="review-block">
      <h3>Basic details</h3>
      ${reviewLine("Recorder", $("recorderName").value)}
      ${reviewLine("Date", $("mealDate").value)}
      ${reviewLine("Age group", $("ageGroup").value)}
      ${reviewLine("Institution", $("institution").value)}
    </div>
    <div class="review-block">
      <h3>Soup</h3>
      ${reviewLine("Dish", $("soupDish").value)}
      ${reviewLine("Served quantity", `${$("soupServed").value || "–"} ${$("soupServedUnit").value}`)}
      ${reviewLine("Standardised", sc.ok ? `${fmtNumber(sc.value,3)} L` : "not calculable")}
      ${reviewLine("Temperature", `${$("soupTemp").value} °C`)}
      ${reviewLine("Waste", sw.ok ? `${fmtNumber(sw.value,3)} kg` : "not calculable")}
      ${reviewLine("Photo", photoState.soup ? "attached" : "none")}
      ${reviewLine("Sensory evaluation", sensoryComplete("soup") ? "complete" : "incomplete")}
    </div>
    <div class="review-block">
      <h3>Main course</h3>
      ${reviewLine("Dish", $("mainDish").value)}
      ${reviewLine("Served quantity", `${$("mainServed").value || "–"} ${$("mainServedUnit").value}`)}
      ${reviewLine("Standardised", mc.ok ? `${fmtNumber(mc.value,3)} kg` : "not calculable")}
      ${reviewLine("Main dish / main-component temperature", `${$("mainTemp").value} °C`)}
      ${reviewLine("Side-dish temperature", `${$("mainSideTemp").value} °C`)}
      ${reviewLine("Waste", mw.ok ? `${fmtNumber(mw.values.total,3)} kg` : "not calculable")}
      ${reviewLine("Photo", photoState.main ? "attached" : "none")}
      ${reviewLine("Sensory evaluation", sensoryComplete("main") ? "complete" : "incomplete")}
    </div>
  `;
  updateFinalState._busy = true;
  const errors = allErrors();
  $("submitBtn").disabled = errors.length > 0;
  const box = $("finalValidation");
  if (!errors.length) {
    box.className = "validation-box ok";
    box.textContent = "All required fields have been completed correctly.";
  } else {
    box.className = "validation-box bad";
    box.innerHTML = `<strong>Still required for submission:</strong><ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
  }
  updateFinalState._busy = false;
}

async function addUserDishIfNew(course, dish) {
  if (!dish) return;
  const master = new Set(getMasterDishes(course));
  if (master.has(dish)) return;
  await idbPut(STORE_DISHES, {
    key: `${course}::${dish.toLocaleLowerCase("en")}`,
    course,
    dishName: dish,
    createdAt: localIsoWithOffset()
  });
}

function makeSubmissionId() {
  const d = new Date();
  const stamp = localIsoWithOffset(d).replaceAll(/[-:T+]/g, "").slice(0, 14);
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `ZWE-${stamp}-${rand}`;
}

async function submitCurrent() {
  const errors = allErrors();
  if (errors.length) {
    showToast("Submission failed: required information is missing or invalid.", 4200);
    return;
  }

  const age = selectedAge();
  const inst = await currentInstitutionRow();
  const sc = convertSoupServed();
  const sw = convertSoupWaste();
  const mc = convertMainServed();
  const mw = convertMainWaste();
  const soupSens = sensoryFlat("soup");
  const mainSens = sensoryFlat("main");

  const row = {
    submissionId: makeSubmissionId(),
    recorderName: $("recorderName").value,
    mealDate: $("mealDate").value,
    submittedAt: localIsoWithOffset(),
    appVersion: APP_VERSION,
    ageGroupLabel: age.label,
    ageGroupCode: Number(age.raw_code),
    regAgeGroup: age.reg_age_group,
    institutionName: inst.institutionName,
    institutionSheet: inst.sheetName,

    soupDish: safeText($("soupDish").value),
    soupServedOriginal: numberValue("soupServed"),
    soupServedUnit: $("soupServedUnit").value,
    soupServedStandardisedL: sc.value,
    soupServedConversionBasis: sc.basis,
    soupTempC: Number($("soupTemp").value),
    soupWasteOriginal: numberValue("soupWaste"),
    soupWasteUnit: $("soupWasteUnit").value,
    soupWasteKg: sw.value,
    soupWasteConversionBasis: sw.basis,
    soupAppearance: soupSens.appearance,
    soupAppearanceDesc: soupSens.appearanceDesc,
    soupSmell: soupSens.smell,
    soupSmellDesc: soupSens.smellDesc,
    soupTaste: soupSens.taste,
    soupTasteDesc: soupSens.tasteDesc,
    soupTexture: soupSens.texture,
    soupTextureDesc: soupSens.textureDesc,
    soupOverall: soupSens.overall,
    soupOverallDesc: soupSens.overallDesc,
    soupImprovement: safeText($("soupImprovement").value),
    soupNote: safeText($("soupNote").value),
    soupPhotoDataUrl: photoState.soup,

    mainDish: safeText($("mainDish").value),
    mainServedOriginal: numberValue("mainServed"),
    mainServedUnit: $("mainServedUnit").value,
    mainServedStandardisedKg: mc.value,
    mainServedConversionBasis: mc.basis,
    mainTempC: Number($("mainTemp").value),
    mainSideTempC: Number($("mainSideTemp").value),
    mainWasteOriginal: numberValue("mainWaste"),
    mainWastePrimaryOriginal: numberValue("mainWastePrimary"),
    mainWasteSideOriginal: numberValue("mainWasteSide"),
    mainWasteOtherOriginal: numberValue("mainWasteOther"),
    mainWasteUnit: $("mainWasteUnit").value,
    mainWasteKg: mw.values.total,
    mainWastePrimaryKg: mw.values.primary,
    mainWasteSideKg: mw.values.side,
    mainWasteOtherKg: mw.values.other,
    mainWasteConversionBasis: mw.basis,
    mainAppearance: mainSens.appearance,
    mainAppearanceDesc: mainSens.appearanceDesc,
    mainSmell: mainSens.smell,
    mainSmellDesc: mainSens.smellDesc,
    mainTaste: mainSens.taste,
    mainTasteDesc: mainSens.tasteDesc,
    mainTexture: mainSens.texture,
    mainTextureDesc: mainSens.textureDesc,
    mainOverall: mainSens.overall,
    mainOverallDesc: mainSens.overallDesc,
    mainImprovement: safeText($("mainImprovement").value),
    mainNote: safeText($("mainNote").value),
    mainPhotoDataUrl: photoState.main
  };

  await idbPut(STORE_SUBMISSIONS, row);
  await addUserDishIfNew("Leves", row.soupDish);
  await addUserDishIfNew("Második fogás", row.mainDish);
  await refreshDishLists();
  showToast(`Measurement saved: ${row.submissionId}`, 4200);
  await renderSaved();
  await updateExportCount();
  resetEntry();
}

function resetSensory(prefix, containerId) {
  renderSensory(prefix, containerId);
}

function resetEntry() {
  $("entryForm").reset();
  $("mealDate").value = todayISO();
  $("soupServedUnit").value = "liter";
  $("mainServedUnit").value = "kg";
  $("soupWasteUnit").value = "kg";
  $("mainWasteUnit").value = "kg";
  $("soupTemp").value = 65;
  $("mainTemp").value = 65;
  $("mainSideTemp").value = 65;
  resetSensory("soup", "soupSensory");
  resetSensory("main", "mainSensory");
  photoState.soup = null;
  photoState.main = null;
  $("soupPhotoPreview").textContent = "No photo selected.";
  $("mainPhotoPreview").textContent = "No photo selected.";
  updateTemp("soup");
  updateTemp("main");
  updateTemp("mainSide");
  updateAgeGuide();
  updateConversionExtras();
  updateConversions();
  currentStep = 0;
  goToStep(0);
}

/* Mentett rekordok */
async function renderSaved() {
  const rows = (await idbGetAll(STORE_SUBMISSIONS))
    .sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
  $("savedCount").textContent = rows.length;
  const list = $("savedList");
  if (!rows.length) {
    list.innerHTML = `<div class="info-box muted">No saved records yet.</div>`;
    return;
  }
  list.innerHTML = rows.map(r => `
    <div class="record-item">
      <div class="record-title">${escapeHtml(r.mealDate)} – ${escapeHtml(r.institutionName)}</div>
      <div class="record-meta">${escapeHtml(r.ageGroupLabel)} • ${escapeHtml(r.soupDish)} / ${escapeHtml(r.mainDish)}</div>
      <div class="record-meta">Recorder: ${escapeHtml(r.recorderName || "–")} • Photo: ${(r.soupPhotoDataUrl || r.mainPhotoDataUrl) ? "yes" : "no"}</div>
      <div class="record-meta">Submitted: ${escapeHtml(r.submittedAt)}</div>
      <div class="record-actions">
        <button class="secondary-btn small delete-record" data-id="${escapeHtml(r.submissionId)}" type="button">Delete</button>
      </div>
    </div>
  `).join("");

  qsa(".delete-record", list).forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to delete this meal event?")) return;
      await idbDelete(STORE_SUBMISSIONS, btn.dataset.id);
      await renderSaved();
      await updateExportCount();
      showToast("Record deleted.");
    });
  });
}

async function deleteLatestSavedRecord() {
  const rows = (await idbGetAll(STORE_SUBMISSIONS))
    .sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));

  if (!rows.length) {
    showToast("No saved records to delete.");
    return;
  }

  const r = rows[0];
  const summary = [
    r.mealDate || "no date",
    r.institutionName || "unknown institution",
    `${r.soupDish || "–"} / ${r.mainDish || "–"}`
  ].join(" – ");

  if (!confirm(`Are you sure you want to delete the most recent meal event?\n\n${summary}\n\nThe deleted record will no longer appear in subsequent exports.`)) return;

  await idbDelete(STORE_SUBMISSIONS, r.submissionId);
  await renderSaved();
  await updateExportCount();
  showToast("Most recent record deleted.");
}

/* Adatkivitel */
async function filteredExportRows() {
  const rows = await idbGetAll(STORE_SUBMISSIONS);
  const from = $("exportFrom").value;
  const to = $("exportTo").value;
  const inst = $("exportInstitution").value;
  return rows.filter(r =>
    (!from || r.mealDate >= from) &&
    (!to || r.mealDate <= to) &&
    (!inst || r.institutionName === inst)
  ).sort((a, b) => a.mealDate.localeCompare(b.mealDate));
}

function rawRow(r) {
  return {
    source_sheet: r.institutionSheet,
    entry_event_id: r.submissionId,
    sorszam: r.submissionId,
    adatrögzítő_neve: r.recorderName || "",
    intezmeny_neve: r.institutionName,
    kitoltes_datuma: r.mealDate,
    bekuldes_idopontja: r.submittedAt,
    korosztaly: r.ageGroupCode,
    korosztaly_megj: r.ageGroupCode === 0 ? r.ageGroupLabel : "",
    leves_nev: r.soupDish,
    leves_adag: r.soupServedStandardisedL,
    leves_adag_eredeti: r.soupServedOriginal,
    leves_adag_egyseg_eredeti: r.soupServedUnit,
    leves_adag_konverzio: r.soupServedConversionBasis,
    leves_hom: r.soupTempC,
    leves_moslek: r.soupWasteKg,
    leves_moslek_eredeti: r.soupWasteOriginal,
    leves_moslek_egyseg_eredeti: r.soupWasteUnit,
    leves_kulso: r.soupAppearance,
    leves_kulso_megj: r.soupAppearanceDesc,
    leves_illat: r.soupSmell,
    leves_illat_megj: r.soupSmellDesc,
    leves_iz: r.soupTaste,
    leves_iz_megj: r.soupTasteDesc,
    leves_allomany: r.soupTexture,
    leves_allomany_megj: r.soupTextureDesc,
    leves_osszkedv: r.soupOverall,
    leves_osszkedv_megj: r.soupOverallDesc,
    leves_javitas: r.soupImprovement,
    leves_megjegyzes: r.soupNote,
    leves_foto_rogzitve: r.soupPhotoDataUrl ? "yes" : "no",
    leves_fogy_megj: "",
    leves_repeta: "",
    masodik_nev: r.mainDish,
    masodik_adag: r.mainServedStandardisedKg,
    masodik_adag_eredeti: r.mainServedOriginal,
    masodik_adag_egyseg_eredeti: r.mainServedUnit,
    masodik_adag_konverzio: r.mainServedConversionBasis,
    masodik_homerseklet1: r.mainTempC,
    masodik_homerseklet2: r.mainSideTempC ?? "",
    masodik_moslek: r.mainWasteKg,
    masodik_moslek_foetel: r.mainWastePrimaryKg,
    masodik_moslek_koret: r.mainWasteSideKg,
    masodik_moslek_egyeb: r.mainWasteOtherKg,
    masodik_moslek_eredeti: r.mainWasteOriginal,
    masodik_moslek_egyseg_eredeti: r.mainWasteUnit,
    masodik_kulso: r.mainAppearance,
    masodik_kulso_megj: r.mainAppearanceDesc,
    masodik_illat: r.mainSmell,
    masodik_illat_megj: r.mainSmellDesc,
    masodik_iz: r.mainTaste,
    masodik_iz_megj: r.mainTasteDesc,
    masodik_allomany: r.mainTexture,
    masodik_allomany_megj: r.mainTextureDesc,
    masodik_osszkedv: r.mainOverall,
    masodik_osszkedv_megj: r.mainOverallDesc,
    masodik_javitas: r.mainImprovement,
    masodik_megjegyzes: r.mainNote,
    masodik_foto_rogzitve: r.mainPhotoDataUrl ? "yes" : "no",
    masodik_fogy_megj: "",
    masodik_repeta: ""
  };
}

async function updateExportCount() {
  const rows = await filteredExportRows();
  $("exportCount").textContent = `${rows.length} records available for export`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (typeof v === "number" && Number.isFinite(v)) s = s.replace(".", ",");
  if (/[;"\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

async function exportCsv() {
  const rows = (await filteredExportRows()).map(rawRow);
  if (!rows.length) return showToast("No records available for export.");
  const headers = Object.keys(rows[0]);
  const csv = "\ufeff" + [
    headers.map(csvEscape).join(";"),
    ...rows.map(r => headers.map(h => csvEscape(r[h])).join(";"))
  ].join("\r\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `raw_plate_waste_${$("exportFrom").value}_${$("exportTo").value}.csv`);
}


/* ------------------------------------------------------------------
 * ZeroWaste Entry exportcsomag (ZIP)
 *
 * A ZIP tárolási (store) móddal készül, külső JavaScript-könyvtár nélkül.
 * A JPEG-képek eleve tömörítettek, ezért a ZIP-deflate itt nem adna
 * számottevő előnyt. Az entry_event_id stabilan összeköti az adatot és
 * a hozzá tartozó médiát.
 * ------------------------------------------------------------------ */

function utf8Bytes(text) {
  return new TextEncoder().encode(String(text ?? ""));
}

function dataUrlToBytes(dataUrl) {
  const raw = String(dataUrl || "");
  const comma = raw.indexOf(",");
  if (comma < 0) throw new Error("Invalid photo data format.");
  const meta = raw.slice(0, comma);
  const payload = raw.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const binary = atob(payload);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return utf8Bytes(decodeURIComponent(payload));
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 0x1F) << 11) |
    ((date.getMinutes() & 0x3F) << 5) |
    ((Math.floor(date.getSeconds() / 2)) & 0x1F);
  const day = ((year - 1980) << 9) |
    (((date.getMonth() + 1) & 0x0F) << 5) |
    (date.getDate() & 0x1F);
  return { time, day };
}

function concatBytes(parts) {
  const size = parts.reduce((sum, x) => sum + x.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n & 0xFFFF, true);
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function makeStoreZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dt = dosDateTime(new Date());

  for (const entry of entries) {
    const nameBytes = utf8Bytes(entry.name.replaceAll("\\", "/"));
    const dataBytes = entry.bytes instanceof Uint8Array ? entry.bytes : utf8Bytes(entry.bytes);
    const crc = crc32(dataBytes);
    const flags = 0x0800; // UTF-8 fájlnév

    const localHeader = concatBytes([
      u32(0x04034b50), u16(20), u16(flags), u16(0), u16(dt.time), u16(dt.day),
      u32(crc), u32(dataBytes.length), u32(dataBytes.length),
      u16(nameBytes.length), u16(0), nameBytes
    ]);

    localParts.push(localHeader, dataBytes);

    const centralHeader = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(0), u16(dt.time), u16(dt.day),
      u32(crc), u32(dataBytes.length), u32(dataBytes.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const central = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0)
  ]);
  return new Blob([concatBytes([...localParts, central, end])], { type: "application/zip" });
}

function rowsToSemicolonCsv(rows) {
  if (!rows.length) return "\ufeff";
  const headers = Object.keys(rows[0]);
  return "\ufeff" + [
    headers.map(csvEscape).join(";"),
    ...rows.map(r => headers.map(h => csvEscape(r[h])).join(";"))
  ].join("\r\n");
}

function safePathSegment(x, fallback = "event") {
  return String(x ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}


function safeDownloadFilenamePart(x, fallback = "record") {
  return String(x ?? "")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_. ]+|[_. ]+$/g, "") || fallback;
}

function semanticPhotoFilename(row, courseKey, dishName) {
  const datePart = safePathSegment(row.mealDate, "no_date");
  const dishPart = safePathSegment(dishName, courseKey === "soup" ? "leves" : "main_course");
  const institutionPart = safePathSegment(row.institutionName, "unknown_institution");
  return `${datePart}_${dishPart}_${institutionPart}_${courseKey}.jpg`;
}

async function exportEntryPackage() {
  const sourceRows = await filteredExportRows();
  if (!sourceRows.length) return showToast("No records available for export.");

  const eventRows = sourceRows.map(rawRow);
  const mediaRows = [];
  const zipEntries = [];

  for (const r of sourceRows) {
    const eventId = r.submissionId;
    const eventFolder = safePathSegment(eventId);

    const addPhoto = (courseKey, courseLabel, dishName, dataUrl) => {
      if (!dataUrl) return;
      const baseFilename = semanticPhotoFilename(r, courseKey, dishName);
      const filename = `photos/${eventFolder}/${baseFilename}`;
      const photoId = `${eventId}__${courseKey}__served`;
      mediaRows.push({
        photo_id: photoId,
        entry_event_id: eventId,
        course: courseLabel,
        photo_role: "served",
        meal_date: r.mealDate || "",
        dish_name: dishName || "",
        institution_name: r.institutionName || "",
        filename,
        stored_at: r.submittedAt || "",
        app_version: r.appVersion || APP_VERSION
      });
      zipEntries.push({ name: filename, bytes: dataUrlToBytes(dataUrl) });
    };

    addPhoto("soup", "Leves", r.soupDish, r.soupPhotoDataUrl);
    addPhoto("main", "Második fogás", r.mainDish, r.mainPhotoDataUrl);
  }

  const from = $("exportFrom").value || "all";
  const to = $("exportTo").value || "all";
  const manifest = {
    package_type: "zerowaste-entry-package",
    schema_version: 1,
    entry_app: "ZeroWaste Entry – Institutional Catering",
    entry_app_version: APP_VERSION,
    exported_at: localIsoWithOffset(),
    filters: {
      from_date: $("exportFrom").value || null,
      to_date: $("exportTo").value || null,
      institution: $("exportInstitution").value || null
    },
    event_count: eventRows.length,
    media_count: mediaRows.length,
    files: ["entry_events.csv", "entry_media.csv", "manifest.json", "photos/"]
  };

  const mediaCsv = mediaRows.length
    ? rowsToSemicolonCsv(mediaRows)
    : "\ufeffphoto_id;entry_event_id;course;photo_role;meal_date;dish_name;institution_name;filename;stored_at;app_version\r\n";

  zipEntries.unshift(
    { name: "manifest.json", bytes: utf8Bytes(JSON.stringify(manifest, null, 2)) },
    { name: "entry_media.csv", bytes: utf8Bytes(mediaCsv) },
    { name: "entry_events.csv", bytes: utf8Bytes(rowsToSemicolonCsv(eventRows)) }
  );

  showToast("Preparing export package…", 1800);
  const blob = makeStoreZip(zipEntries);

  const datePart = from === to ? from : `${from}_${to}`;
  const selectedInstitution = $("exportInstitution").value;
  const rowInstitutions = [...new Set(sourceRows.map(r => r.institutionName).filter(Boolean))];
  const institutionPart = safeDownloadFilenamePart(
    selectedInstitution || (rowInstitutions.length === 1 ? rowInstitutions[0] : "all_institutions"),
    "unknown_institution"
  );
  const packageFilename = `${datePart}_plate_waste_${institutionPart}.zip`;

  downloadBlob(blob, packageFilename);

  const shareFile = new File([blob], packageFilename, { type: "application/zip" });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [shareFile] })) {
    try {
      await navigator.share({
        files: [shareFile],
        title: "Plate-waste observation data",
        text: "Export from ZeroWaste Entry for the catering manager."
      });
      showToast(`ZIP downloaded and prepared for sharing: ${eventRows.length} events, ${mediaRows.length} photos.`, 4600);
      return;
    } catch (err) {
      if (err && err.name !== "AbortError") console.warn("Sharing error:", err);
    }
  }
  showToast(`ZIP downloaded: ${eventRows.length} events, ${mediaRows.length} photos. Forward it to the catering manager.`, 4600);
}

function makeSheetName(name) {
  return safeText(name).replace(/[:\\/?*\[\]]/g, " ").replace(/\s+/g, " ").slice(0, 31) || "Records";
}

async function exportXlsx() {
  const sourceRows = await filteredExportRows();
  if (!sourceRows.length) return showToast("No records available for export.");
  if (!window.XLSX) {
    showToast("The XLSX library has not loaded yet. Check your internet connection or use CSV export.", 5000);
    return;
  }
  const rows = sourceRows.map(rawRow);
  const wb = XLSX.utils.book_new();
  const groups = new Map();
  for (const r of rows) {
    const key = r.source_sheet || "Records";
    if (!groups.has(key)) groups.set(key, []);
    const copy = { ...r };
    delete copy.source_sheet;
    groups.get(key).push(copy);
  }

  const used = new Set();
  for (const [name, group] of groups.entries()) {
    let sheet = makeSheetName(name);
    let base = sheet;
    let n = 2;
    while (used.has(sheet)) {
      const suffix = `_${n++}`;
      sheet = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    }
    used.add(sheet);
    const ws = XLSX.utils.json_to_sheet(group);
    XLSX.utils.book_append_sheet(wb, ws, sheet);
  }
  XLSX.writeFile(wb, `raw_plate_waste_${$("exportFrom").value}_${$("exportTo").value}.xlsx`);
}

async function backupJson() {
  const submissions = await idbGetAll(STORE_SUBMISSIONS);
  const institutions = await idbGetAll(STORE_INSTITUTIONS);
  const userDishes = await idbGetAll(STORE_DISHES);
  const obj = {
    app: "ZeroWaste Entry – Institutional Catering",
    version: APP_VERSION,
    exportedAt: localIsoWithOffset(),
    submissions,
    institutions,
    userDishes
  };
  downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }),
    `zerowaste_entry_backup_${todayISO()}.json`);
}

/* Törzsadatok */
function renderInstitutionList(rows) {
  $("institutionList").innerHTML = rows.length
    ? rows.map(x => `<div class="simple-item"><strong>${escapeHtml(x.institutionName)}</strong></div>`).join("")
    : `<div class="info-box muted">No institutions registered.</div>`;
}

async function addInstitution() {
  const name = safeText($("newInstitution").value);
  if (!name) return showToast("Enter an institution identifier.");
  const sheet = makeSheetName(name);
  await idbPut(STORE_INSTITUTIONS, {
    institutionName: name,
    sheetName: sheet,
    source: "user",
    active: true,
    createdAt: localIsoWithOffset()
  });
  $("newInstitution").value = "";
  await refreshInstitutionSelectors();
  showToast("Institution added.");
}

function renderGuide() {
  const q = safeText($("guideSearch").value).toLocaleLowerCase("en");
  const rows = DATA.portionGuide.filter(x =>
    !q ||
    `${x.food_element} ${x.reg_age_group} ${x.portion_key}`.toLocaleLowerCase("en").includes(q)
  ).slice(0, 100);
  $("guideList").innerHTML = rows.map(x =>
    `<div class="simple-item"><strong>${escapeHtml(x.food_element)}</strong><div class="record-meta">${escapeHtml(x.reg_age_group)} • ${escapeHtml(x.min_value)}–${escapeHtml(x.max_value)} ${escapeHtml(x.guide_unit)} • midpoint: ${escapeHtml(x.mid_value)}</div></div>`
  ).join("") || `<div class="info-box muted">No results found.</div>`;
}

/* Navigáció és egyéb funkciók */
function switchView(name) {
  qsa(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
  qsa(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  if (name === "saved") renderSaved();
  if (name === "export") updateExportCount();
}

function updateAgeGuide() {
  const age = selectedAge();
  $("ageGuideBox").innerHTML = age
    ? `<strong>${escapeHtml(age.label)}</strong><br>Portion-size guide age group: <strong>${escapeHtml(age.reg_age_group)}</strong>.`
    : "The portion-size age group is shown after selecting an age group.";
  updateConversionExtras();
  updateConversions();
}

function updateNetworkBadge() {
  const online = navigator.onLine;
  const b = $("networkBadge");
  b.className = `badge ${online ? "online" : "offline"}`;
  b.textContent = online ? "Online" : "Offline";
}

function bindEvents() {
  bindById("prevBtn", "click", () => goToStep(currentStep - 1));
  bindById("nextBtn", "click", () => goToStep(currentStep + 1));
  bindById("submitBtn", "click", submitCurrent);

  qsa(".nav-btn").forEach(btn => bindElement(btn, "click", () => switchView(btn.dataset.view), ".nav-btn"));

  bindById("ageGroup", "change", updateAgeGuide);
  bindById("soupDish", "input", async () => {
    await updateDishStatus("soup");
    updateConversionExtras();
    updateConversions();
  });
  bindById("mainDish", "input", async () => {
    await updateDishStatus("main");
    updateConversionExtras();
    updateConversions();
  });

  bindById("soupNewDishBtn", "click", () => {
    $("soupDish").value = "";
    $("soupDish").focus();
    $("soupDishStatus").textContent = "Enter the new soup name.";
  });
  bindById("mainNewDishBtn", "click", () => {
    $("mainDish").value = "";
    $("mainDish").focus();
    $("mainDishStatus").textContent = "Enter the new dish name.";
  });

  ["soupServedUnit","mainServedUnit","soupWasteUnit","mainWasteUnit"].forEach(id =>
    bindById(id, "change", () => {
      updateConversionExtras();
      updateConversions();
    })
  );

  [
    "soupServed","soupWaste","mainServed","mainWaste",
    "mainWastePrimary","mainWasteSide","mainWasteOther",
    "soupImprovement","soupNote","mainImprovement","mainNote",
    "recorderName","mealDate","institution","ageGroup","soupDish","mainDish"
  ].forEach(id => { bindById(id, "input", updateFinalState); bindById(id, "change", updateFinalState); });

  bindById("soupPhoto", "change", async (e) => {
    await handlePhoto("soup", e.target.files?.[0] || null);
  });
  bindById("mainPhoto", "change", async (e) => {
    await handlePhoto("main", e.target.files?.[0] || null);
  });

  bindById("soupTemp", "input", () => { updateTemp("soup"); updateFinalState(); });
  bindById("mainTemp", "input", () => { updateTemp("main"); updateFinalState(); });
  bindById("mainSideTemp", "input", () => { updateTemp("mainSide"); updateFinalState(); });

  ["exportFrom","exportTo","exportInstitution"].forEach(id => bindById(id, "change", updateExportCount));
  bindById("deleteLatestSavedBtn", "click", deleteLatestSavedRecord);
  bindById("exportCsvBtn", "click", exportCsv);
  bindById("exportXlsxBtn", "click", exportXlsx);
  bindById("exportZipBtn", "click", exportEntryPackage);
  bindById("backupJsonBtn", "click", backupJson);
  bindById("addInstitutionBtn", "click", addInstitution);
  bindById("guideSearch", "input", renderGuide);

  window.addEventListener("online", updateNetworkBadge);
  window.addEventListener("offline", updateNetworkBadge);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const installBtn = $("installBtn");
    if (installBtn) installBtn.classList.remove("hidden");
  });

  bindById("installBtn", "click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    const installBtn = $("installBtn");
    if (installBtn) installBtn.classList.add("hidden");
  });
}

async function init() {
  db = await openDatabase();
  await seedReferenceInstitutions();
  await populateAgeGroups();
  populateRecorders();
  await refreshInstitutionSelectors();
  await refreshDishLists();

  $("mealDate").value = todayISO();
  const d = new Date();
  const to = todayISO();
  const fromD = new Date(d.getTime() - 30 * 86400000);
  const fromOffset = fromD.getTimezoneOffset();
  $("exportFrom").value = new Date(fromD.getTime() - fromOffset * 60000).toISOString().slice(0,10);
  $("exportTo").value = to;

  renderSensory("soup", "soupSensory");
  renderSensory("main", "mainSensory");
  renderGuide();
  bindEvents();
  updateTemp("soup");
  updateTemp("main");
  updateTemp("mainSide");
  updateAgeGuide();
  updateConversionExtras();
  updateConversions();
  updateNetworkBadge();
  await renderSaved();
  await updateExportCount();
  goToStep(0);
  updateFinalState();

  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.register("./sw-public-anon-v5-en.js?v=5.0.0");
      await registration.update();
    } catch (err) {
      console.warn("Service worker registration failed:", err);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch(err => {
    console.error(err);
    alert(`ZeroWaste Entry initialisation error: ${err.message}`);
  });
});
