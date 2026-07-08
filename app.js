"use strict";

const STORAGE_KEY = "fantasyAuctionDraftState.v1";
const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const SLEEPER_TRENDING_URL = "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=75";
const ROSTER_LIMITS = { QB: 2, RB: 2, WR: 3, TE: 1, FLEX: 1, DEF: 1, Bench: 7 };
const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);
const DRAFT_POSITIONS = new Set(["QB", "RB", "WR", "TE", "DEF", "K"]);

const state = {
  players: {},
  playerOrder: [],
  prep: {},
  drafted: [],
  teams: defaultTeams(),
  trending: {},
  selectedPlayerId: null,
  lastSleeperRefresh: null,
  history: []
};

const ui = {};
let filteredCacheKey = "";
let filteredCache = [];
let saveTimer = 0;
let filterTimer = 0;

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindElements();
  loadState();
  bindEvents();
  renderAll();
  if (!state.playerOrder.length) {
    seedPlayers();
    showMessage("Loaded starter sample players. Use Refresh Sleeper for the full player pool.");
  }
}

function bindElements() {
  [
    "importSleeperBtn", "importTrendingBtn", "exportBtn", "importFile", "playerCount",
    "availableCount", "draftedCount", "autosaveStatus", "selectedName", "selectedMeta",
    "selectedFlags", "draftTeam", "draftPrice", "draftBtn", "undoBtn", "favoriteToggle",
    "watchToggle", "tierInput", "customValueInput", "dndToggle", "notesInput", "searchInput",
    "positionFilter", "viewFilter", "clearFiltersBtn", "messages", "playerList", "addTeamBtn",
    "teamsList"
  ].forEach((id) => {
    ui[id] = document.getElementById(id);
  });
  ui.playerTemplate = document.getElementById("playerTemplate");
}

function bindEvents() {
  ui.importSleeperBtn.addEventListener("click", refreshSleeperPlayers);
  ui.importTrendingBtn.addEventListener("click", refreshTrendingPlayers);
  ui.exportBtn.addEventListener("click", exportState);
  ui.importFile.addEventListener("change", importState);
  ui.draftBtn.addEventListener("click", draftSelectedPlayer);
  ui.undoBtn.addEventListener("click", undoLastDraft);
  ui.addTeamBtn.addEventListener("click", addTeam);
  ui.clearFiltersBtn.addEventListener("click", clearFilters);

  ["searchInput", "positionFilter", "viewFilter"].forEach((id) => {
    ui[id].addEventListener("input", scheduleFilterRender);
    ui[id].addEventListener("change", scheduleFilterRender);
  });

  ["favoriteToggle", "watchToggle", "tierInput", "customValueInput", "dndToggle", "notesInput"].forEach((id) => {
    ui[id].addEventListener("input", updateSelectedPrep);
    ui[id].addEventListener("change", updateSelectedPrep);
  });
}

function defaultTeams() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: cryptoSafeId(`team-${index + 1}`),
    name: `Team ${index + 1}`
  }));
}

function cryptoSafeId(fallback) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${fallback}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    mergeImportedState(JSON.parse(saved), { silent: true });
    ui.autosaveStatus.textContent = "Restored";
  } catch (error) {
    showMessage(`Autosave restore failed: ${error.message}`, true);
  }
}

function scheduleSave() {
  ui.autosaveStatus.textContent = "Saving...";
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(createExportPayload()));
      ui.autosaveStatus.textContent = "Saved";
    } catch (error) {
      ui.autosaveStatus.textContent = "Save failed";
      showMessage(`Autosave failed: ${error.message}`, true);
    }
  }, 180);
}

function createExportPayload() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    players: state.players,
    playerOrder: state.playerOrder,
    prep: state.prep,
    drafted: state.drafted,
    teams: state.teams,
    trending: state.trending,
    lastSleeperRefresh: state.lastSleeperRefresh
  };
}

