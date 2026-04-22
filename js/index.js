const SAIT = { name: "SAIT (Main Campus)", lat: 51.0640, lon: -114.0910 };
let RESTAURANTS = [];
let MANUAL = { version: 1, byId: {} };

// Skeleton loading control
const MIN_SKELETON_DURATION = 3000; // milliseconds (3 seconds)
let skeletonStartTime = 0;
let isShowingSkeleton = false;


// Closed / hidden IDs and names that should never appear on the website
const HIDDEN_LOCATIONS = {
  ids: new Set([
    "osm_way_535279099",
    "osm_node_13317499381",
    "osm_node_13317503234",
    "osm_node_12801144382",
    "osm_node_13175529921",
    "osm_node_12256428468",
    "osm_node_13317503233",
    "osm_node_1752175181",
    "osm_way_1422410866"
  ]),
  names: new Set(["hellcrust pizza", "banzai sushi", "pizza pizza"].map(s => s.toLowerCase()))
};

function isBlacklistedPlace(place) {
  if (!place) return false;
  const id = String(place.id || "");
  const name = String(place.name || "").trim().toLowerCase();
  return HIDDEN_LOCATIONS.ids.has(id) || HIDDEN_LOCATIONS.names.has(name);
}

// category labels shown to user; spaces preferred over underscores
const CATEGORIES = ["restaurant", "cafe", "fast food", "pizza", "coffee", "ramen", "healthy"];

let state = {
  origin: { ...SAIT },
  radiusKm: 1,
  query: "",
  activeCategory: null,
  // null = không lọc theo deals, user có thể không chọn nút nào
  maxPrice: null,
};

function distanceKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const x = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  return R * c;
}

function walkingMinutes(distKm) {
  const walkSpeedKmPerMin = 0.08;
  return Math.max(1, Math.round(distKm / walkSpeedKmPerMin));
}

function money(n) { return `$${n}`; }

