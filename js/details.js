/** ========= Helpers ========= */
function getParam(name){
  return new URLSearchParams(location.search).get(name);
}
function qs(id){ return document.getElementById(id); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
function money(n){
  if (typeof n !== "number") return "—";
  return `$${n.toFixed(2)}`;
}
function safeArray(a){ return Array.isArray(a) ? a : []; }
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function starsFromRating(r){
  if (typeof r !== "number" || !Number.isFinite(r)) return "";
  const full = clamp(Math.round(r), 0, 5);
  return "★".repeat(full) + "☆".repeat(5 - full);
}
function simulateRatingFromName(name){
  const s = String(name || "");
  const seed = s.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return 3.2 + (seed % 11) / 10;
}
function underTierFromSpend(min, max){
  const n = typeof max === "number" ? max : (typeof min === "number" ? min : null);
  if (n == null) return null;
  if (n <= 5) return "Under $5";
  if (n <= 10) return "Under $10";
  if (n <= 20) return "Under $20";
  return null;
}
function walkingMinutes(distKm){
  return Math.max(1, Math.round(distKm / 0.08));
}

function initRadiusPicker(){
  const radiusSelect = qs("radius");
  const radiusToggle = qs("radiusToggle");
  const radiusLabel = qs("radiusLabel");
  const radiusMenu = qs("radiusMenu");
  const radiusOptions = qsa(".radius-option");
  if (!radiusSelect || !radiusToggle || !radiusLabel || !radiusMenu || radiusOptions.length === 0) return;

  const closeMenu = () => {
    radiusMenu.hidden = true;
    radiusToggle.setAttribute("aria-expanded", "false");
  };

  const syncRadiusUI = (value) => {
    const selectedOption = radiusOptions.find(option => option.dataset.value === String(value)) || radiusOptions[0];
    radiusLabel.textContent = selectedOption.textContent.trim();
    radiusOptions.forEach((option) => {
      option.setAttribute("aria-selected", String(option === selectedOption));
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

let MANUAL = { version: 1, byId: {} };

async function loadManualData(){
  // The project now ships its manual overrides as a plain JS file
  // (`data/manual-data.js`) so that data can be consumed even when the
  // pages are opened via file:// (fetching JSON would otherwise be blocked).
  // Just copy the global into our local variable.
  if (window.MANUAL_DATA && typeof window.MANUAL_DATA === "object") {
    MANUAL = window.MANUAL_DATA;
  }
  // no network request is performed; the separate JSON file has been
  // removed from the repo.
}

function applyManualOverrides(place){
  const p = { ...(place || {}) };
  const m = MANUAL?.byId?.[String(p.id)];
  if (!m) return p;
  
  // Copy all manual fields, normalizing image paths
  const normalizeImageUrl = (url) => {
    return (typeof url === 'string' && url.trim()) ? url.trim().replace(/^\.\//, '') : url;
  };
  
  const normalizeMenuArray = (arr) => {
    return safeArray(arr).map(item => ({
      ...item,
      imageUrl: normalizeImageUrl(item.imageUrl)
    }));
  };
  
  if (typeof m.name === "string" && m.name.trim()) p.name = m.name.trim();
  if (typeof m.rating === "number") p.rating = m.rating;
  if (typeof m.priceAvg === "number") p.priceAvg = m.priceAvg;
  if (typeof m.imageUrl === "string") p.imageUrl = normalizeImageUrl(m.imageUrl);
  if (typeof m.address === "string" && m.address.trim()) p.address = m.address.trim();
  if (typeof m.addressUrl === "string" && m.addressUrl.trim()) p.addressUrl = m.addressUrl.trim();
  if (typeof m.mapPreviewImageUrl === "string" && m.mapPreviewImageUrl.trim()) p.mapPreviewImageUrl = normalizeImageUrl(m.mapPreviewImageUrl);
  if (typeof m.openHours === "string" && m.openHours.trim()) p.openHours = m.openHours.trim();
  if (typeof m.reviewCount === "number") p.reviewCount = m.reviewCount;
  
  // Copy all menu-related arrays from manual data
  if (Array.isArray(m.deals)) p.deals = normalizeMenuArray(m.deals);
  if (Array.isArray(m.most_student_orders)) p.most_student_orders = normalizeMenuArray(m.most_student_orders);
  if (Array.isArray(m.whats_available)) p.whats_available = normalizeMenuArray(m.whats_available);
  if (Array.isArray(m.best_deals)) p.best_deals = normalizeMenuArray(m.best_deals);
  
  // Copy description if present
  if (typeof m.description === "string" && m.description.trim()) p.description = m.description.trim();
  
  return p;
}

function detailsFromManual(place){
  // Gather possible menu sources from manual record. Prefer rich menu arrays
  // (most_student_orders, whats_available, best_deals) over the basic deals array.
  // Now always include all, with priority order: most_student_orders, best_deals, whats_available, deals
  
  const sources = [
    ...safeArray(place?.most_student_orders),
    ...safeArray(place?.best_deals),
    ...safeArray(place?.whats_available),
    ...safeArray(place?.deals)
  ];

  // Normalize and dedupe by name (case-insensitive)
  const byName = Object.create(null);
  sources.forEach((d) => {
    if (!d || typeof d.name !== 'string' || !d.name.trim()) return;
    const key = String(d.name).trim().toLowerCase();
    const existing = byName[key];
    const candidate = {
      item: String(d.name).trim(),
      price: Number.isFinite(Number(d.price)) ? Number(d.price) : undefined,
      note: d.description || d.note || "",
      imageUrl: (typeof d.imageUrl === 'string' && d.imageUrl.trim()) ? d.imageUrl.trim().replace(/^\.\//, '') : "",
      badge: (typeof d.badge === 'string') ? d.badge.replace('_', '-').toLowerCase() : 'best-value'
    };

    if (!existing) {
      byName[key] = candidate;
      return;
    }

    // Merge: keep imageUrl if candidate has it; keep numeric price if candidate has it.
    if (!existing.imageUrl && candidate.imageUrl) existing.imageUrl = candidate.imageUrl;
    if ((existing.price === undefined || !Number.isFinite(existing.price)) && Number.isFinite(candidate.price)) existing.price = candidate.price;
    if (!existing.note && candidate.note) existing.note = candidate.note;
    if (existing.badge === 'best-value' && candidate.badge && candidate.badge !== 'best-value') existing.badge = candidate.badge;
  });

  const deals = Object.keys(byName).map(k => byName[k]);

  // grab any manual review entries, normalizing field names
  const manualReviews = safeArray(MANUAL?.byId?.[String(place.id)]?.reviews).map(rv => {
    return {
      rating: rv.rating,
      text: rv.review_text || rv.text || "",
      who: rv.reviewer_name || rv.who || "",
      when: rv.review_time || rv.when || ""
    };
  });

  if (!deals.length && !manualReviews.length) return null;
  const prices = deals.map(d => d.price).filter(n => Number.isFinite(n));
  return {
    spendMin: prices.length ? Math.round(Math.min(...prices)) : undefined,
    spendMax: prices.length ? Math.round(Math.max(...prices)) : undefined,
    valueScore: "—", portion: "—", wait: "—",
    summary: "Deals below are manually maintained for accuracy.",
    menu: deals,
    reviews: manualReviews
  };
}

function loadPlacesFromStorage(){
  try{ return JSON.parse(localStorage.getItem("unidbite_places") || "[]"); }catch{ return []; }
}

const FALLBACK = {
  id: "demo_1",
  name: "Demo Cafe (Preview)",
  note: "cafe • student-friendly",
  tags: ["cafe","coffee","quick"],
  _distKm: 0.62,
  imageUrl: "",
  address: "123 Example St NW, Calgary, AB",
  openHours: "Open until 7:00 PM",
  reviewCount: 4,
  rating: 4.1,
  description: "",
  details: {
    spendMin: 4, spendMax: 12, valueScore: "8.5/10", portion: "Medium", wait: "Low",
    summary: "Good for a fast coffee + snack between classes. Best value is under $10 if you keep it simple.",
    menu: [
      { item: "Iced coffee", price: 4.50, note: "Best under $5", imageUrl: "", badge: "best-value" },
      { item: "Breakfast sandwich", price: 7.95, note: "Filling for under $10", imageUrl: "", badge: "best-value" },
      { item: "Soup + bun", price: 9.50, note: "Warm & budget-friendly", imageUrl: "", badge: "student-friendly" }
    ],
    menuSource: "Menu items/prices should be verified from public sources.",
    reviews: [
      { who:"SAIT student", when:"2 days ago", rating: 4, text:"Quick and cheap. Coffee is decent. Sandwich is the best deal." },
      { who:"SAIT student", when:"1 week ago", rating: 4, text:"Good value under $10. Line moves fast." },
      { who:"SAIT student", when:"3 weeks ago", rating: 3.5, text:"Pastry was okay but service was slow." },
      { who:"SAIT student", when:"1 month ago", rating: 4.7, text:"Loved the caramel macchiato, perfect study spot." },
      { who:"SAIT student", when:"2 months ago", rating: 4.2, text:"Solid coffee for the price and friendly staff." }
    ]
  }
};

function normalizePlace(p){
  const manualDetails = detailsFromManual(p);
  return {
    id: p.id || FALLBACK.id,
    name: p.name || FALLBACK.name,
    note: p.note || p.amenity || FALLBACK.note,
    tags: safeArray(p.tags).length ? p.tags : FALLBACK.tags,
    _distKm: (typeof p._distKm === "number") ? p._distKm : (typeof p.distKm === "number" ? p.distKm : FALLBACK._distKm),
    imageUrl: p.imageUrl || FALLBACK.imageUrl,
    address: p.address || FALLBACK.address,
    addressUrl: p.addressUrl || "",
    mapPreviewImageUrl: p.mapPreviewImageUrl || "",
    openHours: p.openHours || FALLBACK.openHours,
    reviewCount: (typeof p.reviewCount === "number") ? p.reviewCount : FALLBACK.reviewCount,
    rating: p.rating,
    description: p.description || "",
    details: p.details || manualDetails || FALLBACK.details
  };
}

/** Build a single menu item card */
function buildMenuCard(m, showArrow){
  const card = document.createElement("div");
  card.className = "menu-item-card";

  const thumbHtml = m.imageUrl
    ? `<img class="menu-item-thumb" src="${m.imageUrl}" alt="${m.item}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';" /><div class="menu-item-thumb-placeholder" style="display:none;">🍽️</div>`
    : `<div class="menu-item-thumb-placeholder">🍽️</div>`;

  const badgeClass = m.badge === "student-friendly" ? "badge-student-friendly" : "badge-best-value";
  const badgeLabel = m.badge === "student-friendly" ? "Student-friendly" : "Best Value";

  card.innerHTML = `
    ${thumbHtml}
    <div class="menu-item-info">
      <div class="menu-item-name">${m.item}</div>
      <div class="menu-item-price">${money(m.price)}</div>
      ${m.note ? `<div class="menu-item-note">${m.note}</div>` : ""}
    </div>
    <span class="menu-item-badge ${badgeClass}">${badgeLabel}</span>
    ${showArrow ? `<div class="menu-item-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>` : ""}
  `;
  return card;
}

/** ========= Render ========= */
function render(place){
  const p = normalizePlace(place);
  const effectiveRating = (typeof p.rating === "number" && Number.isFinite(p.rating))
    ? p.rating : simulateRatingFromName(p.name);

  // Hero image
  const heroImg = qs("heroImg");
  const heroPlaceholder = qs("heroPlaceholder");
  if (p.imageUrl && heroImg) {
    heroImg.src = p.imageUrl;
    heroImg.alt = p.name;
    heroImg.style.display = "block";
    if (heroPlaceholder) heroPlaceholder.style.display = "none";
  }

  // Title
  const nameEl = qs("name");
  if (nameEl) nameEl.textContent = p.name;

  // Meta distance
  const metaDist = qs("metaDist");
  if (metaDist) {
    const walkMin = walkingMinutes(p._distKm);
    metaDist.textContent = `${p._distKm.toFixed(1)} km · ${walkMin}m (Earliest arrival)`;
  }

  // Pills
  const pillRow = qs("pillRow");
  if (pillRow) {
    pillRow.innerHTML = "";

    const ratingPill = document.createElement("div");
    ratingPill.className = "pill pill-rating";
    const reviewCountBadge = Number.isFinite(p.reviewCount) ? p.reviewCount : 4;
    ratingPill.textContent = `★ ${effectiveRating.toFixed(1)} (+${reviewCountBadge})`;
    pillRow.appendChild(ratingPill);

    const isStudent = (p.note || "").toLowerCase().includes("student") || safeArray(p.tags).some(t => /coffee|cafe|fast food/i.test(String(t)));
    if (isStudent) {
      const sp = document.createElement("div");
      sp.className = "pill pill-student";
      sp.textContent = "Student-friendly";
      pillRow.appendChild(sp);
    }

    const tier = underTierFromSpend(p.details?.spendMin, p.details?.spendMax);
    if (tier) {
      const tp = document.createElement("div");
      tp.className = "pill pill-under";
      tp.textContent = tier;
      pillRow.appendChild(tp);
    }

    const bestPill = document.createElement("div");
    bestPill.className = "pill pill-best";
    bestPill.textContent = "Best Value";
    pillRow.appendChild(bestPill);
  }

  // Description (restaurant-level).  Manual data may supply a `description` field
  // which should take precedence over the generic menu summary used previously.
  const summary = qs("summary");
  if (summary) {
    const fullText = p.description || p.details?.summary || "—";
    const limit = 170;
    summary.dataset.full = fullText;
    const renderCollapsed = () => {
      if (fullText.length <= limit) { summary.textContent = fullText; return; }
      const short = fullText.slice(0, limit).replace(/\s+\S*$/, "");
      summary.innerHTML = `${short}… <button type="button" class="link-btn summary-toggle">Show more</button>`;
      summary.querySelector(".summary-toggle").onclick = () => {
        summary.innerHTML = `${fullText} <button type="button" class="link-btn summary-toggle">Show less</button>`;
        summary.querySelector(".summary-toggle").onclick = () => renderCollapsed();
      };
    };
    renderCollapsed();
  }

  // Address + hours
  const addressText = qs("addressText");
  if (addressText) {
    if (p.addressUrl) {
      addressText.innerHTML = `<a href="${p.addressUrl}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;cursor:pointer;border-bottom:1px dotted var(--muted)">${p.address || "—"}</a>`;
    } else {
      addressText.textContent = p.address || "—";
    }
  }
  // ── Open Hours ──
  const hoursTitle   = qs("hoursTitle");
  const openText     = qs("openText");
  const hoursCardMap = document.getElementById("hoursCardMap");
  const mapPreviewEl = qs("mapPreview");

  if (openText) {
    const raw   = (p.openHours || "").trim();
    const lines = raw ? raw.split(/\n/).map(l => l.trim()).filter(Boolean) : [];

    // Day label → JS getDay() index
    const DAY_IDX = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const todayIdx = new Date().getDay();
    const todayLabel = DAY_LABELS[todayIdx];

    // Parse each line: split on 2+ spaces or tab → { day, time }
    const parsed = lines.map(line => {
    const match = line.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s*(.*)$/i);
    if (!match) return null;
     return {
      day: match[1],
      time: match[2].trim() || "Closed"
      };
    }).filter(Boolean);

    // Find today's entry
    const todayEntry = parsed.find(r => r.day === todayLabel);
    const previewStr = `${todayEntry.day}: ${todayEntry.time}`;

    // ── Collapsed preview ──
    const preview = document.createElement("div");
    preview.className = "hours-preview hours-row is-today";
    preview.textContent = previewStr;
    openText.appendChild(preview);

    if (parsed.length > 1) {
      const panel = document.createElement("div");
      panel.className = "hours-panel";
      panel.style.height = "0";
      panel.style.overflow = "hidden";

      const fullBlock = document.createElement("div");
      fullBlock.className = "hours-full";

      parsed.forEach(({ day, time }) => {
      const isToday = day === todayLabel;

      const row = document.createElement("div");
      row.className = "hours-row" + (isToday ? " is-today" : "");
      row.textContent = `${day}: ${time}`;
      fullBlock.appendChild(row);
    });
      panel.appendChild(fullBlock);
      openText.appendChild(panel);

      const animatePanel = (expanded) => {
        if (expanded) {
          preview.classList.add("hidden");
          fullBlock.classList.add("visible");
          const targetHeight = fullBlock.scrollHeight;
          panel.style.height = `${targetHeight}px`;

          const finish = (event) => {
            if (event.target === panel && event.propertyName === "height") {
              panel.style.height = "auto";
              panel.removeEventListener("transitionend", finish);
            }
          };
          panel.addEventListener("transitionend", finish);
        } else {
          const currentHeight = panel.scrollHeight;
          panel.style.height = `${currentHeight}px`;
          requestAnimationFrame(() => {
            panel.style.height = "0";
          });
          fullBlock.classList.remove("visible");
          preview.classList.remove("hidden");
        }
      };

      if (hoursTitle && !hoursTitle.querySelector(".hours-toggle-btn")) {
        hoursTitle.classList.add("hours-title-row");
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "hours-toggle-btn";
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.innerHTML = `<svg class="hours-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>`;
        hoursTitle.appendChild(toggleBtn);

        let expanded = false;
        toggleBtn.addEventListener("click", () => {
          expanded = !expanded;
          animatePanel(expanded);
          toggleBtn.setAttribute("aria-expanded", String(expanded));
          const chevron = toggleBtn.querySelector(".hours-chevron");
          if (chevron) {
            chevron.style.transform = expanded ? "rotate(180deg)" : "";
          }
        });
      }
    }
  }

  // Map preview image + link
  const mapPreviewLink = qs("mapPreviewLink");
  const mapPreview = qs("mapPreview");
  
  // Set map link: use addressUrl if available, fallback to Google Maps from coordinates
  if (mapPreviewLink) {
    if (p.addressUrl) {
      mapPreviewLink.href = p.addressUrl;
    } else if (p.lat && p.lon) {
      // Fallback: generate Google Maps link from coordinates
      mapPreviewLink.href = `https://www.google.com/maps?q=${p.lat},${p.lon}`;
    } else {
      // No link available
      mapPreviewLink.style.cursor = "default";
      mapPreviewLink.removeAttribute("target");
      mapPreviewLink.removeAttribute("rel");
      mapPreviewLink.onclick = (e) => e.preventDefault();
    }
  }
  
  if (mapPreview) {
    if (p.mapPreviewImageUrl) {
      mapPreview.style.backgroundImage = `url('${p.mapPreviewImageUrl}')`;
      mapPreview.style.backgroundSize = "cover";
      mapPreview.style.backgroundPosition = "center";
      mapPreview.style.backgroundRepeat = "no-repeat";
    } else {
      // Keep the placeholder marker
      mapPreview.innerHTML = '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:20px;">📍</div>';
    }
  }

  // Ratings
  const ratingScore = qs("ratingScore");
  if (ratingScore) ratingScore.textContent = effectiveRating.toFixed(1);
  const ratingStars = qs("ratingStars");
  if (ratingStars) ratingStars.textContent = starsFromRating(effectiveRating);
  const reviewCount = qs("reviewCount");
  if (reviewCount) {
    const displayedReviewCount = Number.isFinite(p.reviewCount) ? p.reviewCount : "4+";
    const reviewLabel = displayedReviewCount === 1 ? "Review" : "Reviews";
    reviewCount.textContent = `${displayedReviewCount} ${reviewLabel}`;
  }

  const reviewList = qs("reviewList");
  if (reviewList) {
    reviewList.innerHTML = "";
    const allReviews = safeArray(p.details.reviews).slice(0, 5);
    if (!allReviews.length) return;

    function buildReviewEl(rv) {
      const el = document.createElement("div");
      el.className = "review-item";
      const initials = (rv.who || "Student").trim().charAt(0).toUpperCase();
      el.innerHTML = `
        <div class="rv-row">
          <div class="rv-left">
            <span class="avatar">${initials}</span>
            <span class="rv-who">${rv.who || "Student"}</span>
            <span class="rv-stars">${starsFromRating(rv.rating || 4)}</span>
          </div>
          <span class="rv-when">${rv.when || ""}</span>
        </div>
        <div class="rv-text">${rv.text || ""}</div>
      `;
      return el;
    }

    // Always show first review
    reviewList.appendChild(buildReviewEl(allReviews[0]));

    if (allReviews.length > 1) {
      // Hidden container for the rest
      const extraContainer = document.createElement("div");
      extraContainer.className = "reviews-extra";
      extraContainer.style.display = "none";
      allReviews.slice(1).forEach(rv => extraContainer.appendChild(buildReviewEl(rv)));
      reviewList.appendChild(extraContainer);

      // Show more / show less button
      const remaining = allReviews.length - 1;
      const showMoreBtn = document.createElement("button");
      showMoreBtn.type = "button";
      showMoreBtn.className = "reviews-toggle-btn";
      showMoreBtn.innerHTML = `
        <span class="reviews-toggle-label">Show ${remaining} more review${remaining > 1 ? "s" : ""}</span>
        <svg class="reviews-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
      `;

      let revExpanded = false;
      showMoreBtn.addEventListener("click", () => {
        revExpanded = !revExpanded;
        extraContainer.style.display = revExpanded ? "flex" : "none";
        extraContainer.style.flexDirection = "column";
        extraContainer.style.gap = "8px";
        showMoreBtn.querySelector(".reviews-toggle-label").textContent = revExpanded
          ? "Show less"
          : `Show ${remaining} more review${remaining > 1 ? "s" : ""}`;
        showMoreBtn.querySelector(".reviews-chevron").style.transform = revExpanded ? "rotate(180deg)" : "rotate(0deg)";
      });

      reviewList.appendChild(showMoreBtn);
    }
  }

  // Menu sections
  const allMenu = safeArray(p.details.menu);

  // Most Student Orders — first 2 items, 2-col grid
  const studentOrdersList = qs("studentOrdersList");
  if (studentOrdersList) {
    studentOrdersList.innerHTML = "";
    allMenu.slice(0, 2).forEach(m => studentOrdersList.appendChild(buildMenuCard(m, false)));
    if (!allMenu.length) qs("studentOrdersSection").style.display = "none";
  }

  // Best Deals For Students — items with badge === student-friendly, or 3rd item
  const bestDealsList = qs("bestDealsList");
  if (bestDealsList) {
    bestDealsList.innerHTML = "";
    const deals = allMenu.filter(m => m.badge === "student-friendly");
    const showDeals = deals.length ? deals : (allMenu.length > 2 ? [allMenu[2]] : []);
    showDeals.forEach(m => bestDealsList.appendChild(buildMenuCard(m, false)));
    if (!showDeals.length) qs("bestDealsSection").style.display = "none";
  }

  // What's Available — all items, 2-col grid
  const availableList = qs("availableList");
  if (availableList) {
    availableList.innerHTML = "";
    allMenu.forEach(m => availableList.appendChild(buildMenuCard(m, false)));
    if (!allMenu.length) qs("availableSection").style.display = "none";
  }

  const menuSource = qs("menuSource");
  if (menuSource) menuSource.textContent = p.details.menuSource || "";

  // Debug: log resolved menu items and image paths to help diagnose missing images
  try{
    console.debug && console.debug('Details menu for', p.name, p.details.menu);
  }catch(e){ /* ignore */ }
}

/** ========= Wire actions ========= */
function updateSideVisibility(){
  // No dedicated side panel now — cards are inline in address col
}

qsa("[data-dismiss]").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.getAttribute("data-dismiss");
    const el = document.querySelector(target);
    if (el) el.style.display = "none";
    // also hide overlay if one exists
    if (target === "#pricesInfoCard" || target === "#reviewsInfoCard") {
      hideInfoCard(target);
    }
  });
});