function mergeImportedState(payload, options = {}) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid JSON state file.");
  state.players = normalizePlayers(payload.players || {});
  state.playerOrder = Array.isArray(payload.playerOrder) ? payload.playerOrder.filter((id) => state.players[id]) : Object.keys(state.players);
  state.prep = normalizePrep(payload.prep || {});
  state.drafted = Array.isArray(payload.drafted) ? payload.drafted.filter((pick) => pick && state.players[pick.playerId]) : [];
  state.teams = normalizeTeams(payload.teams || defaultTeams());
  state.trending = payload.trending && typeof payload.trending === "object" ? payload.trending : {};
  state.lastSleeperRefresh = payload.lastSleeperRefresh || null;
  state.selectedPlayerId = state.playerOrder[0] || null;
  state.history = [];
  invalidateFilters();
  if (!options.silent) {
    renderAll();
    scheduleSave();
    showMessage("Imported draft state, teams, player prep, and roster history.");
  }
}

function normalizePlayers(players) {
  const normalized = {};
  Object.values(players).forEach((player) => {
    const clean = normalizePlayer(player);
    if (clean) normalized[clean.id] = clean;
  });
  return normalized;
}

function normalizePlayer(raw) {
  if (!raw) return null;
  const position = normalizePosition(raw.position || raw.fantasy_positions?.[0]);
  if (!position || !DRAFT_POSITIONS.has(position)) return null;
  const first = raw.first_name || "";
  const last = raw.last_name || "";
  const fullName = raw.full_name || raw.name || `${first} ${last}`.trim();
  if (!fullName) return null;
  const id = String(raw.id || raw.player_id || raw.sleeper_id || fullName);
  const team = raw.team || raw.team_abbr || (position === "DEF" ? id.toUpperCase() : "FA");
  const clean = {
    id,
    name: fullName,
    position,
    team,
    age: raw.age || "",
    status: raw.status || "",
    searchText: ""
  };
  clean.searchText = buildSearchText(clean, state.prep[id]);
  return clean;
}

function normalizePosition(position) {
  if (!position) return "";
  const clean = String(position).toUpperCase();
  if (clean === "DST") return "DEF";
  return clean;
}

function normalizePrep(prep) {
  const normalized = {};
  Object.entries(prep).forEach(([id, value]) => {
    normalized[id] = {
      favorite: Boolean(value.favorite),
      watch: Boolean(value.watch),
      notes: String(value.notes || ""),
      tier: String(value.tier || ""),
      customValue: value.customValue === "" || value.customValue == null ? "" : Number(value.customValue),
      doNotDraft: Boolean(value.doNotDraft)
    };
  });
  return normalized;
}

function normalizeTeams(teams) {
  if (!Array.isArray(teams) || !teams.length) return defaultTeams();
  return teams.map((team, index) => ({
    id: String(team.id || cryptoSafeId(`team-${index + 1}`)),
    name: String(team.name || `Team ${index + 1}`)
  }));
}

async function refreshSleeperPlayers() {
  ui.importSleeperBtn.disabled = true;
  showMessage("Refreshing Sleeper players...");
  try {
    const data = await fetchJsonWithTimeout(SLEEPER_PLAYERS_URL, 20000);
    const existingPrep = state.prep;
    const players = {};
    Object.entries(data).forEach(([id, raw]) => {
      const player = normalizePlayer({ ...raw, id });
      if (!player) return;
      players[player.id] = player;
    });
    state.players = players;
    state.playerOrder = Object.values(players)
      .sort(playerSort)
      .map((player) => player.id);
    state.prep = existingPrep;
    rebuildPlayerSearchText();
    state.lastSleeperRefresh = new Date().toISOString();
    invalidateFilters();
    renderAll();
    scheduleSave();
    showMessage(`Sleeper import complete: ${state.playerOrder.length.toLocaleString()} draftable players. Prep fields were preserved.`);
  } catch (error) {
    showMessage(`Sleeper import failed: ${error.message}. Existing cached players remain available.`, true);
  } finally {
    ui.importSleeperBtn.disabled = false;
  }
}