function initRadiusPicker() {
  const radiusSelect = document.getElementById("radius");
  const radiusToggle = document.getElementById("radiusToggle");
  const radiusLabel = document.getElementById("radiusLabel");
  const radiusMenu = document.getElementById("radiusMenu");
  const radiusOptions = Array.from(document.querySelectorAll(".radius-option"));
  if (!radiusSelect || !radiusToggle || !radiusLabel || !radiusMenu || radiusOptions.length === 0) return;

  const closeMenu = () => {
    radiusMenu.hidden = true;
    radiusToggle.setAttribute("aria-expanded", "false");
  };

  const syncRadiusUI = (value) => {
    const selectedOption = radiusOptions.find((option) => option.dataset.value === String(value)) || radiusOptions[0];
    radiusLabel.textContent = selectedOption.textContent.trim();
    radiusOptions.forEach((option) => {
      const isSelected = option === selectedOption;
      option.setAttribute("aria-selected", String(isSelected));
    });
  };

  radiusToggle.addEventListener("click", () => {
    const willOpen = radiusMenu.hidden;
    radiusMenu.hidden = !willOpen;
    radiusToggle.setAttribute("aria-expanded", String(willOpen));
  });

  radiusOptions.forEach((option) => {
    option.addEventListener("click", () => {
      if (radiusSelect.value === option.dataset.value) {
        syncRadiusUI(radiusSelect.value);
        closeMenu();
        return;
      }
      radiusSelect.value = option.dataset.value;
      syncRadiusUI(radiusSelect.value);
      closeMenu();
      radiusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".radius-picker")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  syncRadiusUI(radiusSelect.value);
}

async function fetchNearbyFromOSM(lat, lon, radiusMeters, endpoint) {
  // For demo stability, load from static JSON instead of live API
  // Uncomment the line below and comment out the rest to use static data
  // return await fetchStaticOverpassData();

  // amenity constant keeps underscore for OSM; display and matching elsewhere use spaces
  const AMENITY_FAST_FOOD = "fast_food";
  const query = `
  [out:json][timeout:25];
  (
    node["amenity"~"restaurant|cafe|${AMENITY_FAST_FOOD}"](around:${radiusMeters},${lat},${lon});
    way["amenity"~"restaurant|cafe|${AMENITY_FAST_FOOD}"](around:${radiusMeters},${lat},${lon});
    relation["amenity"~"restaurant|cafe|${AMENITY_FAST_FOOD}"](around:${radiusMeters},${lat},${lon});
  );
  out center tags;
  `;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: query
  });
  if (!res.ok) throw new Error(`Overpass failed: ${res.status}`);
  const data = await res.json();
  return (data.elements || [])
    .map((el, i) => {
      const eLat = el.lat ?? el.center?.lat;
      const eLon = el.lon ?? el.center?.lon;
      if (eLat == null || eLon == null) return null;
      const amenity = el.tags?.amenity || "food";
      const cuisine = el.tags?.cuisine ? el.tags.cuisine.replaceAll(";", ", ") : null;
      return {
        // Stable id so you can map manual-data.js entries reliably
        id: `osm_${el.type}_${el.id}`,
        apiName: el.tags?.name || null,
        name: el.tags?.name || "Local food spot",
        lat: eLat,
        lon: eLon,
        priceAvg: null,
        rating: null,
        deals: null,
        note: cuisine ? `${amenity} • ${cuisine}` : amenity,
        tags: [amenity, ...(cuisine ? cuisine.split(",").map(s => s.trim()) : [])]
          .filter(Boolean)
          .map(t => String(t).replaceAll("_", " ")) // convert underscores to spaces for consistency
      };
    })
    .filter(Boolean);
}

async function fetchStaticOverpassData() {
  // Load static Overpass response for demo stability
  const res = await fetch('./data/overpass-response.json');
  if (!res.ok) throw new Error(`Failed to load static data: ${res.status}`);
  const data = await res.json();
  return (data.elements || [])
    .map((el, i) => {
      const eLat = el.lat ?? el.center?.lat;
      const eLon = el.lon ?? el.center?.lon;
      if (eLat == null || eLon == null) return null;
      const amenity = el.tags?.amenity || "food";
      const cuisine = el.tags?.cuisine ? el.tags.cuisine.replaceAll(";", ", ") : null;
      return {
        id: `osm_${el.type}_${el.id}`,
        apiName: el.tags?.name || null,
        name: el.tags?.name || "Local food spot",
        lat: eLat,
        lon: eLon,
        priceAvg: null,
        rating: null,
        deals: null,
        note: cuisine ? `${amenity} • ${cuisine}` : amenity,
        tags: [amenity, ...(cuisine ? cuisine.split(",").map(s => s.trim()) : [])]
          .filter(Boolean)
          .map(t => String(t).replaceAll("_", " "))
      };
    })
    .filter(Boolean);
}

async function loadManualData() {
  // The manual overrides are provided via a JS file (`data/manual-data.js`)
  // so no HTTP request is required, even under file://.  Just copy the global
  // value if present.
  if (window.MANUAL_DATA && typeof window.MANUAL_DATA === "object") {
    MANUAL = window.MANUAL_DATA;
  }
  // the old JSON version has been removed from the project.
}

function applyManualOverrides(items) {
  const byId = MANUAL?.byId || {};
  items.forEach((r) => {
    const m = byId?.[String(r.id)];
    if (!m) return;
    if (typeof m.name === "string" && m.name.trim()) r.name = m.name.trim();
    if (typeof m.rating === "number") r.rating = m.rating;
    if (typeof m.priceAvg === "number") r.priceAvg = m.priceAvg;
    if (Array.isArray(m.deals)) r.deals = m.deals;
    if (typeof m.imageUrl === "string" && m.imageUrl.trim()) r.imageUrl = m.imageUrl.trim();
  });
}

function filterManualDataItems(items) {
  const byId = MANUAL?.byId || {};
  const originalCount = items.length;
  const filtered = items.filter(r => byId.hasOwnProperty(String(r.id)));
  const filteredOutCount = originalCount - filtered.length;
  console.log(`Manual data filter: ${filteredOutCount} places filtered out (only showing ${filtered.length} with manual data)`);
  return filtered;
}

function matches(r) {
  const q = state.query.trim().toLowerCase();
  const cat = state.activeCategory;
  const inRadius = r._distKm <= state.radiusKm + 1e-9;
  const qHit = !q || r.name.toLowerCase().includes(q) || (r.tags || []).some(t => String(t).toLowerCase().includes(q));
  const catHit = !cat || (r.tags || [])
    .map(t => String(t).toLowerCase().replace(/_/g, " "))
    .includes(cat.toLowerCase());
  const priceOk = state.maxPrice == null || (r._priceAvg != null && r._priceAvg <= state.maxPrice);
  return inRadius && qHit && catHit && priceOk;
}

/** Gán _priceAvg và _rating (mô phỏng) trước khi lọc theo giá. */
function ensureSimulatedPriceRating(items) {
  items.forEach((r, i) => {
    if (r._priceAvg != null && r._rating != null) return;
    const { rating, priceAvg } = simulatePriceAndRating(r, i);
    r._priceAvg = priceAvg;
    r._rating = rating;
  });
}

function renderChips() {
  const chips = document.getElementById("chips");
  chips.innerHTML = "";
  CATEGORIES.forEach(c => {
    const el = document.createElement("div");
    el.className = "chip";
    // display label should replace any remaining underscores
    el.textContent = c.replace(/_/g, " ");
    el.dataset.active = (state.activeCategory === c) ? "true" : "false";
    el.onclick = () => {
      state.activeCategory = (state.activeCategory === c) ? null : c;
      render();
    };
    chips.appendChild(el);
  });
}

function simulatePriceAndRating(r, index) {
  const seed = (r.name + index).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const rating = r.rating != null ? r.rating : (3.2 + (seed % 11) / 10);
  const priceAvg = r.priceAvg != null ? r.priceAvg : (4 + (seed % 14));
  return { rating, priceAvg };
}

function sampleMenuItems(priceAvg, r) {
  // If we have any manual record for this restaurant, build the list from
  // whatever menu-related arrays are defined there.  This mirrors the logic
  // used on the detail page so that the two views stay in sync.  If there is
  // at least one item we return it (up to three) and do **not** fall back to
  // dummy data.
  const manual = MANUAL?.byId?.[String(r.id)] || {};
  const sources = [];
  if (Array.isArray(manual.most_student_orders)) sources.push(...manual.most_student_orders);
  if (Array.isArray(manual.best_deals)) sources.push(...manual.best_deals);
  if (Array.isArray(manual.whats_available)) sources.push(...manual.whats_available);
  if (Array.isArray(manual.deals)) sources.push(...manual.deals);

  if (sources.length) {
    const byName = Object.create(null);
    sources.forEach(d => {
      if (!d || typeof d.name !== 'string' || !d.name.trim()) return;
      const key = d.name.trim().toLowerCase();
      if (!byName[key]) byName[key] = d;
    });
    const items = Object.values(byName).map(d => ({
      name: String(d.name).trim(),
      price: Number(d.price).toFixed(2)
    }));
    return items.slice(0, 3);
  }

  // no manual info – continue using the old simulation logic and pad to three
  // items so that the cards are consistent when there is no override.
  const items = [
    { name: "Latte", price: Math.min(priceAvg + (priceAvg * 0.1), 8).toFixed(2) },
    { name: "Sandwich", price: (priceAvg * 1.2).toFixed(2) },
    { name: "Combo", price: (priceAvg * 1.5).toFixed(2) },
  ];
  return items.slice(0, 2 + (Math.floor(priceAvg) % 2));
}

function showSkeleton() {
  const skeleton = document.getElementById("skeletonContainer");
  const list = document.getElementById("list");
  skeleton.style.display = "";
  list.classList.add("loading");
  skeleton.classList.remove("hiding");
  skeletonStartTime = Date.now();
  isShowingSkeleton = true;
}

function hideSkeleton() {
  const skeleton = document.getElementById("skeletonContainer");
  const list = document.getElementById("list");
  if (isShowingSkeleton) {
    skeleton.classList.add("hiding");
    setTimeout(() => {
      skeleton.style.display = "none";
      skeleton.classList.remove("hiding");
    }, 300);
  }
  list.classList.remove("loading");
  isShowingSkeleton = false;
}

function ensureSkeletonDurationElapsed() {
  if (!isShowingSkeleton) return Promise.resolve();
  const elapsed = Date.now() - skeletonStartTime;
  const remaining = MIN_SKELETON_DURATION - elapsed;
  if (remaining > 0) {
    return new Promise(resolve => setTimeout(resolve, remaining));
  }
  return Promise.resolve();
}

function renderList(items) {
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");
  const count = document.getElementById("count");

  list.innerHTML = "";
  const placeWord = items.length === 1 ? "place" : "places";
  count.textContent = `${items.length} ${placeWord} within ${state.radiusKm} km • ${state.origin.name}`;

  if (items.length === 0) {
    empty.style.display = "block";
    empty.textContent = "No matches found. Try a larger radius, clear filters, or update your search.";
    ensureSkeletonDurationElapsed().then(() => hideSkeleton());
    return;
  }
  empty.style.display = "none";

  items.forEach((r, i) => {
    const { rating, priceAvg } = simulatePriceAndRating(r, i);
    r._priceAvg = priceAvg;
    r._rating = rating;
    const distKm = r._distKm;
    const walkMin = walkingMinutes(distKm);
    let menuItems = sampleMenuItems(priceAvg, r);
    // if there's no manual entry at all, we still want cards to show exactly
    // three lines so layout doesn't jump around.  Only pad when the restaurant
    // has no manual override; do not inject anything when manual data exists.
    const hasManual = !!MANUAL?.byId?.[String(r.id)];
    if (!hasManual && menuItems.length < 3) {
      const pool = ["Latte","Cappuccino","Americano","Sandwich","Breakfast wrap"];
      let idx = 0;
      while (menuItems.length < 3) {
        const name = pool[idx++ % pool.length];
        if (!menuItems.some(m => m.name === name)) {
          menuItems.push({ name, price: (priceAvg * 1.2).toFixed(2) });
        }
      }
    }

    const card = document.createElement("div");
    card.className = "restaurant-card";
    card.addEventListener("click", (event) => {
      if (event.target.closest("a.card-link-btn")) return;
      localStorage.setItem('unidbite_places', JSON.stringify(RESTAURANTS));
      window.location.href = `./details.html?id=${encodeURIComponent(r.id)}`;
    });

    const thumbHtml = r.imageUrl
      ? `<img class="card-thumb" src="${r.imageUrl}" alt="${r.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="card-thumb-placeholder" style="display:none;">🍽️</div>`
      : `<div class="card-thumb-placeholder">🍽️</div>`;

    const underLabel = priceAvg <= 5 ? "Under $5" : priceAvg <= 10 ? "Under $10" : "Under $20";
    const underClass = priceAvg <= 5 ? "badge-under5" : priceAvg <= 10 ? "badge-under10" : "badge-under20";
    const showWalking = walkMin <= 5;
    const showStudent = (r.tags || []).some(t => /cafe|coffee|fast food/i.test(String(t)));

    card.innerHTML = `
      <div class="card-top">
        ${thumbHtml}
        <div class="card-info">
          <h3>${r.name}</h3>
          <div class="card-meta">
            <span class="meta-distance">${distKm.toFixed(1)} km</span>
            <span class="meta-time"><span class="clock">⏱</span> ${walkMin}m</span>
            <span class="card-rating"><span class="stars">${"★".repeat(Math.round(rating))}${"☆".repeat(5 - Math.round(rating))}</span> ${rating.toFixed(1)}</span>
          </div>
        </div>
      </div>
      <ul class="card-menu">
        ${menuItems.map(m => `<li>• ${m.name} $${m.price}</li>`).join("")}
      </ul>
      <div class="card-badges">
        ${showWalking ? '<span class="badge badge-walking">5-minute walk</span>' : ""}
        ${showStudent ? '<span class="badge badge-student-friendly">Student-friendly</span>' : ""}
      </div>
      <div class="card-footer">
        <div class="card-deal-badges">
          <span class="badge ${underClass}">${underLabel}</span>
          <span class="badge badge-value">Best value</span>
        </div>
        <a href="./details.html?id=${encodeURIComponent(r.id)}" class="card-link-btn" aria-label="View details" onclick="localStorage.setItem('unidbite_places', JSON.stringify(RESTAURANTS));">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
      </div>
    `;
    list.appendChild(card);
  });
  
  ensureSkeletonDurationElapsed().then(() => hideSkeleton());
}

function render() {
  showSkeleton();
  
  const withDist = RESTAURANTS.map(r => ({
    ...r,
    _distKm: distanceKm(state.origin.lat, state.origin.lon, r.lat, r.lon)
  }));
  ensureSimulatedPriceRating(withDist);

  const filtered = withDist
    .filter(matches)
    .sort((a, b) => a._distKm - b._distKm);

  renderList(filtered);
}

document.getElementById("q").addEventListener("input", (e) => {
  state.query = e.target.value;
  localStorage.setItem("unidbite_query", state.query);
  render();
});

document.getElementById("radius").addEventListener("change", (e) => {
  state.radiusKm = Number(e.target.value);
  localStorage.setItem("unidbite_radiusKm", String(state.radiusKm));
  render();
});

document.querySelectorAll(".price-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const isActive = btn.classList.contains("active");

    if (isActive) {
      // Bấm lại để tắt chọn, hiển thị tất cả deals
      document.querySelectorAll(".price-btn").forEach((b) => b.classList.remove("active"));
      state.maxPrice = null;
    } else {
      // Chỉ chọn một mức giá tại một thời điểm
      document.querySelectorAll(".price-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.maxPrice = Number(btn.dataset.max);
    }

    render();
  });
});

