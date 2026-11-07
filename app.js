(function () {
  "use strict";

  window.PLAY_DATA_BY_COUNTRY = window.PLAY_DATA_BY_COUNTRY || {};
  if (window.PLAY_DATA && !window.PLAY_DATA_BY_COUNTRY["IN"]) {
    window.PLAY_DATA_BY_COUNTRY["IN"] = window.PLAY_DATA;
  }

  let DATA = window.PLAY_DATA_BY_COUNTRY["IN"] || window.PLAY_DATA || { meta: {}, apps: [], snapshots: {} };
  let META = DATA.meta || {};
  let ALL_APPS = DATA.apps || [];
  let SNAPSHOTS = DATA.snapshots || {};

  const BUCKET_LABELS = {
    0: "0+",
    1: "1+",
    5: "5+",
    10: "10+",
    50: "50+",
    100: "100+",
    500: "500+",
    1000: "1K+",
    5000: "5K+",
    10000: "10K+",
    50000: "50K+",
    100000: "1L+",
    500000: "5L+",
    1000000: "10L+",
    5000000: "50L+",
    10000000: "1Cr+",
    50000000: "5Cr+",
    100000000: "10Cr+",
    500000000: "50Cr+",
    1000000000: "100Cr+",
    5000000000: "500Cr+",
    10000000000: "1000Cr+",
  };

  const TARGET_BUCKETS = [50000, 100000, 500000, 1000000];
  const TARGET_BUCKET_META = [
    { key: "ALL_4", min: null, label: "All 4 Tiers (50K–10L)", short: "All 50K–10L" },
    { key: "50000", min: 50000, label: "50K Downloads (50,000+)", short: "50K+" },
    { key: "100000", min: 100000, label: "1L Downloads (1,00,000+)", short: "1L+" },
    { key: "500000", min: 500000, label: "5L Downloads (5,00,000+)", short: "5L+" },
    { key: "1000000", min: 1000000, label: "10L Downloads (10,00,000+)", short: "10L+" },
  ];

  // Map category ID -> human label
  let CAT_LABELS = {};
  // Fast lookup package_name -> app object & developer -> apps list
  let APP_BY_PKG = {};
  let APPS_BY_DEV = {};

  function rebuildLookups() {
    CAT_LABELS = {};
    (META.categories || []).forEach((c) => {
      CAT_LABELS[c.id] = c.label;
    });
    APP_BY_PKG = {};
    APPS_BY_DEV = {};
    ALL_APPS.forEach((a) => {
      APP_BY_PKG[a.p] = a;
      const dName = a.d || "Unknown";
      if (!APPS_BY_DEV[dName]) APPS_BY_DEV[dName] = [];
      APPS_BY_DEV[dName].push(a);
    });
  }
  rebuildLookups();

  // Description shard cache
  const DESC_CACHE = {};
  const DESC_LOADING = {};
  window.__registerDescShard = function (shard, map) {
    DESC_CACHE[shard] = map || {};
    if (DESC_LOADING[shard]) {
      DESC_LOADING[shard].forEach((cb) => cb(DESC_CACHE[shard]));
      delete DESC_LOADING[shard];
    }
  };

  function loadDescription(pkg, shard, callback) {
    if (!shard) {
      callback(null);
      return;
    }
    if (DESC_CACHE[shard]) {
      callback(DESC_CACHE[shard][pkg] || null);
      return;
    }
    if (!DESC_LOADING[shard]) {
      DESC_LOADING[shard] = [];
      const s = document.createElement("script");
      s.src = "data/desc/" + encodeURIComponent(shard) + ".js";
      s.onerror = function () {
        window.__registerDescShard(shard, {});
      };
      document.body.appendChild(s);
    }
    DESC_LOADING[shard].push((map) => callback(map[pkg] || null));
  }

  // UI State
  const state = {
    country: "IN", // 'IN' | 'US'
    activeTab: "month", // 'all' | 'yesterday' | 'week' | 'month'
    global: {
      verticals: new Set(["apps"]),
      monetization: new Set(["none"]),
    },
    all: {
      search: "",
      category: "ALL",
      tier: "ALL",
      age: "ALL",
      rating: "ALL",
      sortCol: "vel",
      sortDir: "desc",
      page: 1,
      pageSize: 100,
      filtered: [],
    },
    comp: {
      baselineRun: null,
      category: "ALL",
      search: "",
      // Breakout section state
      breakoutBucket: "ALL_4", // 'ALL_4' | '50000' | '100000' | '500000' | '1000000'
      breakoutMode: "ALL", // 'ALL' | 'NEW_CHART' | 'TIER_UP'
      breakoutAge: "ALL",
      breakoutSortCol: "vel",
      breakoutSortDir: "desc",
      breakoutPage: 1,
      breakoutPageSize: 100,
      breakoutRows: [],
      // Movement section state
      movementMode: "ALL", // 'ALL' | 'GAINED' | 'SURGE' | 'LOST' | 'NEW' | 'DROPPED' | 'SAME'
      movementTier: "ALL",
      movementSortCol: "vel",
      movementSortDir: "desc",
      movementPage: 1,
      movementPageSize: 100,
      movementRows: [],
      allCompRows: [],
    },
    devModal: {
      devName: null,
      apps: [],
      sortCol: "vel",
      sortDir: "desc",
    },
  };

  // Formatting Helpers
  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtNum(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString("en-IN");
  }

  function fmtSigned(n) {
    if (n === null || n === undefined || Number.isNaN(n) || n === 0) return "0";
    return (n > 0 ? "+" : "") + Number(n).toLocaleString("en-IN");
  }

  function fmtBucket(im) {
    if (im === null || im === undefined) return "—";
    return BUCKET_LABELS[im] || fmtNum(im) + "+";
  }

  function fmtPrice(a) {
    if (!a || !(a.pr > 0)) return "";
    const sym = a.cur === "USD" || state.country === "US" ? "$" : "₹";
    return sym + a.pr;
  }

  function playStoreUrl(pkg) {
    const gl = state.country || "IN";
    const hl = gl === "US" ? "en_US" : "en_IN";
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=${hl}&gl=${gl}`;
  }

  function renderDevLink(devName) {
    const d = devName || "Unknown";
    const count = (APPS_BY_DEV[d] || []).length;
    const multiBadge = count > 1 ? `<span class="sub-detail" title="${count} apps by this developer">(${count})</span>` : "";
    return `<button type="button" class="dev-link" data-dev="${esc(d)}" title="View all ${count} app(s) by ${esc(d)}">${esc(d)}</button>${multiBadge}`;
  }

  function matchesTierFilter(im, filterVal) {
    if (filterVal === "ALL") return true;
    if (im === null || im === undefined) return false;
    if (filterVal === "EARLY_ALL") return im <= 1000000;
    if (filterVal === "TARGET_4") return TARGET_BUCKETS.includes(im);
    if (filterVal === "UNDER_50K") return im < 50000;
    if (filterVal === "10000000_PLUS") return im >= 10000000;
    if (filterVal === "5000000_PLUS") return im >= 5000000;
    return im === Number(filterVal);
  }

  function matchesSearch(app, q) {
    if (!q) return true;
    const hay = (
      (app.t || "") +
      " " +
      (app.p || "") +
      " " +
      (app.d || "") +
      " " +
      (app.cl || "") +
      " " +
      (app.sd || "") +
      " " +
      (app.em || "")
    ).toLowerCase();
    return hay.includes(q);
  }

  function inferVertical(app) {
    if (app.v) return app.v;
    const cl = app.cl || "";
    const c = app.c || "";
    if (cl === "Education" || cl === "Educational" || c === "EDUCATION" || c === "GAME_EDUCATIONAL" || c === "FAMILY_EDUCATION") {
      return "education";
    }
    if (c.startsWith("GAME")) return "games";
    return "apps";
  }

  function matchesUniversalFilters(app) {
    const v = inferVertical(app);
    if (!state.global.verticals.has(v)) return false;

    const hasIap = Boolean(app.iap);
    const hasAds = Boolean(app.ads);
    const hasNone = !hasIap && !hasAds;
    const m = state.global.monetization;
    if (
      (m.has("iap") && hasIap) ||
      (m.has("ads") && hasAds) ||
      (m.has("none") && hasNone)
    ) {
      return true;
    }
    return false;
  }

  function updateUniversalFilterCountsAndBadges() {
    const latestApps = ALL_APPS.filter((a) => a.il === 1);
    const vCounts = { apps: 0, games: 0, education: 0 };
    const mCounts = { iap: 0, ads: 0, none: 0 };

    latestApps.forEach((a) => {
      const v = inferVertical(a);
      if (vCounts[v] !== undefined) vCounts[v]++;
      const hasIap = Boolean(a.iap);
      const hasAds = Boolean(a.ads);
      if (hasIap) mCounts.iap++;
      if (hasAds) mCounts.ads++;
      if (!hasIap && !hasAds) mCounts.none++;
    });

    ["apps", "games", "education"].forEach((k) => {
      const el = document.getElementById("uCountVert-" + k);
      if (el) el.textContent = fmtNum(vCounts[k]);
    });
    ["iap", "ads", "none"].forEach((k) => {
      const el = document.getElementById("uCountMon-" + k);
      if (el) el.textContent = fmtNum(mCounts[k]);
    });

    const latestUniversal = latestApps.filter(matchesUniversalFilters);
    document.getElementById("badgeCount-all").textContent = fmtNum(latestUniversal.length);

    const snapRuns = (META.snapshot_runs || []).filter((r) => r !== META.latest_run).reverse();
    ["yesterday", "week", "month"].forEach((key) => {
      const compCfg = (META.comparisons || {})[key] || {};
      const bRun = compCfg.baseline_run || snapRuns[0] || META.latest_run;
      const count = countBreakoutsForBaseline(bRun);
      const badge = document.getElementById("badgeCount-" + key);
      if (badge) badge.textContent = fmtNum(count) + " new";
    });

    const isDefault =
      state.global.verticals.size === 1 &&
      state.global.verticals.has("apps") &&
      state.global.monetization.size === 1 &&
      state.global.monetization.has("none");
    const resetBtn = document.getElementById("globalResetBtn");
    if (resetBtn) resetBtn.hidden = isDefault;
  }

  function getAppRankForCategory(app, catId) {
    if (catId === "ALL") return app.br;
    return app.rk && app.rk[catId] !== undefined ? app.rk[catId] : null;
  }

  function getSnapRankForCategory(snapObj, catId) {
    if (!snapObj) return null;
    if (catId === "ALL") return snapObj.br;
    return snapObj.rk && snapObj.rk[catId] !== undefined ? snapObj.rk[catId] : null;
  }

  // ==================== INITIALIZATION & COUNTRY SWITCHING ====================
  const COUNTRY_SCRIPT_LOADING = {};
  window.__onCountryDataLoaded = function (countryCode) {
    if (COUNTRY_SCRIPT_LOADING[countryCode]) {
      const cbs = COUNTRY_SCRIPT_LOADING[countryCode];
      delete COUNTRY_SCRIPT_LOADING[countryCode];
      cbs.forEach((cb) => cb());
    }
  };

  function hydrateCountryUI() {
    // Header metadata
    const latestApps = ALL_APPS.filter((a) => a.il === 1);
    document.getElementById("metaLatestRun").textContent = META.latest_run || "—";
    document.getElementById("metaUniqueApps").textContent = fmtNum(latestApps.length);
    document.getElementById("metaRunsCount").textContent = fmtNum((META.runs || []).length);
    document.getElementById("metaGeneratedAt").textContent = META.generated_at || "—";
    document.getElementById("badgeCount-all").textContent = fmtNum(latestApps.length);

    // Populate Category Selects (preserve selection if valid)
    const catSelects = [
      document.getElementById("allCategorySelect"),
      document.getElementById("compGlobalCatSelect"),
    ];
    const groups = { Apps: [], Games: [], Family: [] };
    (META.categories || []).forEach((c) => {
      if (!groups[c.group]) groups[c.group] = [];
      groups[c.group].push(c);
    });
    catSelects.forEach((sel) => {
      const prevVal = sel.value || "ALL";
      sel.innerHTML = `<option value="ALL">All 60 Categories</option>`;
      Object.keys(groups).forEach((gName) => {
        if (!groups[gName].length) return;
        const og = document.createElement("optgroup");
        og.label = gName;
        groups[gName].forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = c.label + " (" + c.id + ")";
          og.appendChild(opt);
        });
        sel.appendChild(og);
      });
      if (prevVal === "ALL" || CAT_LABELS[prevVal]) {
        sel.value = prevVal;
      } else {
        sel.value = "ALL";
      }
    });
    state.all.category = document.getElementById("allCategorySelect").value;
    state.comp.category = document.getElementById("compGlobalCatSelect").value;

    // Populate Baseline Run Selector
    const baseSelect = document.getElementById("compBaselineSelect");
    baseSelect.innerHTML = "";
    const snapRuns = (META.snapshot_runs || []).filter((r) => r !== META.latest_run).reverse();
    if (snapRuns.length === 0 && META.latest_run) {
      const opt = document.createElement("option");
      opt.value = META.latest_run;
      opt.textContent = META.latest_run + " (Same Run)";
      baseSelect.appendChild(opt);
    } else {
      snapRuns.forEach((rid) => {
        const rInfo = (META.runs || []).find((x) => x.run_id === rid);
        const daysAgo = rInfo ? rInfo.days_ago : "?";
        const opt = document.createElement("option");
        opt.value = rid;
        opt.textContent = `${rid} (${daysAgo}d before ${META.latest_run})`;
        baseSelect.appendChild(opt);
      });
    }

    // Compute universal filter counts and tab badges
    updateUniversalFilterCountsAndBadges();
    renderAllTabKpis();
    applyAllTabFilters();
    if (state.activeTab !== "all") {
      activateComparisonTab(state.activeTab);
    }
  }

  function switchCountry(countryCode) {
    if (state.country === countryCode && window.PLAY_DATA_BY_COUNTRY[countryCode]) {
      return;
    }

    const applyLoadedCountry = () => {
      const cData = window.PLAY_DATA_BY_COUNTRY[countryCode];
      if (!cData) return;
      state.country = countryCode;
      DATA = cData;
      META = cData.meta || {};
      ALL_APPS = cData.apps || [];
      SNAPSHOTS = cData.snapshots || {};
      rebuildLookups();

      document.querySelectorAll("#countrySwitchGroup .country-btn").forEach((b) => {
        b.setAttribute("aria-pressed", b.getAttribute("data-country") === countryCode ? "true" : "false");
      });

      hydrateCountryUI();
    };

    if (window.PLAY_DATA_BY_COUNTRY[countryCode]) {
      applyLoadedCountry();
      return;
    }

    // Dynamically load country payload script (e.g. data/payload_us.js)
    const btn = document.querySelector(`#countrySwitchGroup .country-btn[data-country="${countryCode}"]`);
    const origText = btn ? btn.textContent : "";
    if (btn) btn.textContent = countryCode === "US" ? "🇺🇸 Loading..." : "Loading...";

    if (!COUNTRY_SCRIPT_LOADING[countryCode]) {
      COUNTRY_SCRIPT_LOADING[countryCode] = [];
      const s = document.createElement("script");
      s.src = `data/payload_${countryCode.toLowerCase()}.js`;
      s.onload = function () {
        if (btn && origText) btn.textContent = origText;
        if (window.__onCountryDataLoaded) window.__onCountryDataLoaded(countryCode);
      };
      s.onerror = function () {
        if (btn && origText) btn.textContent = origText;
        delete COUNTRY_SCRIPT_LOADING[countryCode];
        alert(`USA store data is still being crawled or not yet generated.`);
      };
      document.body.appendChild(s);
    }
    COUNTRY_SCRIPT_LOADING[countryCode].push(applyLoadedCountry);
  }

  function init() {
    bindEvents();
    hydrateCountryUI();
  }

  function countBreakoutsForBaseline(baselineRunId) {
    const prevSnap = SNAPSHOTS[baselineRunId] || {};
    let count = 0;
    for (let i = 0; i < ALL_APPS.length; i++) {
      const a = ALL_APPS[i];
      if (!a.il || !TARGET_BUCKETS.includes(a.im)) continue;
      if (!matchesUniversalFilters(a)) continue;
      const p = prevSnap[a.p];
      if (!p || (p.im !== null && p.im < a.im)) {
        count++;
      }
    }
    return count;
  }

  // ==================== TAB 1: ALL APPS LOGIC ====================
  function renderAllTabKpis() {
    const latest = ALL_APPS.filter((a) => a.il === 1 && matchesUniversalFilters(a));
    const target4 = latest.filter((a) => TARGET_BUCKETS.includes(a.im));
    const fresh90 = latest.filter((a) => a.age !== null && a.age <= 90);
    const highVelEarly = latest.filter(
      (a) => a.im !== null && a.im <= 1000000 && a.vel !== null && a.vel >= 1000
    );

    const grid = document.getElementById("allKpiGrid");
    if (!grid) return;
    grid.innerHTML = `
      <button type="button" class="filter-pill" data-quick-preset="TARGET_4" title="Filter to 50K–10L tiers">🎯 50K–10L: <strong>${fmtNum(target4.length)}</strong></button>
      <button type="button" class="filter-pill" data-quick-preset="FRESH_90" title="Apps released within 90 days">⚡ ≤90d Fresh: <strong>${fmtNum(fresh90.length)}</strong></button>
      <button type="button" class="filter-pill" data-quick-preset="HIGH_VEL" title="≤10L apps with ≥1,000 installs/day">🚀 High Vel: <strong>${fmtNum(highVelEarly.length)}</strong></button>
    `;

    grid.querySelectorAll("[data-quick-preset]").forEach((card) => {
      card.addEventListener("click", () => {
        const preset = card.getAttribute("data-quick-preset");
        if (state.activeTab !== "all") {
          document.getElementById("tabBtn-all").click();
        }
        resetAllFiltersState();
        if (preset === "TARGET_4") {
          state.all.tier = "TARGET_4";
        } else if (preset === "EARLY_ALL") {
          state.all.tier = "EARLY_ALL";
        } else if (preset === "FRESH_90") {
          state.all.age = "90";
          state.all.sortCol = "ro";
          state.all.sortDir = "desc";
        } else if (preset === "HIGH_VEL") {
          state.all.tier = "EARLY_ALL";
          state.all.sortCol = "vel";
          state.all.sortDir = "desc";
        }
        syncAllFilterControls();
        applyAllTabFilters();
      });
    });
  }

  function resetAllFiltersState() {
    state.all.search = "";
    state.all.category = "ALL";
    state.all.tier = "ALL";
    state.all.age = "ALL";
    state.all.rating = "ALL";
    state.all.sortCol = "vel";
    state.all.sortDir = "desc";
    state.all.page = 1;
  }

  function syncAllFilterControls() {
    document.getElementById("allSearchInput").value = state.all.search;
    document.getElementById("allCategorySelect").value = state.all.category;
    document.getElementById("allTierSelect").value = state.all.tier;
    document.getElementById("allAgeSelect").value = state.all.age;
    document.getElementById("allRatingSelect").value = state.all.rating;

    document.querySelectorAll("#allQuickTierPills .filter-pill").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-tier") === state.all.tier ? "true" : "false");
    });
  }

  function applyAllTabFilters() {
    const s = state.all;
    const q = s.search.trim().toLowerCase();
    const cat = s.category;

    const out = [];
    for (let i = 0; i < ALL_APPS.length; i++) {
      const a = ALL_APPS[i];
      if (!a.il) continue;
      if (!matchesUniversalFilters(a)) continue;

      if (cat !== "ALL" && (!a.rk || a.rk[cat] === undefined)) continue;
      if (!matchesTierFilter(a.im, s.tier)) continue;

      if (s.age !== "ALL") {
        const maxAge = Number(s.age);
        if (a.age === null || a.age === undefined || a.age > maxAge) continue;
      }

      if (s.rating !== "ALL") {
        if (s.rating === "LOW") {
          if (a.rt === null || a.rt >= 3.5) continue;
        } else {
          const minR = Number(s.rating);
          if (a.rt === null || a.rt < minR) continue;
        }
      }

      if (q && !matchesSearch(a, q)) continue;
      out.push(a);
    }

    sortAppList(out, s.sortCol, s.sortDir, cat);
    s.filtered = out;
    s.page = 1;
    renderAllTable();
  }

  function sortAppList(arr, col, dir, catScope) {
    const mult = dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let va, vb;
      if (col === "br") {
        va = getAppRankForCategory(a, catScope);
        vb = getAppRankForCategory(b, catScope);
      } else {
        va = a[col];
        vb = b[col];
      }
      if (va === null || va === undefined || va === "") return 1;
      if (vb === null || vb === undefined || vb === "") return -1;
      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb) * mult;
      }
      return (va < vb ? -1 : va > vb ? 1 : 0) * mult;
    });
  }

  function renderAllTable() {
    const s = state.all;
    const total = s.filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / s.pageSize));
    if (s.page > totalPages) s.page = totalPages;

    const startIdx = (s.page - 1) * s.pageSize;
    const endIdx = Math.min(total, startIdx + s.pageSize);
    const slice = s.filtered.slice(startIdx, endIdx);

    const tbody = document.getElementById("allAppsTbody");
    if (slice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:2.5rem;color:var(--text-secondary);">No apps match the current filters.</td></tr>`;
    } else {
      const catScope = s.category;
      const rowsHtml = slice.map((a) => {
        const dispRank = getAppRankForCategory(a, catScope);
        const catCount = a.rk ? Object.keys(a.rk).length : 1;
        const otherCats = catCount > 1 ? `<span class="sub-detail">+${catCount - 1} more chart${catCount > 2 ? "s" : ""}</span>` : "";
        const ageBadge = a.age !== null && a.age <= 90
          ? `<span class="badge badge-up">${a.age}d old</span>`
          : a.age !== null
            ? `<span class="sub-detail">${a.age}d old</span>`
            : "";

        return `
          <tr data-pkg="${esc(a.p)}">
            <th scope="row">
              <div class="app-cell">
                <img class="app-icon" src="${esc(a.ic || "")}" alt="" loading="lazy" referrerpolicy="no-referrer">
                <div class="app-cell-info">
                  <div class="app-title-row">
                    <span class="app-title" title="${esc(a.t)}">${esc(a.t)}</span>
                  </div>
                  <div class="app-pkg">${esc(a.p)}</div>
                  ${a.sd ? `<div class="app-desc-snippet">${esc(a.sd)}</div>` : ""}
                </div>
              </div>
            </th>
            <td>
              <span class="badge badge-rank">#${dispRank !== null ? dispRank : "—"}</span>
              ${otherCats}
            </td>
            <td>
              <span class="badge badge-neutral">${esc(CAT_LABELS[a.c] || a.cl)}</span>
            </td>
            <td>
              <span class="badge ${TARGET_BUCKETS.includes(a.im) ? "badge-new" : "badge-neutral"}">${esc(a.id)}</span>
            </td>
            <td class="mono-num">
              <strong>${fmtNum(a.ie)}</strong>
            </td>
            <td class="mono-num">
              ${a.vel !== null ? `<strong>${fmtNum(a.vel)}</strong><span class="sub-detail">/ day</span>` : "—"}
            </td>
            <td class="mono-num">
              ${a.rt !== null ? `<span class="badge ${a.rt >= 4.3 ? "badge-up" : a.rt < 3.5 ? "badge-down" : "badge-neutral"}">${a.rt.toFixed(2)} ★</span>` : "—"}
            </td>
            <td class="mono-num">
              ${fmtNum(a.rc)}
              ${a.rv ? `<span class="sub-detail">${fmtNum(a.rv)} reviews</span>` : ""}
            </td>
            <td class="mono-num">
              ${esc(a.ro || "—")}
              <div>${ageBadge}</div>
            </td>
            <td class="mono-num">${esc(a.uo || "—")}</td>
            <td>
              <div>${renderDevLink(a.d)}</div>
              <div class="pill-group" style="margin-block-start:0.15rem;">
                ${a.iap ? `<span class="badge badge-tier-up" title="${esc(a.iap)}">IAP</span>` : ""}
                ${a.ads ? `<span class="badge badge-warn">Ads</span>` : ""}
                ${a.pr > 0 ? `<span class="badge badge-new">${esc(fmtPrice(a))}</span>` : ""}
                ${a.em ? `<span class="badge badge-neutral" title="${esc(a.em)}">✉</span>` : ""}
              </div>
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = rowsHtml.join("");
    }

    document.getElementById("allPaginationSummary").textContent =
      total === 0 ? "Showing 0 apps" : `Showing ${fmtNum(startIdx + 1)}–${fmtNum(endIdx)} of ${fmtNum(total)} apps`;
    document.getElementById("allPageIndicator").textContent = `${s.page} / ${totalPages}`;
    document.getElementById("allPrevPageBtn").disabled = s.page <= 1;
    document.getElementById("allNextPageBtn").disabled = s.page >= totalPages;
  }

  // ==================== COMPARISON TABS LOGIC ====================
  function activateComparisonTab(tabKey) {
    const compCfg = (META.comparisons || {})[tabKey] || {};
    const snapRuns = (META.snapshot_runs || []).filter((r) => r !== META.latest_run).reverse();
    const defaultBaseline = compCfg.baseline_run || snapRuns[0] || META.latest_run;

    state.comp.baselineRun = defaultBaseline;
    const sel = document.getElementById("compBaselineSelect");
    if (sel && defaultBaseline) sel.value = defaultBaseline;

    updateComparisonBanner(tabKey);
    recomputeComparisonData();
  }

  function updateComparisonBanner(tabKey) {
    const compCfg = (META.comparisons || {})[tabKey] || {};
    const titleEl = document.getElementById("compBannerTitle");
    const subEl = document.getElementById("compBannerSub");
    const bRun = state.comp.baselineRun;
    const rInfo = (META.runs || []).find((x) => x.run_id === bRun);
    const daysSpan = rInfo ? rInfo.days_ago : compCfg.actual_days;

    titleEl.textContent = compCfg.label || "Comparison View";
    subEl.innerHTML = `Comparing Latest Run <strong>${esc(META.latest_run)}</strong> against Baseline Run <strong>${esc(bRun || "None")}</strong> (${daysSpan !== undefined && daysSpan !== null ? daysSpan + " days span" : "custom baseline"})`;
  }

  function recomputeComparisonData() {
    const bRun = state.comp.baselineRun;
    const prevSnap = SNAPSHOTS[bRun] || {};
    const catScope = state.comp.category;
    const q = state.comp.search.trim().toLowerCase();

    const breakouts = [];
    const movements = [];

    for (let i = 0; i < ALL_APPS.length; i++) {
      const a = ALL_APPS[i];
      if (!matchesUniversalFilters(a)) continue;
      const currRank = a.il ? getAppRankForCategory(a, catScope) : null;
      const pSnap = prevSnap[a.p] || null;
      const prevRank = getSnapRankForCategory(pSnap, catScope);

      if (currRank === null && prevRank === null) continue;
      if (q && !matchesSearch(a, q)) continue;

      const prevIm = pSnap ? pSnap.im : null;
      const prevIe = pSnap ? pSnap.ie : null;
      const prevRc = pSnap ? pSnap.rc : null;

      const installDelta = a.ie !== null && prevIe !== null ? a.ie - prevIe : null;
      const ratingCountDelta = a.rc !== null && prevRc !== null ? a.rc - prevRc : null;

      let moveType = "SAME";
      let rankDelta = null;
      if (prevRank === null && currRank !== null) {
        moveType = "NEW";
      } else if (prevRank !== null && currRank === null) {
        moveType = "DROPPED";
      } else if (prevRank !== null && currRank !== null) {
        rankDelta = prevRank - currRank; // positive = moved up in rank
        if (rankDelta > 0) moveType = "GAINED";
        else if (rankDelta < 0) moveType = "LOST";
        else moveType = "SAME";
      }

      // Check if this app qualifies for Section A (50K, 1L, 5L, 10L Breakouts)
      let breakoutStatus = null; // 'NEW_CHART' | 'TIER_UP'
      if (currRank !== null && TARGET_BUCKETS.includes(a.im)) {
        if (prevRank === null) {
          breakoutStatus = "NEW_CHART";
        } else if (prevIm !== null && prevIm < a.im) {
          breakoutStatus = "TIER_UP";
        }
      }

      const rowObj = {
        app: a,
        t: a.t,
        d: a.d,
        cl: CAT_LABELS[a.c] || a.cl,
        im: a.im !== null ? a.im : prevIm,
        ie: a.ie !== null ? a.ie : prevIe,
        vel: a.vel,
        rt: a.rt,
        ro: a.ro,
        curr_rank: currRank,
        prev_rank: prevRank,
        delta: rankDelta,
        move_type: moveType,
        prev_im: prevIm,
        install_delta: installDelta,
        rc_delta: ratingCountDelta,
        status: breakoutStatus,
      };

      movements.push(rowObj);
      if (breakoutStatus !== null) {
        breakouts.push(rowObj);
      }
    }

    state.comp.allCompRows = movements;
    renderBreakoutTierCards(breakouts);
    filterAndRenderBreakouts(breakouts);
    filterAndRenderMovements(movements);
  }

  function renderBreakoutTierCards(allBreakouts) {
    const container = document.getElementById("breakoutTierCards");
    const cardsHtml = TARGET_BUCKET_META.map((tm) => {
      const subset = tm.min === null ? allBreakouts : allBreakouts.filter((r) => r.im === tm.min);
      const newChartCount = subset.filter((r) => r.status === "NEW_CHART").length;
      const tierUpCount = subset.filter((r) => r.status === "TIER_UP").length;
      const isActive = state.comp.breakoutBucket === tm.key;

      return `
        <button type="button" class="tier-stat-pill ${isActive ? "active-tier" : ""}" data-bucket-key="${tm.key}" title="${esc(tm.label)}: ${newChartCount} New to Chart, ${tierUpCount} Graduated Tier">
          <span>${esc(tm.short)}:</span>
          <strong>${fmtNum(subset.length)}</strong>
          <span class="tier-sub">(🆕${fmtNum(newChartCount)} / 🚀${fmtNum(tierUpCount)})</span>
        </button>
      `;
    });
    container.innerHTML = cardsHtml.join("");

    container.querySelectorAll(".tier-stat-pill").forEach((card) => {
      card.addEventListener("click", () => {
        state.comp.breakoutBucket = card.getAttribute("data-bucket-key");
        state.comp.breakoutPage = 1;
        recomputeComparisonData();
      });
    });
  }

  function filterAndRenderBreakouts(allBreakouts) {
    const c = state.comp;
    const filtered = allBreakouts.filter((r) => {
      if (c.breakoutBucket !== "ALL_4" && r.im !== Number(c.breakoutBucket)) return false;
      if (c.breakoutMode !== "ALL" && r.status !== c.breakoutMode) return false;
      if (c.breakoutAge !== "ALL") {
        const maxAge = Number(c.breakoutAge);
        if (r.app.age === null || r.app.age > maxAge) return false;
      }
      return true;
    });

    sortCompRows(filtered, c.breakoutSortCol, c.breakoutSortDir);
    c.breakoutRows = filtered;

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / c.breakoutPageSize));
    if (c.breakoutPage > totalPages) c.breakoutPage = totalPages;
    const startIdx = (c.breakoutPage - 1) * c.breakoutPageSize;
    const endIdx = Math.min(total, startIdx + c.breakoutPageSize);
    const slice = filtered.slice(startIdx, endIdx);

    const tbody = document.getElementById("breakoutTbody");
    if (slice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-secondary);">No breakout apps in this bucket match the selected filters.</td></tr>`;
    } else {
      tbody.innerHTML = slice.map((r) => {
        const a = r.app;
        const statusBadge =
          r.status === "NEW_CHART"
            ? `<span class="badge badge-new">🆕 New to Chart</span>`
            : `<span class="badge badge-tier-up">🚀 Tier Up (${fmtBucket(r.prev_im)} → ${fmtBucket(r.im)})</span>`;

        let rankBadge = `<span class="badge badge-rank">#${r.curr_rank}</span>`;
        if (r.delta !== null && r.delta !== 0) {
          rankBadge += ` <span class="badge ${r.delta > 0 ? "badge-up" : "badge-down"}">${r.delta > 0 ? "▲ +" + r.delta : "▼ " + r.delta}</span>`;
        } else if (r.prev_rank !== null) {
          rankBadge += ` <span class="sub-detail">was #${r.prev_rank}</span>`;
        }

        const instDeltaHtml =
          r.install_delta !== null && r.install_delta > 0
            ? `<span class="sub-detail" style="color:var(--success);">${fmtSigned(r.install_delta)} installs</span>`
            : "";

        const rcDeltaHtml =
          r.rc_delta !== null && r.rc_delta > 0
            ? `<span class="sub-detail" style="color:var(--success);">${fmtSigned(r.rc_delta)} ratings</span>`
            : "";

        return `
          <tr data-pkg="${esc(a.p)}">
            <th scope="row">
              <div class="app-cell">
                <img class="app-icon" src="${esc(a.ic || "")}" alt="" loading="lazy" referrerpolicy="no-referrer">
                <div class="app-cell-info">
                  <div class="app-title-row">
                    <span class="app-title" title="${esc(a.t)}">${esc(a.t)}</span>
                  </div>
                  <div class="app-pkg">${esc(a.p)}</div>
                  ${a.sd ? `<div class="app-desc-snippet">${esc(a.sd)}</div>` : ""}
                </div>
              </div>
            </th>
            <td>${statusBadge}</td>
            <td class="mono-num">${rankBadge}</td>
            <td><span class="badge badge-neutral">${esc(r.cl)}</span></td>
            <td><span class="badge badge-new">${fmtBucket(r.im)}</span></td>
            <td class="mono-num">
              <strong>${fmtNum(r.ie)}</strong>
              ${instDeltaHtml}
            </td>
            <td class="mono-num">
              ${r.vel !== null ? `<strong>${fmtNum(r.vel)}</strong><span class="sub-detail">/ day</span>` : "—"}
            </td>
            <td class="mono-num">
              ${r.rt !== null ? `<span class="badge ${r.rt >= 4.3 ? "badge-up" : "badge-neutral"}">${r.rt.toFixed(2)} ★</span>` : "—"}
              <span class="sub-detail">${fmtNum(a.rc)} ratings</span>
              ${rcDeltaHtml}
            </td>
            <td class="mono-num">
              ${esc(r.ro || "—")}
              ${a.age !== null ? `<span class="sub-detail">${a.age}d old</span>` : ""}
            </td>
            <td>
              <div>${renderDevLink(a.d)}</div>
              <div class="pill-group" style="margin-block-start:0.15rem;">
                ${a.iap ? `<span class="badge badge-tier-up">IAP</span>` : ""}
                ${a.ads ? `<span class="badge badge-warn">Ads</span>` : ""}
              </div>
            </td>
          </tr>
        `;
      }).join("");
    }

    document.getElementById("breakoutPaginationSummary").textContent =
      total === 0 ? "Showing 0 breakout apps" : `Showing ${fmtNum(startIdx + 1)}–${fmtNum(endIdx)} of ${fmtNum(total)} breakout apps`;
    document.getElementById("breakoutPageIndicator").textContent = `${c.breakoutPage} / ${totalPages}`;
    document.getElementById("breakoutPrevPageBtn").disabled = c.breakoutPage <= 1;
    document.getElementById("breakoutNextPageBtn").disabled = c.breakoutPage >= totalPages;
  }

  function filterAndRenderMovements(allMovements) {
    const c = state.comp;

    // Update counts on movement pills (after tier filter)
    const tierFiltered = allMovements.filter((r) => matchesTierFilter(r.im, c.movementTier));
    const counts = {
      ALL: tierFiltered.length,
      GAINED: 0,
      SURGE: 0,
      LOST: 0,
      NEW: 0,
      DROPPED: 0,
      SAME: 0,
    };
    tierFiltered.forEach((r) => {
      if (r.move_type === "GAINED") {
        counts.GAINED++;
        if (r.delta >= 15) counts.SURGE++;
      } else if (r.move_type === "LOST") {
        counts.LOST++;
      } else if (r.move_type === "NEW") {
        counts.NEW++;
      } else if (r.move_type === "DROPPED") {
        counts.DROPPED++;
      } else {
        counts.SAME++;
      }
    });

    document.getElementById("mCountAll").textContent = fmtNum(counts.ALL);
    document.getElementById("mCountGained").textContent = fmtNum(counts.GAINED);
    document.getElementById("mCountSurge").textContent = fmtNum(counts.SURGE);
    document.getElementById("mCountLost").textContent = fmtNum(counts.LOST);
    document.getElementById("mCountNew").textContent = fmtNum(counts.NEW);
    document.getElementById("mCountDropped").textContent = fmtNum(counts.DROPPED);
    document.getElementById("mCountSame").textContent = fmtNum(counts.SAME);

    const filtered = tierFiltered.filter((r) => {
      if (c.movementMode === "ALL") return true;
      if (c.movementMode === "SURGE") return r.move_type === "GAINED" && r.delta >= 15;
      return r.move_type === c.movementMode;
    });

    sortCompRows(filtered, c.movementSortCol, c.movementSortDir);
    c.movementRows = filtered;

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / c.movementPageSize));
    if (c.movementPage > totalPages) c.movementPage = totalPages;
    const startIdx = (c.movementPage - 1) * c.movementPageSize;
    const endIdx = Math.min(total, startIdx + c.movementPageSize);
    const slice = filtered.slice(startIdx, endIdx);

    const tbody = document.getElementById("movementTbody");
    if (slice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-secondary);">No apps match the selected movement filters.</td></tr>`;
    } else {
      tbody.innerHTML = slice.map((r) => {
        const a = r.app;
        let moveBadge = "";
        if (r.move_type === "GAINED") {
          moveBadge = `<span class="badge badge-up">▲ +${r.delta}</span>`;
        } else if (r.move_type === "LOST") {
          moveBadge = `<span class="badge badge-down">▼ ${r.delta}</span>`;
        } else if (r.move_type === "NEW") {
          moveBadge = `<span class="badge badge-new">🆕 NEW</span>`;
        } else if (r.move_type === "DROPPED") {
          moveBadge = `<span class="badge badge-warn">🔻 DROPPED</span>`;
        } else {
          moveBadge = `<span class="badge badge-neutral">— 0</span>`;
        }

        const tierChanged =
          r.prev_im !== null && r.im !== null && r.im > r.prev_im
            ? `<span class="sub-detail" style="color:var(--purple);">🚀 ${fmtBucket(r.prev_im)} → ${fmtBucket(r.im)}</span>`
            : "";

        return `
          <tr data-pkg="${esc(a.p)}">
            <th scope="row">
              <div class="app-cell">
                <img class="app-icon" src="${esc(a.ic || "")}" alt="" loading="lazy" referrerpolicy="no-referrer">
                <div class="app-cell-info">
                  <div class="app-title-row">
                    <span class="app-title" title="${esc(a.t)}">${esc(a.t)}</span>
                  </div>
                  <div class="app-pkg">${esc(a.p)} • ${renderDevLink(a.d)}</div>
                </div>
              </div>
            </th>
            <td class="mono-num">${moveBadge}</td>
            <td class="mono-num">
              <span style="color:var(--text-secondary);">${r.prev_rank !== null ? "#" + r.prev_rank : "—"}</span>
              →
              <strong>${r.curr_rank !== null ? "#" + r.curr_rank : "Out"}</strong>
            </td>
            <td><span class="badge badge-neutral">${esc(r.cl)}</span></td>
            <td>
              <span class="badge ${TARGET_BUCKETS.includes(r.im) ? "badge-new" : "badge-neutral"}">${fmtBucket(r.im)}</span>
              ${tierChanged}
            </td>
            <td class="mono-num">
              <strong>${fmtNum(r.ie)}</strong>
              ${r.install_delta ? `<span class="sub-detail" style="color:${r.install_delta > 0 ? "var(--success)" : "var(--text-secondary)"};">${fmtSigned(r.install_delta)}</span>` : ""}
            </td>
            <td class="mono-num">
              ${r.vel !== null ? `<strong>${fmtNum(r.vel)}</strong><span class="sub-detail">/ day</span>` : "—"}
            </td>
            <td class="mono-num">
              ${r.rt !== null ? `${r.rt.toFixed(2)} ★` : "—"}
              <span class="sub-detail">${fmtNum(a.rc)} ratings</span>
            </td>
            <td class="mono-num">
              ${esc(r.ro || "—")}
              ${a.age !== null ? `<span class="sub-detail">${a.age}d old</span>` : ""}
            </td>
          </tr>
        `;
      }).join("");
    }

    document.getElementById("movementPaginationSummary").textContent =
      total === 0 ? "Showing 0 apps" : `Showing ${fmtNum(startIdx + 1)}–${fmtNum(endIdx)} of ${fmtNum(total)} apps`;
    document.getElementById("movementPageIndicator").textContent = `${c.movementPage} / ${totalPages}`;
    document.getElementById("movementPrevPageBtn").disabled = c.movementPage <= 1;
    document.getElementById("movementNextPageBtn").disabled = c.movementPage >= totalPages;
  }

  function sortCompRows(arr, col, dir) {
    const mult = dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const va = a[col];
      const vb = b[col];
      if (va === null || va === undefined || va === "") return 1;
      if (vb === null || vb === undefined || vb === "") return -1;
      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb) * mult;
      }
      return (va < vb ? -1 : va > vb ? 1 : 0) * mult;
    });
  }

  // ==================== APP DETAIL MODAL (<dialog closedby="any">) ====================
  function openAppModal(pkg) {
    const a = APP_BY_PKG[pkg];
    if (!a) return;

    const dialog = document.getElementById("appDetailDialog");
    document.getElementById("dialogAppIcon").src = a.ic || "";
    document.getElementById("dialogAppTitle").textContent = a.t;
    document.getElementById("dialogAppDev").innerHTML = `${renderDevLink(a.d)} <span style="margin-inline:0.3rem;">•</span> <span class="mono-num">${esc(a.p)}</span>`;

    const playUrl = playStoreUrl(a.p);
    const linksHtml = [
      `<a href="${playUrl}" target="_blank" rel="noopener" class="badge badge-new">▶ Open on Google Play</a>`,
    ];
    if (a.wb) {
      linksHtml.push(`<a href="${esc(a.wb)}" target="_blank" rel="noopener" class="badge badge-neutral">🌐 Website</a>`);
    }
    if (a.em) {
      linksHtml.push(`<a href="mailto:${esc(a.em)}" class="badge badge-neutral">✉ ${esc(a.em)}</a>`);
    }
    if (a.iap) {
      linksHtml.push(`<span class="badge badge-tier-up">IAP: ${esc(a.iap)}</span>`);
    }
    if (a.ads) {
      linksHtml.push(`<span class="badge badge-warn">Contains Ads</span>`);
    }
    if (a.cr) {
      linksHtml.push(`<span class="badge badge-neutral">${esc(a.cr)}</span>`);
    }
    document.getElementById("dialogAppLinks").innerHTML = linksHtml.join("");

    // Rating Histogram
    let histHtml = "";
    if (a.st && a.st.length === 5) {
      const totalStars = Math.max(1, a.st.reduce((s, v) => s + v, 0));
      const rows = [5, 4, 3, 2, 1].map((star) => {
        const count = a.st[star - 1] || 0;
        const pct = ((count / totalStars) * 100).toFixed(1);
        return `
          <div class="hist-row">
            <span style="inline-size:28px;">${star} ★</span>
            <div class="hist-bar-track"><div class="hist-bar-fill" style="inline-size:${pct}%;"></div></div>
            <span style="inline-size:115px;text-align:end;">${fmtNum(count)} (${pct}%)</span>
          </div>
        `;
      });
      histHtml = `
        <div>
          <h3 style="margin:0 0 0.5rem;font-size:0.9rem;">Rating Histogram (1★ to 5★)</h3>
          <div style="display:flex;flex-direction:column;gap:0.35rem;">${rows.join("")}</div>
        </div>
      `;
    }

    // Current Category Rankings & Baseline comparison
    const bRun = state.comp.baselineRun || (META.snapshot_runs || [])[0];
    const bSnap = (SNAPSHOTS[bRun] || {})[a.p] || {};
    const bRanks = bSnap.rk || {};
    const allCats = Array.from(new Set([...Object.keys(a.rk || {}), ...Object.keys(bRanks)]));
    const catBadges = allCats.map((cid) => {
      const cRank = a.rk && a.rk[cid] !== undefined ? a.rk[cid] : null;
      const pRank = bRanks[cid] !== undefined ? bRanks[cid] : null;
      let deltaTxt = "";
      if (cRank !== null && pRank !== null) {
        const d = pRank - cRank;
        deltaTxt = d > 0 ? ` (▲ +${d})` : d < 0 ? ` (▼ ${d})` : " (—)";
      } else if (cRank !== null && pRank === null && bRun && bRun !== META.latest_run) {
        deltaTxt = " (🆕)";
      }
      return `<span class="badge badge-rank">${esc(CAT_LABELS[cid] || cid)}: ${cRank !== null ? "#" + cRank : "Out"}${deltaTxt}</span>`;
    });

    // Historical snapshots table across stored runs
    const snapHistoryRows = (META.snapshot_runs || []).map((rid) => {
      const s = (SNAPSHOTS[rid] || {})[a.p];
      if (!s) {
        return `<tr><td class="mono-num">${esc(rid)}</td><td colspan="4" style="color:var(--text-muted);">Not in top charts</td></tr>`;
      }
      return `
        <tr>
          <td class="mono-num"><strong>${esc(rid)}</strong></td>
          <td class="mono-num">#${s.br} (${esc(CAT_LABELS[s.bc] || s.bc)})</td>
          <td><span class="badge badge-new">${fmtBucket(s.im)}</span></td>
          <td class="mono-num">${fmtNum(s.ie)}</td>
          <td class="mono-num">${fmtNum(s.rc)}</td>
        </tr>
      `;
    });

    const bodyEl = document.getElementById("dialogBodyContent");
    bodyEl.innerHTML = `
      <div class="dialog-metrics-grid">
        <div class="dialog-metric"><div class="label">Best Rank</div><div class="val">${a.br !== null ? "#" + a.br : "Dropped"}</div></div>
        <div class="dialog-metric"><div class="label">Install Tier</div><div class="val">${esc(a.id)}</div></div>
        <div class="dialog-metric"><div class="label">Exact Installs</div><div class="val">${fmtNum(a.ie)}</div></div>
        <div class="dialog-metric"><div class="label">Velocity / Day</div><div class="val">${a.vel !== null ? fmtNum(a.vel) : "—"}</div></div>
        <div class="dialog-metric"><div class="label">Exact Rating</div><div class="val">${a.rt !== null ? a.rt.toFixed(2) + " ★" : "—"}</div></div>
        <div class="dialog-metric"><div class="label">Total Ratings</div><div class="val">${fmtNum(a.rc)}</div></div>
        <div class="dialog-metric"><div class="label">Written Reviews</div><div class="val">${fmtNum(a.rv)}</div></div>
        <div class="dialog-metric"><div class="label">Released On</div><div class="val">${esc(a.ro || "—")} ${a.age !== null ? `(${a.age}d)` : ""}</div></div>
        <div class="dialog-metric"><div class="label">Updated On</div><div class="val">${esc(a.uo || "—")}</div></div>
        <div class="dialog-metric"><div class="label">Screenshots</div><div class="val">${fmtNum(a.sc)}</div></div>
      </div>

      <div>
        <h3 style="margin:0 0 0.5rem;font-size:0.9rem;">Category Chart Placements</h3>
        <div class="pill-group">${catBadges.join("")}</div>
      </div>

      ${histHtml}

      <div>
        <h3 style="margin:0 0 0.5rem;font-size:0.9rem;">Snapshot History Across Crawl Runs</h3>
        <div class="table-wrapper" style="max-block-size:220px;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Run Date</th>
                <th>Best Rank</th>
                <th>Install Tier</th>
                <th>Exact Installs</th>
                <th>Rating Count</th>
              </tr>
            </thead>
            <tbody>${snapHistoryRows.join("")}</tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 style="margin:0 0 0.5rem;font-size:0.9rem;">App Description</h3>
        <div id="dialogFullDescBox" class="dialog-description-box">${esc(a.sd || "Loading full description...")}</div>
      </div>
    `;

    if (dialog.open) dialog.close();
    dialog.showModal();

    loadDescription(a.p, a.sh, (fullHtml) => {
      const box = document.getElementById("dialogFullDescBox");
      if (!box) return;
      if (fullHtml) {
        // Allow safe line breaks from Play Store description
        const safe = esc(fullHtml).replace(/&lt;br\s*\/?&gt;/gi, "<br>");
        box.innerHTML = safe;
      }
    });
  }

  // ==================== DEVELOPER MODAL ====================
  function openDeveloperModal(devName) {
    if (!devName) return;
    const apps = (APPS_BY_DEV[devName] || []).slice();
    state.devModal.devName = devName;
    state.devModal.apps = apps;

    const dialog = document.getElementById("devDetailDialog");
    if (!dialog) return;

    document.getElementById("devDialogTitle").textContent = `${devName} (${fmtNum(apps.length)} app${apps.length === 1 ? "" : "s"})`;

    // Gather developer-level summary stats & contacts across all their apps
    let totalExactInstalls = 0;
    let totalRatingCount = 0;
    let weightedRatingSum = 0;
    let bestOverallRank = null;
    const emails = new Set();
    const websites = new Set();

    apps.forEach((a) => {
      if (a.ie) totalExactInstalls += a.ie;
      if (a.rt && a.rc) {
        weightedRatingSum += a.rt * a.rc;
        totalRatingCount += a.rc;
      }
      if (a.br && (bestOverallRank === null || a.br < bestOverallRank)) {
        bestOverallRank = a.br;
      }
      if (a.em) emails.add(a.em);
      if (a.wb) websites.add(a.wb);
    });

    const avgRating = totalRatingCount > 0 ? (weightedRatingSum / totalRatingCount).toFixed(2) + " ★" : "—";
    const emailLinks = Array.from(emails)
      .map((em) => `<a href="mailto:${esc(em)}">✉️ ${esc(em)}</a>`)
      .join(" · ");
    const webLinks = Array.from(websites)
      .map((wb) => `<a href="${esc(wb)}" target="_blank" rel="noopener noreferrer">🌐 ${esc(wb)}</a>`)
      .join(" · ");

    document.getElementById("devDialogMeta").innerHTML = `
      <span>📦 <strong>${fmtNum(apps.length)}</strong> Charting Apps</span>
      <span>·</span>
      <span>🏆 Best Rank: <strong>${bestOverallRank ? "#" + bestOverallRank : "—"}</strong></span>
      <span>·</span>
      <span>📥 Combined Exact Installs: <strong>${fmtNum(totalExactInstalls)}</strong></span>
      <span>·</span>
      <span>⭐ Weighted Rating: <strong>${avgRating}</strong> (${fmtNum(totalRatingCount)} ratings)</span>
      ${emailLinks ? `<span>·</span><span>${emailLinks}</span>` : ""}
      ${webLinks ? `<span>·</span><span>${webLinks}</span>` : ""}
    `;

    updateSortHeaders("#devAppsTable", "data-dsort", state.devModal.sortCol, state.devModal.sortDir);
    renderDeveloperModalTable();
    if (dialog.open) dialog.close();
    dialog.showModal();
  }

  function renderDeveloperModalTable() {
    const apps = state.devModal.apps;
    sortAppList(apps, state.devModal.sortCol, state.devModal.sortDir, "ALL");

    const tbody = document.getElementById("devAppsTbody");
    if (!apps.length) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:2rem;color:var(--text-secondary);">No apps found for this developer.</td></tr>`;
      return;
    }

    const html = [];
    for (const a of apps) {
      // All category ranks in latest crawl
      const rankEntries = Object.entries(a.rk || {}).sort((x, y) => x[1] - y[1]);
      const allRanksHtml = rankEntries.length
        ? rankEntries
          .map(([cat, r]) => `<span class="badge badge-neutral" style="margin:1px 2px 1px 0;">#${r} ${esc(CAT_LABELS[cat] || cat)}</span>`)
          .join(" ")
        : "";

      const vert = inferVertical(a);
      const segBadge =
        vert === "games"
          ? `<span class="badge badge-tier-up">🎮 Game</span>`
          : vert === "education"
            ? `<span class="badge badge-new">🎓 Edu</span>`
            : `<span class="badge badge-neutral">📱 App</span>`;

      const histSummary =
        Array.isArray(a.st) && a.st.length === 5
          ? `<div class="sub-detail" title="5★ / 4★ / 3★ / 2★ / 1★">5★: ${fmtNum(a.st[4])} · 1★: ${fmtNum(a.st[0])}</div>`
          : "";

      const priceBadge = a.pr > 0 ? `<span class="badge badge-new">${esc(fmtPrice(a))}</span>` : `<span class="badge badge-neutral">Free</span>`;
      const iapBadge = a.iap ? `<span class="badge badge-tier-up" title="${esc(a.iap)}">IAP ${esc(a.iap)}</span>` : "";
      const adsBadge = a.ads ? `<span class="badge badge-warn">Ads</span>` : "";
      const cleanBadge = !a.iap && !a.ads ? `<span class="badge badge-up">None (No IAP/Ads)</span>` : "";

      const extraDetails = [];
      if (a.cr) extraDetails.push(`🔞 ${esc(a.cr)}`);
      if (a.sc) extraDetails.push(`🖼️ ${fmtNum(a.sc)} screens`);
      if (a.em) extraDetails.push(`<a href="mailto:${esc(a.em)}">✉️ ${esc(a.em)}</a>`);
      if (a.wb) extraDetails.push(`<a href="${esc(a.wb)}" target="_blank" rel="noopener noreferrer">🌐 Website</a>`);

      const ageBadge =
        a.age !== null && a.age !== undefined
          ? `<span class="${a.age <= 90 ? "badge badge-up" : "sub-detail"}">${a.age}d old</span>`
          : "";

      html.push(`<tr data-pkg="${esc(a.p)}">
        <th scope="row">
          <div class="app-cell">
            <img class="app-icon" src="${esc(a.ic || "")}" alt="" loading="lazy" referrerpolicy="no-referrer" />
            <div class="app-cell-info">
              <div class="app-title-row">
                <span class="app-title" title="${esc(a.t)}">${esc(a.t)}</span>
              </div>
              <div class="app-pkg">
                ${esc(a.p)} · <a href="${playStoreUrl(a.p)}" target="_blank" rel="noopener noreferrer">Play Store ↗</a>
              </div>
              ${a.sd ? `<div class="app-desc-snippet">${esc(a.sd)}</div>` : ""}
            </div>
          </div>
        </th>
        <td>
          <span class="badge badge-rank">#${a.br !== null && a.br !== undefined ? a.br : "Out"}</span>
          ${allRanksHtml ? `<div style="margin-block-start:0.2rem;max-inline-size:220px;white-space:normal;">${allRanksHtml}</div>` : ""}
        </td>
        <td>
          <div>${segBadge}</div>
          <div class="sub-detail" style="margin-block-start:0.15rem;">${esc(CAT_LABELS[a.c] || a.cl)} <span class="mono-num">(${esc(a.c)})</span></div>
        </td>
        <td><span class="badge ${TARGET_BUCKETS.includes(a.im) ? "badge-new" : "badge-neutral"}">${esc(a.id || fmtBucket(a.im))}</span></td>
        <td class="mono-num"><strong>${fmtNum(a.ie)}</strong></td>
        <td class="mono-num">${a.vel !== null && a.vel !== undefined ? `<strong>${fmtNum(a.vel)}</strong><span class="sub-detail">/ day</span>` : "—"}</td>
        <td class="mono-num">
          ${a.rt !== null && a.rt !== undefined ? `<span class="badge ${a.rt >= 4.3 ? "badge-up" : a.rt < 3.5 ? "badge-down" : "badge-neutral"}">${a.rt.toFixed(2)} ★</span>` : "—"}
        </td>
        <td class="mono-num">
          <div>${fmtNum(a.rc)}</div>
          ${a.rv ? `<span class="sub-detail">${fmtNum(a.rv)} reviews</span>` : ""}
          ${histSummary}
        </td>
        <td class="mono-num">
          <div>${esc(a.ro || "—")}</div>
          <div>${ageBadge}</div>
        </td>
        <td class="mono-num">${esc(a.uo || "—")}</td>
        <td>
          <div class="pill-group">${priceBadge}${iapBadge}${adsBadge}${cleanBadge}</div>
          ${extraDetails.length ? `<div class="sub-detail" style="margin-block-start:0.2rem;max-inline-size:240px;white-space:normal;">${extraDetails.join(" · ")}</div>` : ""}
        </td>
      </tr>`);
    }

    tbody.innerHTML = html.join("");
  }

  // ==================== CSV EXPORT ====================
  function downloadCsv(filename, headers, rows) {
    const csvLines = [
      headers.join(","),
      ...rows.map((r) =>
        r
          .map((cell) => {
            const s = cell === null || cell === undefined ? "" : String(cell);
            return '"' + s.replace(/"/g, '""') + '"';
          })
          .join(",")
      ),
    ];
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==================== EVENT BINDINGS ====================
  function bindEvents() {
    // Country Switcher (IN / US)
    document.querySelectorAll("#countrySwitchGroup .country-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-country");
        if (code) switchCountry(code);
      });
    });

    // Theme toggle
    const themeBtn = document.getElementById("themeToggleBtn");
    themeBtn.addEventListener("click", () => {
      const htmlEl = document.documentElement;
      const next = htmlEl.getAttribute("data-theme") === "light" ? "dark" : "light";
      htmlEl.setAttribute("data-theme", next);
      themeBtn.textContent = next === "light" ? "🌙 Dark" : "☀️ Light";
    });

    // Global '/' shortcut to focus active search input
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        e.preventDefault();
        const target =
          state.activeTab === "all"
            ? document.getElementById("allSearchInput")
            : document.getElementById("compGlobalSearchInput");
        if (target) target.focus();
      }
    });

    // Main 4-Tab Switching
    document.querySelectorAll(".main-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        state.activeTab = tab;
        document.querySelectorAll(".main-tab-btn").forEach((b) => {
          b.setAttribute("aria-selected", b === btn ? "true" : "false");
        });

        const panelAll = document.getElementById("panel-all");
        const panelComp = document.getElementById("panel-compare");
        if (tab === "all") {
          panelAll.hidden = false;
          panelComp.hidden = true;
        } else {
          panelAll.hidden = true;
          panelComp.hidden = false;
          activateComparisonTab(tab);
        }
      });
    });

    // Tab 1 (All Apps) Filter Controls
    document.getElementById("allSearchInput").addEventListener("input", (e) => {
      state.all.search = e.target.value;
      applyAllTabFilters();
    });
    document.getElementById("allCategorySelect").addEventListener("change", (e) => {
      state.all.category = e.target.value;
      applyAllTabFilters();
    });
    document.getElementById("allTierSelect").addEventListener("change", (e) => {
      state.all.tier = e.target.value;
      syncAllFilterControls();
      applyAllTabFilters();
    });
    document.getElementById("allAgeSelect").addEventListener("change", (e) => {
      state.all.age = e.target.value;
      applyAllTabFilters();
    });
    document.getElementById("allRatingSelect").addEventListener("change", (e) => {
      state.all.rating = e.target.value;
      applyAllTabFilters();
    });

    // Universal Multi-Select Filter Events (Segment: apps/games/education & Monetization: iap/ads/none)
    function refreshAfterUniversalChange() {
      updateUniversalFilterCountsAndBadges();
      renderAllTabKpis();
      if (state.activeTab === "all") {
        applyAllTabFilters();
      } else {
        recomputeComparisonData();
      }
    }

    document.querySelectorAll("#globalVerticalGroup .multi-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const val = btn.getAttribute("data-u-vert");
        const set = state.global.verticals;
        if (set.has(val)) {
          set.delete(val);
          if (set.size === 0) {
            ["apps", "games", "education"].forEach((v) => set.add(v));
          }
        } else {
          set.add(val);
        }
        document.querySelectorAll("#globalVerticalGroup .multi-chip").forEach((b) => {
          b.setAttribute("aria-pressed", set.has(b.getAttribute("data-u-vert")) ? "true" : "false");
        });
        refreshAfterUniversalChange();
      });
    });

    document.querySelectorAll("#globalMonetizationGroup .multi-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const val = btn.getAttribute("data-u-mon");
        const set = state.global.monetization;
        if (set.has(val)) {
          set.delete(val);
          if (set.size === 0) {
            ["iap", "ads", "none"].forEach((m) => set.add(m));
          }
        } else {
          set.add(val);
        }
        document.querySelectorAll("#globalMonetizationGroup .multi-chip").forEach((b) => {
          b.setAttribute("aria-pressed", set.has(b.getAttribute("data-u-mon")) ? "true" : "false");
        });
        refreshAfterUniversalChange();
      });
    });

    document.getElementById("globalResetBtn").addEventListener("click", () => {
      state.global.verticals = new Set(["apps"]);
      state.global.monetization = new Set(["none"]);
      document.querySelectorAll("#globalVerticalGroup .multi-chip").forEach((b) => {
        b.setAttribute("aria-pressed", b.getAttribute("data-u-vert") === "apps" ? "true" : "false");
      });
      document.querySelectorAll("#globalMonetizationGroup .multi-chip").forEach((b) => {
        b.setAttribute("aria-pressed", b.getAttribute("data-u-mon") === "none" ? "true" : "false");
      });
      refreshAfterUniversalChange();
    });

    document.querySelectorAll("#allQuickTierPills .filter-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.all.tier = btn.getAttribute("data-tier");
        syncAllFilterControls();
        applyAllTabFilters();
      });
    });

    document.getElementById("allResetFiltersBtn").addEventListener("click", () => {
      resetAllFiltersState();
      syncAllFilterControls();
      applyAllTabFilters();
    });

    // All Apps Table Column Sorting
    document.querySelectorAll("#allAppsTable thead th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.getAttribute("data-sort");
        if (state.all.sortCol === col) {
          state.all.sortDir = state.all.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.all.sortCol = col;
          state.all.sortDir = col === "br" || col === "t" || col === "cl" || col === "d" ? "asc" : "desc";
        }
        updateSortHeaders("#allAppsTable", "data-sort", state.all.sortCol, state.all.sortDir);
        sortAppList(state.all.filtered, state.all.sortCol, state.all.sortDir, state.all.category);
        state.all.page = 1;
        renderAllTable();
      });
    });

    // All Apps Pagination
    document.getElementById("allPageSizeSelect").addEventListener("change", (e) => {
      state.all.pageSize = Number(e.target.value);
      state.all.page = 1;
      renderAllTable();
    });
    document.getElementById("allPrevPageBtn").addEventListener("click", () => {
      if (state.all.page > 1) {
        state.all.page--;
        renderAllTable();
      }
    });
    document.getElementById("allNextPageBtn").addEventListener("click", () => {
      state.all.page++;
      renderAllTable();
    });

    // Comparison Banner Controls
    document.getElementById("compBaselineSelect").addEventListener("change", (e) => {
      state.comp.baselineRun = e.target.value;
      updateComparisonBanner(state.activeTab);
      recomputeComparisonData();
    });
    document.getElementById("compGlobalCatSelect").addEventListener("change", (e) => {
      state.comp.category = e.target.value;
      state.comp.breakoutPage = 1;
      state.comp.movementPage = 1;
      recomputeComparisonData();
    });
    document.getElementById("compGlobalSearchInput").addEventListener("input", (e) => {
      state.comp.search = e.target.value;
      state.comp.breakoutPage = 1;
      state.comp.movementPage = 1;
      recomputeComparisonData();
    });

    // Breakout Section Controls
    document.querySelectorAll("#breakoutModePills .filter-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.comp.breakoutMode = btn.getAttribute("data-bmode");
        document.querySelectorAll("#breakoutModePills .filter-pill").forEach((b) => {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        state.comp.breakoutPage = 1;
        recomputeComparisonData();
      });
    });

    document.getElementById("breakoutAgeSelect").addEventListener("change", (e) => {
      state.comp.breakoutAge = e.target.value;
      state.comp.breakoutPage = 1;
      recomputeComparisonData();
    });

    document.querySelectorAll("#breakoutTable thead th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.getAttribute("data-bsort");
        if (state.comp.breakoutSortCol === col) {
          state.comp.breakoutSortDir = state.comp.breakoutSortDir === "asc" ? "desc" : "asc";
        } else {
          state.comp.breakoutSortCol = col;
          state.comp.breakoutSortDir = col === "curr_rank" || col === "t" ? "asc" : "desc";
        }
        updateSortHeaders("#breakoutTable", "data-bsort", state.comp.breakoutSortCol, state.comp.breakoutSortDir);
        recomputeComparisonData();
      });
    });

    document.getElementById("breakoutPrevPageBtn").addEventListener("click", () => {
      if (state.comp.breakoutPage > 1) {
        state.comp.breakoutPage--;
        recomputeComparisonData();
      }
    });
    document.getElementById("breakoutNextPageBtn").addEventListener("click", () => {
      state.comp.breakoutPage++;
      recomputeComparisonData();
    });

    // Movement Section Controls
    document.querySelectorAll("#movementTypePills .filter-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.comp.movementMode = btn.getAttribute("data-mmode");
        document.querySelectorAll("#movementTypePills .filter-pill").forEach((b) => {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        state.comp.movementPage = 1;
        recomputeComparisonData();
      });
    });

    document.getElementById("movementTierSelect").addEventListener("change", (e) => {
      state.comp.movementTier = e.target.value;
      state.comp.movementPage = 1;
      recomputeComparisonData();
    });

    document.querySelectorAll("#movementTable thead th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.getAttribute("data-msort");
        if (state.comp.movementSortCol === col) {
          state.comp.movementSortDir = state.comp.movementSortDir === "asc" ? "desc" : "asc";
        } else {
          state.comp.movementSortCol = col;
          state.comp.movementSortDir = col === "curr_rank" || col === "t" ? "asc" : "desc";
        }
        updateSortHeaders("#movementTable", "data-msort", state.comp.movementSortCol, state.comp.movementSortDir);
        recomputeComparisonData();
      });
    });

    document.getElementById("movementPageSizeSelect").addEventListener("change", (e) => {
      state.comp.movementPageSize = Number(e.target.value);
      state.comp.movementPage = 1;
      recomputeComparisonData();
    });
    document.getElementById("movementPrevPageBtn").addEventListener("click", () => {
      if (state.comp.movementPage > 1) {
        state.comp.movementPage--;
        recomputeComparisonData();
      }
    });
    document.getElementById("movementNextPageBtn").addEventListener("click", () => {
      state.comp.movementPage++;
      recomputeComparisonData();
    });

    // Click on any Developer link (.dev-link) -> Open Developer Portfolio Modal
    document.addEventListener("click", (e) => {
      const devBtn = e.target.closest(".dev-link[data-dev]");
      if (devBtn) {
        e.preventDefault();
        e.stopPropagation();
        openDeveloperModal(devBtn.getAttribute("data-dev"));
      }
    });

    // Row Click -> Open App Detail Modal (including inside Developer Modal)
    ["allAppsTbody", "breakoutTbody", "movementTbody", "devAppsTbody"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("click", (e) => {
        if (e.target.closest("a, button")) return;
        const tr = e.target.closest("tr[data-pkg]");
        if (tr) {
          openAppModal(tr.getAttribute("data-pkg"));
        }
      });
    });

    // Developer Modal Table Sorting
    document.querySelectorAll("#devAppsTable thead th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.getAttribute("data-dsort");
        if (state.devModal.sortCol === col) {
          state.devModal.sortDir = state.devModal.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.devModal.sortCol = col;
          state.devModal.sortDir = col === "br" || col === "t" || col === "cl" ? "asc" : "desc";
        }
        updateSortHeaders("#devAppsTable", "data-dsort", state.devModal.sortCol, state.devModal.sortDir);
        renderDeveloperModalTable();
      });
    });

    // Developer Modal CSV Export
    const devCsvBtn = document.getElementById("devExportCsvBtn");
    if (devCsvBtn) {
      devCsvBtn.addEventListener("click", () => {
        const headers = [
          "package_name", "title", "developer", "segment", "category", "best_rank",
          "all_ranks", "install_tier", "exact_installs", "installs_per_day",
          "rating", "rating_count", "reviews_count", "released_on", "age_days", "updated_on",
          "free", "price_inr", "iap_range", "contains_ads", "content_rating",
          "screenshot_count", "developer_email", "developer_website", "short_description",
        ];
        const rows = state.devModal.apps.map((a) => [
          a.p,
          a.t,
          a.d,
          inferVertical(a),
          a.c,
          a.br,
          Object.entries(a.rk || {})
            .map(([k, v]) => `${k}:#${v}`)
            .join("; "),
          a.id,
          a.ie,
          a.vel,
          a.rt,
          a.rc,
          a.rv,
          a.ro,
          a.age,
          a.uo,
          a.f ? "yes" : "no",
          a.pr,
          a.iap,
          a.ads ? "yes" : "no",
          a.cr,
          a.sc,
          a.em,
          a.wb,
          a.sd,
        ]);
        const safeDev = (state.devModal.devName || "developer").replace(/[^a-zA-Z0-9_-]+/g, "_");
        downloadCsv(`play_developer_${safeDev}_${META.latest_run}.csv`, headers, rows);
      });
    }

    // CSV Exports
    document.getElementById("allExportCsvBtn").addEventListener("click", () => {
      const headers = [
        "package_name", "title", "developer", "category", "best_rank",
        "install_tier", "exact_installs", "installs_per_day", "rating",
        "rating_count", "reviews_count", "released_on", "updated_on",
        "iap_range", "contains_ads", "developer_email", "developer_website",
      ];
      const rows = state.all.filtered.map((a) => [
        a.p, a.t, a.d, a.c, a.br, a.id, a.ie, a.vel, a.rt,
        a.rc, a.rv, a.ro, a.uo, a.iap, a.ads ? "yes" : "no", a.em, a.wb,
      ]);
      downloadCsv(`play_all_apps_${META.latest_run}.csv`, headers, rows);
    });

    document.getElementById("breakoutExportCsvBtn").addEventListener("click", () => {
      const headers = [
        "package_name", "title", "breakout_status", "curr_rank", "prev_rank", "rank_delta",
        "category", "install_tier", "prev_install_tier", "exact_installs", "install_delta",
        "installs_per_day", "rating", "rating_count", "released_on", "developer", "developer_email",
      ];
      const rows = state.comp.breakoutRows.map((r) => [
        r.app.p, r.t, r.status, r.curr_rank, r.prev_rank, r.delta,
        r.cl, fmtBucket(r.im), fmtBucket(r.prev_im), r.ie, r.install_delta,
        r.vel, r.rt, r.app.rc, r.ro, r.d, r.app.em,
      ]);
      downloadCsv(`play_breakouts_${META.latest_run}_vs_${state.comp.baselineRun}.csv`, headers, rows);
    });

    document.getElementById("movementExportCsvBtn").addEventListener("click", () => {
      const headers = [
        "package_name", "title", "movement_type", "prev_rank", "curr_rank", "rank_delta",
        "category", "install_tier", "exact_installs", "install_delta", "rating", "released_on", "developer",
      ];
      const rows = state.comp.movementRows.map((r) => [
        r.app.p, r.t, r.move_type, r.prev_rank, r.curr_rank, r.delta,
        r.cl, fmtBucket(r.im), r.ie, r.install_delta, r.rt, r.ro, r.d,
      ]);
      downloadCsv(`play_rank_movement_${META.latest_run}_vs_${state.comp.baselineRun}.csv`, headers, rows);
    });

    // Mandatory fallback for browsers without <dialog closedby> support (modern-web-guidance: light-dismiss-a-dialog)
    ["appDetailDialog", "devDetailDialog"].forEach((dlgId) => {
      const dialog = document.getElementById(dlgId);
      if (dialog && !("closedBy" in HTMLDialogElement.prototype)) {
        dialog.addEventListener("click", (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent =
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width;
          if (isDialogContent) return;
          dialog.close();
        });
      }
    });
  }

  function updateSortHeaders(tableSel, attrName, activeCol, dir) {
    document.querySelectorAll(`${tableSel} thead th.sortable`).forEach((th) => {
      const c = th.getAttribute(attrName);
      const baseText = th.textContent.replace(/\s*[▲▼]$/, "");
      if (c === activeCol) {
        th.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
        th.textContent = baseText + (dir === "asc" ? " ▲" : " ▼");
      } else {
        th.removeAttribute("aria-sort");
        th.textContent = baseText;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