async function refreshTrendingPlayers() {
  ui.importTrendingBtn.disabled = true;
  showMessage("Refreshing Sleeper trending players...");
  try {
    const data = await fetchJsonWithTimeout(SLEEPER_TRENDING_URL, 12000);
    state.trending = {};
    data.forEach((item, index) => {
      state.trending[String(item.player_id)] = { count: item.count || 0, rank: index + 1 };
    });
    invalidateFilters();
    renderAll();
    scheduleSave();
    showMessage(`Trending import complete: ${data.length} players marked.`);
  } catch (error) {
    showMessage(`Trending import failed: ${error.message}.`, true);
  } finally {
    ui.importTrendingBtn.disabled = false;
  }
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
  try {
    const response = await fetch(url, { signal: controller ? controller.signal : undefined, cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

function seedPlayers() {
  const sample = [
    ["sample-mahomes", "Patrick Mahomes", "QB", "KC"],
    ["sample-jefferson", "Justin Jefferson", "WR", "MIN"],
    ["sample-bijan", "Bijan Robinson", "RB", "ATL"],
    ["sample-kelce", "Travis Kelce", "TE", "KC"],
    ["sample-ravens", "Baltimore Ravens", "DEF", "BAL"],
    ["sample-allen", "Josh Allen", "QB", "BUF"],
    ["sample-chase", "Ja'Marr Chase", "WR", "CIN"],
    ["sample-gibbs", "Jahmyr Gibbs", "RB", "DET"]
  ];
  state.players = {};
  sample.forEach(([id, name, position, team]) => {
    state.players[id] = { id, name, position, team, age: "", status: "", searchText: "" };
  });
  state.playerOrder = sample.map(([id]) => id);
  rebuildPlayerSearchText();
  invalidateFilters();
  renderAll();
  scheduleSave();
}

function playerSort(a, b) {
  const posWeight = { QB: 1, RB: 2, WR: 3, TE: 4, DEF: 5, K: 6 };
  return (posWeight[a.position] || 9) - (posWeight[b.position] || 9) || a.name.localeCompare(b.name);
}

function rebuildPlayerSearchText() {
  Object.values(state.players).forEach((player) => {
    player.searchText = buildSearchText(player, state.prep[player.id]);
  });
}

function buildSearchText(player, prep) {
  return [
    player.name,
    player.position,
    player.team,
    prep?.notes,
    prep?.tier,
    prep?.customValue
  ].filter(Boolean).join(" ").toLowerCase();
}

function renderAll() {
  renderStatus();
  renderDraftControls();
  renderSelectedPlayer();
  renderPlayers();
  renderTeams();
}

function renderStatus() {
  const draftedIds = draftedIdSet();
  ui.playerCount.textContent = state.playerOrder.length.toLocaleString();
  ui.availableCount.textContent = String(state.playerOrder.length - draftedIds.size);
  ui.draftedCount.textContent = String(draftedIds.size);
}

function renderDraftControls() {
  ui.draftTeam.innerHTML = "";
  state.teams.forEach((team) => {
    const option = document.createElement("option");
    option.value = team.id;
    option.textContent = team.name;
    ui.draftTeam.appendChild(option);
  });
  ui.undoBtn.disabled = state.drafted.length === 0;
}

function renderSelectedPlayer() {
  const player = state.players[state.selectedPlayerId];
  const prep = getPrep(state.selectedPlayerId);
  const drafted = player ? findDraftPick(player.id) : null;
  ui.draftBtn.disabled = !player || Boolean(drafted);
  setPrepDisabled(!player);
  if (!player) {
    ui.selectedName.textContent = "No player selected";
    ui.selectedMeta.textContent = "Pick a player to draft or edit prep notes.";
    ui.selectedFlags.innerHTML = "";
    return;
  }
  ui.selectedName.textContent = player.name;
  ui.selectedMeta.textContent = `${player.position} • ${player.team}${drafted ? ` • Drafted by ${teamName(drafted.teamId)} for $${drafted.price}` : ""}`;
  ui.favoriteToggle.checked = prep.favorite;
  ui.watchToggle.checked = prep.watch;
  ui.tierInput.value = prep.tier;
  ui.customValueInput.value = prep.customValue;
  ui.dndToggle.checked = prep.doNotDraft;
  ui.notesInput.value = prep.notes;
  ui.selectedFlags.innerHTML = "";
  badgeList(player, prep, drafted).forEach((badge) => ui.selectedFlags.appendChild(badge));
}

function setPrepDisabled(disabled) {
  ["favoriteToggle", "watchToggle", "tierInput", "customValueInput", "dndToggle", "notesInput"].forEach((id) => {
    ui[id].disabled = disabled;
  });
}

function renderPlayers() {
  const fragment = document.createDocumentFragment();
  getFilteredPlayers().forEach((player) => {
    const prep = getPrep(player.id);
    const drafted = findDraftPick(player.id);
    const card = ui.playerTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.playerId = player.id;
    card.classList.toggle("selected", player.id === state.selectedPlayerId);
    card.classList.toggle("drafted", Boolean(drafted));
    card.classList.toggle("do-not-draft", prep.doNotDraft);
    card.querySelector("h3").textContent = player.name;
    card.querySelector(".player-meta").textContent = `${player.position} • ${player.team}${drafted ? ` • ${teamName(drafted.teamId)} $${drafted.price}` : ""}`;
    card.querySelector(".player-notes").textContent = prep.notes || "";
    const favoriteBtn = card.querySelector(".favorite-btn");
    const watchBtn = card.querySelector(".watch-btn");
    favoriteBtn.textContent = prep.favorite ? "★" : "☆";
    watchBtn.textContent = prep.watch ? "●" : "○";
    favoriteBtn.classList.toggle("active", prep.favorite);
    watchBtn.classList.toggle("active", prep.watch);
    favoriteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePrep(player.id, "favorite");
    });
    watchBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePrep(player.id, "watch");
    });
    const badgeWrap = card.querySelector(".player-badges");
    badgeList(player, prep, drafted).forEach((badge) => badgeWrap.appendChild(badge));
    card.addEventListener("click", () => selectPlayer(player.id));
    fragment.appendChild(card);
  });
  ui.playerList.replaceChildren(fragment);
  ui.messages.dataset.count = String(filteredCache.length);
  if (!ui.messages.textContent || ui.messages.dataset.auto === "true") {
    showMessage(`${filteredCache.length.toLocaleString()} players shown.`, false, true);
  }
}