document.getElementById("exportTemplate").addEventListener("click", () => {
  const template = {
    version: 1,
    generatedAt: new Date().toISOString(),
    byId: {}
  };

  const sorted = [...RESTAURANTS].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  sorted.forEach((r) => {
    const id = String(r.id);
    template.byId[id] = {
      // Keep "name" as the API name for consistency
      name: r.apiName || r.name || "",
      rating: null,
      priceAvg: null,
      deals: [],
      // optional richer menus
      most_student_orders: [],
      best_deals: [],
      whats_available: [],
      address: "",
      addressUrl: "",
      mapPreviewImageUrl: "",
      openHours: "",
      description: "",
      reviewCount: null,
      reviews: [],
      imageUrl: "",
      lat: r.lat,
      lon: r.lon,
      note: r.note || ""
    };
  });

  const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "manual-data.template.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

const savedOrigin = localStorage.getItem("unidbite_origin");
if (savedOrigin) {
  try {
    const o = JSON.parse(savedOrigin);
    if (o.lat != null && o.lon != null) state.origin = o;
  } catch (_) {}
}

document.getElementById("useGeo")?.addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.origin = { name: "Your location", lat: pos.coords.latitude, lon: pos.coords.longitude };
      render();
    },
    () => alert("Location permission denied.")
  );
});