function showInfoCard(id) {
  const card = qs(id);
  const overlay = qs("infoOverlay");
  if (!card || !overlay) return;
  overlay.style.display = "block";
  card.style.display = "block";
}
function hideInfoCard(id) {
  const card = qs(id);
  const overlay = qs("infoOverlay");
  if (card) card.style.display = "none";
  if (overlay) overlay.style.display = "none";
}
qs("pricingInfoTrigger")?.addEventListener("click", () => showInfoCard("pricesInfoCard"));
qs("ratingsInfoTrigger")?.addEventListener("click", () => showInfoCard("reviewsInfoCard"));

document.addEventListener("click", (e) => {
  const overlay = qs("infoOverlay");
  if (overlay && e.target === overlay) {
    // click outside info card
    hideInfoCard("pricesInfoCard");
    hideInfoCard("reviewsInfoCard");
  }
});

qs("radius")?.addEventListener("change", e => {
  localStorage.setItem("unidbite_radiusKm", String(e.target.value));
});
qs("q")?.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  localStorage.setItem("unidbite_query", String(e.target.value || "").trim());
  location.href = "./index.html";
});

function findPlace(id){
  const places = loadPlacesFromStorage();
  const found = places.find(p => String(p.id) === String(id));
  if (found) return applyManualOverrides(found);

  // When the page is opened directly (or localStorage was cleared) we
  // still want to honour any manual record with the same id.  MANUAL may
  // contain a partial object, so spread it and give it the id explicitly.
  const manual = MANUAL?.byId?.[String(id)];
  if (manual) {
    return applyManualOverrides({ id, ...manual });
  }

  return FALLBACK;
}

(async function init(){
  await loadManualData();
  const id = getParam("id") || FALLBACK.id;
  const savedRadius = localStorage.getItem("unidbite_radiusKm");
  if (savedRadius && qs("radius")) qs("radius").value = savedRadius;
  initRadiusPicker();
  render(findPlace(id));

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
})();