function badgeList(player, prep, drafted) {
  const badges = [];
  badges.push(makeBadge(player.position));
  if (prep.tier) badges.push(makeBadge(`Tier ${prep.tier}`, "good"));
  if (prep.customValue !== "") badges.push(makeBadge(`$${prep.customValue}`, "good"));
  if (state.trending[player.id]) badges.push(makeBadge(`Trending #${state.trending[player.id].rank}`, "warn"));
  if (prep.doNotDraft) badges.push(makeBadge("DND", "bad"));
  if (drafted) badges.push(makeBadge("Drafted", "bad"));
  return badges;
}

function makeBadge(text, kind) {
  const span = document.createElement("span");
  span.className = `badge${kind ? ` ${kind}` : ""}`;
  span.textContent = text;
  return span;
}

function getFilteredPlayers() {
  const query = ui.searchInput.value.trim().toLowerCase();
  const position = ui.positionFilter.value;
  const view = ui.viewFilter.value;
  const draftKey = state.drafted.map((pick) => pick.playerId).join(",");
  const prepKey = Object.entries(state.prep).map(([id, prep]) => `${id}:${Number(prep.favorite)}${Number(prep.watch)}${Number(prep.doNotDraft)}:${prep.tier}:${prep.notes}:${prep.customValue}`).join("|");
  const trendKey = Object.keys(state.trending).join(",");
  const key = `${query}|${position}|${view}|${draftKey}|${prepKey}|${trendKey}|${state.playerOrder.length}`;
  if (key === filteredCacheKey) return filteredCache;
  const drafted = draftedIdSet();
  filteredCache = state.playerOrder.map((id) => state.players[id]).filter((player) => {
    if (!player) return false;
    const prep = getPrep(player.id);
    if (position !== "ALL" && player.position !== position) return false;
    if (query && !player.searchText.includes(query)) return false;
    if (view === "available" && drafted.has(player.id)) return false;
    if (view === "drafted" && !drafted.has(player.id)) return false;
    if (view === "watch" && !prep.watch) return false;
    if (view === "favorites" && !prep.favorite) return false;
    if (view === "dnd" && !prep.doNotDraft) return false;
    if (view === "trending" && !state.trending[player.id]) return false;
    return true;
  }).slice(0, 350);
  filteredCacheKey = key;
  return filteredCache;
}