async function initRestaurants() {
  // Display skeleton immediately on page load to show loading state
  showSkeleton();

  // Đồng bộ radius mặc định với giá trị đang hiển thị trong dropdown (0.5 km hoặc 1 km)
  const radiusSelect = document.getElementById("radius");
  if (radiusSelect) {
    const savedRadius = localStorage.getItem("unidbite_radiusKm");
    if (savedRadius && (savedRadius === "0.5" || savedRadius === "1")) {
      radiusSelect.value = savedRadius;
    }
    state.radiusKm = Number(radiusSelect.value);
  }
  initRadiusPicker();
  const savedQuery = localStorage.getItem("unidbite_query");
  const qInput = document.getElementById("q");
  if (qInput && typeof savedQuery === "string") {
    qInput.value = savedQuery;
    state.query = savedQuery;
  }

  await loadManualData();

  // ── Step 1: Load instantly from manual-data.js (no network needed) ──────
  // Build place objects directly from MANUAL_DATA.byId so the page renders
  // immediately without waiting for Overpass.
  const manualById = MANUAL?.byId || {};
  const manualIds = Object.keys(manualById);

  if (manualIds.length > 0) {
    RESTAURANTS = manualIds
      .map(id => {
        const m = manualById[id];
        if (!m || typeof m.lat !== "number" || typeof m.lon !== "number") return null;
        return {
          id,
          apiName: m.name || null,
          name: m.name || "Local food spot",
          lat: m.lat,
          lon: m.lon,
          priceAvg: m.priceAvg || null,
          rating: m.rating || null,
          deals: m.deals || null,
          imageUrl: m.imageUrl || "",
          note: m.note || "restaurant",
          tags: m.tags || [m.note || "restaurant"],
          address: m.address || "",
          addressUrl: m.addressUrl || "",
          mapPreviewImageUrl: m.mapPreviewImageUrl || "",
          openHours: m.openHours || "",
          description: m.description || "",
          reviewCount: m.reviewCount || null,
        };
      })
      .filter(r => r !== null && !isBlacklistedPlace(r));

    console.log("Loaded", RESTAURANTS.length, "places instantly from manual-data.js");
    render(); // ← render ngay lập tức, không chờ network
  }

  // ── Step 2: Try Overpass in background to supplement with nearby places ──
  // If it succeeds, merge new places (not already in manual) and re-render.
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
  ];

  for (const ep of endpoints) {
    try {
      const osmPlaces = await fetchNearbyFromOSM(SAIT.lat, SAIT.lon, 1000, ep);
      const filtered = filterManualDataItems(osmPlaces).filter(r => !isBlacklistedPlace(r));
      applyManualOverrides(filtered);
      const filteredAgain = filtered.filter(r => !isBlacklistedPlace(r));

      // Merge: keep manual-only places, add any OSM places already in whitelist
      const existingIds = new Set(RESTAURANTS.map(r => String(r.id)));
      const newPlaces = filteredAgain.filter(r => !existingIds.has(String(r.id)));
      if (newPlaces.length > 0) {
        RESTAURANTS = [...RESTAURANTS, ...newPlaces];
        console.log("Background refresh added", newPlaces.length, "places from", ep);
        render();
      }
      break;
    } catch (err) {
      console.warn("Overpass background refresh failed:", ep, err);
    }
  }
}

initRestaurants();

/* ===== Mascot Video Loop Guard ===== */
const mascotVideo = document.getElementById("mascotVideo");
const mascotPanel = document.querySelector(".mascot-panel");

if (mascotVideo) {
  let mascotAutoplayAttempts = 0;
  let mascotAutoplayTimer = null;

  const playMascot = (restart = false) => {
    if (restart) mascotVideo.currentTime = 0;
    const playPromise = mascotVideo.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  };

  const clearMascotAutoplayTimer = () => {
    if (mascotAutoplayTimer) {
      clearTimeout(mascotAutoplayTimer);
      mascotAutoplayTimer = null;
    }
  };

  const scheduleMascotAutoplay = () => {
    clearMascotAutoplayTimer();
    if (!mascotVideo.paused || mascotAutoplayAttempts >= 12) return;

    mascotAutoplayTimer = setTimeout(() => {
      mascotAutoplayAttempts += 1;
      playMascot();
      scheduleMascotAutoplay();
    }, 250);
  };

  const primeMascotAutoplay = () => {
    mascotAutoplayAttempts = 0;
    playMascot();
    scheduleMascotAutoplay();
  };

  mascotVideo.muted = true;
  mascotVideo.defaultMuted = true;
  mascotVideo.loop = true;
  mascotVideo.autoplay = true;
  mascotVideo.playsInline = true;
  mascotVideo.volume = 0;
  mascotVideo.setAttribute("muted", "");
  mascotVideo.setAttribute("autoplay", "");
  mascotVideo.setAttribute("loop", "");
  mascotVideo.setAttribute("playsinline", "");
  mascotVideo.setAttribute("webkit-playsinline", "");
  mascotVideo.controls = false;
  mascotVideo.preload = "auto";

  mascotVideo.addEventListener("loadedmetadata", () => {
    playMascot();
  });

  mascotVideo.addEventListener("loadeddata", () => {
    playMascot();
  });

  mascotVideo.addEventListener("canplay", () => {
    if (mascotVideo.paused) playMascot();
  });

  mascotVideo.addEventListener("playing", () => {
    mascotVideo.dataset.autoplayReady = "true";
    clearMascotAutoplayTimer();
  });

  mascotVideo.addEventListener("ended", () => {
    playMascot(true);
  });

  mascotVideo.addEventListener("pause", () => {
    if (!mascotVideo.ended) return;
    playMascot(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (mascotVideo.paused) {
      playMascot();
    }
  });

  window.addEventListener("pageshow", () => {
    if (mascotVideo.paused) {
      primeMascotAutoplay();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", primeMascotAutoplay, { once: true });
  } else {
    primeMascotAutoplay();
  }

  const resumeMascotFromGesture = () => {
    if (!mascotVideo.paused) return;
    playMascot();
  };

  mascotVideo.addEventListener("click", resumeMascotFromGesture);
  mascotVideo.addEventListener("touchstart", resumeMascotFromGesture, { passive: true });

  if (mascotPanel) {
    mascotPanel.addEventListener("click", resumeMascotFromGesture);
    mascotPanel.addEventListener("touchstart", resumeMascotFromGesture, { passive: true });
  }
}

/* ===== Help Modal Handler ===== */
const helpWidgetBtn = document.getElementById("helpWidgetBtn");
const helpModal = document.getElementById("helpModal");
const helpModalClose = document.getElementById("helpModalClose");
const submitFeedbackBtn = document.getElementById("submitFeedbackBtn");
const feedbackTextarea = document.getElementById("feedbackTextarea");
const toastNotification = document.getElementById("toastNotification");

if (helpWidgetBtn && helpModal && helpModalClose) {
  // Open modal on widget button click
  helpWidgetBtn.addEventListener("click", () => {
    helpModal.style.display = "flex";
  });

  // Close modal on close button click
  helpModalClose.addEventListener("click", () => {
    helpModal.style.display = "none";
  });

  // Close modal when clicking on the overlay (outside the content)
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) {
      helpModal.style.display = "none";
    }
  });

  // Close modal on Escape key press
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && helpModal.style.display === "flex") {
      helpModal.style.display = "none";
    }
  });
}

/* ===== Feedback Submit Handler ===== */
if (submitFeedbackBtn && feedbackTextarea && toastNotification) {
  submitFeedbackBtn.addEventListener("click", () => {
    const feedbackText = feedbackTextarea.value.trim();
    
    // Close modal and clear textarea
    helpModal.style.display = "none";
    feedbackTextarea.value = "";
    
    // Show toast notification
    toastNotification.style.display = "block";
    
    // Auto-hide toast after 3 seconds
    setTimeout(() => {
      toastNotification.style.display = "none";
    }, 3000);
    
    // Log feedback (for demo purposes)
    console.log("Feedback submitted:", feedbackText || "(empty)");
  });
}