function scheduleFilterRender() {
  clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => {
    invalidateFilters();
    renderPlayers();
  }, 60);
}

function invalidateFilters() {
  filteredCacheKey = "";
}

function selectPlayer(playerId) {
  state.selectedPlayerId = playerId;
  renderSelectedPlayer();
  renderPlayers();
}

function updateSelectedPrep() {
  if (!state.selectedPlayerId) return;
  const prep = getPrep(state.selectedPlayerId);
  prep.favorite = ui.favoriteToggle.checked;
  prep.watch = ui.watchToggle.checked;
  prep.tier = ui.tierInput.value.trim();
  prep.customValue = ui.customValueInput.value === "" ? "" : Number(ui.customValueInput.value);
  prep.doNotDraft = ui.dndToggle.checked;
  prep.notes = ui.notesInput.value;
  state.players[state.selectedPlayerId].searchText = buildSearchText(state.players[state.selectedPlayerId], prep);
  invalidateFilters();
  renderSelectedPlayer();
  renderPlayers();
  scheduleSave();
}

function togglePrep(playerId, field) {
  const prep = getPrep(playerId);
  prep[field] = !prep[field];
  state.players[playerId].searchText = buildSearchText(state.players[playerId], prep);
  invalidateFilters();
  renderSelectedPlayer();
  renderPlayers();
  scheduleSave();
}

function getPrep(playerId) {
  if (!playerId) return { favorite: false, watch: false, notes: "", tier: "", customValue: "", doNotDraft: false };
  if (!state.prep[playerId]) {
    state.prep[playerId] = { favorite: false, watch: false, notes: "", tier: "", customValue: "", doNotDraft: false };
  }
  return state.prep[playerId];
}

function draftSelectedPlayer() {
  const player = state.players[state.selectedPlayerId];
  if (!player || findDraftPick(player.id)) return;
  const pick = {
    playerId: player.id,
    teamId: ui.draftTeam.value,
    price: Number(ui.draftPrice.value || 0),
    draftedAt: new Date().toISOString()
  };
  state.drafted.push(pick);
  state.history.push({ type: "draft", pick });
  invalidateFilters();
  renderAll();
  scheduleSave();
  showMessage(`${player.name} drafted by ${teamName(pick.teamId)} for $${pick.price}.`);
}

function undoLastDraft() {
  const last = state.drafted.pop();
  if (!last) return;
  state.history.push({ type: "undo", pick: last });
  invalidateFilters();
  renderAll();
  scheduleSave();
  showMessage(`Undid draft pick: ${state.players[last.playerId]?.name || "Unknown player"}.`);
}

function draftedIdSet() {
  return new Set(state.drafted.map((pick) => pick.playerId));
}

function findDraftPick(playerId) {
  return state.drafted.find((pick) => pick.playerId === playerId);
}

function renderTeams() {
  const rosters = buildTeamRosters();
  const fragment = document.createDocumentFragment();
  state.teams.forEach((team, index) => {
    const card = document.createElement("article");
    card.className = "team-card";
    const nameRow = document.createElement("div");
    nameRow.className = "team-name-row";
    const input = document.createElement("input");
    input.value = team.name;
    input.setAttribute("aria-label", `Team ${index + 1} name`);
    input.addEventListener("input", () => {
      team.name = input.value || `Team ${index + 1}`;
      renderDraftControls();
      renderSelectedPlayer();
      scheduleSave();
    });
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.disabled = state.teams.length <= 1 || state.drafted.some((pick) => pick.teamId === team.id);
    remove.addEventListener("click", () => removeTeam(team.id));
    nameRow.append(input, remove);
    const needs = document.createElement("div");
    needs.className = "needs-grid";
    Object.entries(rosters[team.id]).forEach(([slot, count]) => {
      const limit = ROSTER_LIMITS[slot];
      const item = document.createElement("div");
      item.className = `need ${count >= limit ? "full" : "open"}`;
      item.setAttribute("aria-label", `${slot} ${count}/${limit}`);
      item.innerHTML = `<span>${slot}</span><span>${count}/${limit}</span>`;
      needs.appendChild(item);
    });
    card.append(nameRow, needs);
    fragment.appendChild(card);
  });
  ui.teamsList.replaceChildren(fragment);
}

function buildTeamRosters() {
  const rosters = {};
  state.teams.forEach((team) => {
    rosters[team.id] = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, DEF: 0, Bench: 0 };
  });
  state.drafted.forEach((pick) => {
    const roster = rosters[pick.teamId];
    const player = state.players[pick.playerId];
    if (!roster || !player) return;
    assignRosterSlot(roster, player.position);
  });
  return rosters;
}

function assignRosterSlot(roster, position) {
  if (position === "DEF") {
    roster.DEF += 1;
  } else if (ROSTER_LIMITS[position] && roster[position] < ROSTER_LIMITS[position]) {
    roster[position] += 1;
  } else if (FLEX_POSITIONS.has(position) && roster.FLEX < ROSTER_LIMITS.FLEX) {
    roster.FLEX += 1;
  } else {
    roster.Bench += 1;
  }
}

function addTeam() {
  state.teams.push({ id: cryptoSafeId("team"), name: `Team ${state.teams.length + 1}` });
  renderAll();
  scheduleSave();
}

function removeTeam(teamId) {
  state.teams = state.teams.filter((team) => team.id !== teamId);
  renderAll();
  scheduleSave();
}

function teamName(teamId) {
  return state.teams.find((team) => team.id === teamId)?.name || "Unknown Team";
}

function clearFilters() {
  ui.searchInput.value = "";
  ui.positionFilter.value = "ALL";
  ui.viewFilter.value = "available";
  invalidateFilters();
  renderPlayers();
}

function exportState() {
  const blob = new Blob([JSON.stringify(createExportPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fantasy-auction-draft-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showMessage("Exported JSON with teams, prep fields, draft picks, and player data.");
}

function importState(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      mergeImportedState(JSON.parse(String(reader.result || "{}")));
    } catch (error) {
      showMessage(`Import failed: ${error.message}`, true);
    } finally {
      ui.importFile.value = "";
    }
  };
  reader.readAsText(file);
}

function showMessage(message, isError = false, auto = false) {
  ui.messages.dataset.auto = String(auto);
  ui.messages.innerHTML = isError ? `<strong>Error:</strong> ${escapeHtml(message)}` : escapeHtml(message);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
