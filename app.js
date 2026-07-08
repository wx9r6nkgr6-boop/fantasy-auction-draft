"use strict";

const STORAGE_KEY = "fantasyAuctionDraftState.v2";
const LEGACY_STORAGE_KEY = "fantasyAuctionDraftState.v1";
const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const SLEEPER_TRENDING_URL = "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=75";
const ROSTER_LIMITS = { QB: 2, RB: 2, WR: 3, TE: 1, FLEX: 1, DEF: 1, Bench: 7, IR: 1 };
const REQUIRED_ROSTER_SLOTS = ["QB", "RB", "WR", "TE", "FLEX", "DEF", "Bench"];
const REQUIRED_ROSTER_SIZE = REQUIRED_ROSTER_SLOTS.reduce((sum, slot) => sum + ROSTER_LIMITS[slot], 0);
const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);
const OFFENSIVE_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const DRAFT_POSITIONS = new Set(["QB", "RB", "WR", "TE", "DEF"]);
const ACTIVE_STATUSES = new Set(["Active", "Injured Reserve", "Physically Unable to Perform", "Non Football Injury", "Suspended"]);
const CORE_LIMITS = { QB: 70, RB: 180, WR: 240, TE: 110, DEF: 32 };
const DEEP_LIMITS = { QB: 115, RB: 330, WR: 460, TE: 220, DEF: 32 };
const POSITION_VALUE_CURVES = {
  QB: { max: 52, starterCut: 24, deepCut: 70, shape: 1.25 },
  RB: { max: 58, starterCut: 62, deepCut: 180, shape: 1.32 },
  WR: { max: 56, starterCut: 72, deepCut: 240, shape: 1.36 },
  TE: { max: 34, starterCut: 18, deepCut: 110, shape: 1.42 },
  DEF: { max: 5, starterCut: 12, deepCut: 32, shape: 1.2 }
};
const TEAM_DEFENSES = [
  ["ARI", "Arizona Cardinals"], ["ATL", "Atlanta Falcons"], ["BAL", "Baltimore Ravens"], ["BUF", "Buffalo Bills"],
  ["CAR", "Carolina Panthers"], ["CHI", "Chicago Bears"], ["CIN", "Cincinnati Bengals"], ["CLE", "Cleveland Browns"],
  ["DAL", "Dallas Cowboys"], ["DEN", "Denver Broncos"], ["DET", "Detroit Lions"], ["GB", "Green Bay Packers"],
  ["HOU", "Houston Texans"], ["IND", "Indianapolis Colts"], ["JAX", "Jacksonville Jaguars"], ["KC", "Kansas City Chiefs"],
  ["LAC", "Los Angeles Chargers"], ["LAR", "Los Angeles Rams"], ["LV", "Las Vegas Raiders"], ["MIA", "Miami Dolphins"],
  ["MIN", "Minnesota Vikings"], ["NE", "New England Patriots"], ["NO", "New Orleans Saints"], ["NYG", "New York Giants"],
  ["NYJ", "New York Jets"], ["PHI", "Philadelphia Eagles"], ["PIT", "Pittsburgh Steelers"], ["SEA", "Seattle Seahawks"],
  ["SF", "San Francisco 49ers"], ["TB", "Tampa Bay Buccaneers"], ["TEN", "Tennessee Titans"], ["WAS", "Washington Commanders"]
];
const FANTASY_ANCHORS = buildFantasyAnchors();

const state = {
  players: {},
  playerOrder: [],
  prep: {},
  drafted: [],
  teams: defaultTeams(),
  trending: {},
  settings: defaultSettings(),
  selectedPlayerId: null,
  lastSleeperRefresh: null,
  history: []
};

const ui = {};
let filteredCacheKey = "";
let filteredCache = [];
let saveTimer = 0;
let filterTimer = 0;
let contextLock = null;
let promptEngine = null;
let assistantCollapsed = false;

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindElements();
  contextLock = window.DraftContextLock.createDraftContextLock();
  promptEngine = window.ChatGPTPromptEngine.createPromptEngine({ contextLock });
  loadState();
  ensureSettings();
  bindEvents();
  if (!state.playerOrder.length) {
    seedPlayers();
    showMessage("Loaded starter sample players. Use Refresh Sleeper for the cleaned draft pool.");
  } else {
    rerankPlayers();
  }
  renderAll();
}

function bindElements() {
  [
    "importSleeperBtn", "importTrendingBtn", "exportBtn", "importFile", "playerCount", "availableCount",
    "draftedCount", "autosaveStatus", "myTeamSelect", "myTeamSummary", "selectedName", "selectedMeta",
    "selectedFlags", "selectedScarcity", "nominatingTeam", "draftTeam", "draftBudgetHint", "draftPrice", "draftBtn", "undoBtn",
    "targetToggle", "sleeperToggle", "avoidToggle", "tierInput", "customValueInput", "notesInput",
    "draftAssistantPanel", "toggleAssistantBtn", "assistantBody", "assistantSummary", "promptTypeSelect",
    "previewPromptBtn", "copyPromptBtn", "openChatGPTBtn", "assistantToast", "promptOutput", "searchInput",
    "positionFilter", "tierFilter", "labelFilter", "sortFilter", "showDeepPoolToggle", "clearFiltersBtn",
    "liveDraftTab", "teamRostersTab", "draftBoardTab", "liveDraftView", "teamRostersView", "draftBoardView",
    "boardPositionFilter", "boardTeamFilter", "boardSortFilter", "teamRostersList", "draftBoardList",
    "messages", "playerList", "addTeamBtn", "leagueBudgetInput", "teamsList"
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
  ui.nominatingTeam.addEventListener("change", scheduleSave);
  ui.draftTeam.addEventListener("change", () => {
    renderDraftBudgetHint();
    renderDraftAssistant();
    scheduleSave();
  });
  ui.draftPrice.addEventListener("input", () => {
    renderDraftBudgetHint();
    renderDraftAssistant();
  });
  ui.myTeamSelect.addEventListener("change", () => {
    state.settings.myTeamId = ui.myTeamSelect.value;
    renderAll();
    scheduleSave();
  });
  ui.leagueBudgetInput.addEventListener("input", () => {
    state.settings.budget = Math.max(1, Number(ui.leagueBudgetInput.value || 200));
    renderAll();
    scheduleSave();
  });
  ui.showDeepPoolToggle.addEventListener("change", () => {
    state.settings.showDeepPool = ui.showDeepPoolToggle.checked;
    invalidateFilters();
    renderPlayers();
    renderStatus();
    scheduleSave();
  });

  ["searchInput", "positionFilter", "tierFilter", "labelFilter", "sortFilter"].forEach((id) => {
    ui[id].addEventListener("input", scheduleFilterRender);
    ui[id].addEventListener("change", scheduleFilterRender);
  });
  ["boardPositionFilter", "boardTeamFilter", "boardSortFilter"].forEach((id) => {
    ui[id].addEventListener("input", renderDraftBoard);
    ui[id].addEventListener("change", renderDraftBoard);
  });
  ["liveDraftTab", "teamRostersTab", "draftBoardTab"].forEach((id) => {
    ui[id].addEventListener("click", () => setActiveView(ui[id].dataset.view));
  });

  ["targetToggle", "sleeperToggle", "avoidToggle"].forEach((id) => {
    ui[id].addEventListener("click", () => setSelectedLabel(ui[id].dataset.label));
  });

  ["tierInput", "customValueInput", "notesInput"].forEach((id) => {
    ui[id].addEventListener("input", updateSelectedPrep);
    ui[id].addEventListener("change", updateSelectedPrep);
  });

  ui.toggleAssistantBtn.addEventListener("click", toggleDraftAssistant);
  ui.promptTypeSelect.addEventListener("change", previewPrompt);
  ui.previewPromptBtn.addEventListener("click", previewPrompt);
  ui.copyPromptBtn.addEventListener("click", copySelectedPrompt);
  ui.openChatGPTBtn.addEventListener("click", openSelectedPromptInChatGPT);
}

function defaultSettings() {
  return {
    myTeamId: "",
    budget: 200,
    showDeepPool: false,
    activeView: "live"
  };
}

function buildFantasyAnchors() {
  const byPosition = {
    QB: ["Josh Allen", "Lamar Jackson", "Jalen Hurts", "Patrick Mahomes", "Joe Burrow", "Jayden Daniels", "C.J. Stroud", "Justin Herbert", "Kyler Murray", "Jordan Love", "Brock Purdy", "Dak Prescott", "Caleb Williams", "Tua Tagovailoa", "Trevor Lawrence", "Drake Maye", "Anthony Richardson", "Bo Nix", "Baker Mayfield", "Jared Goff", "Matthew Stafford", "Justin Fields", "J.J. McCarthy", "Michael Penix"],
    RB: ["Bijan Robinson", "Jahmyr Gibbs", "Saquon Barkley", "Christian McCaffrey", "Breece Hall", "Jonathan Taylor", "De'Von Achane", "Derrick Henry", "Josh Jacobs", "Kyren Williams", "Ashton Jeanty", "Chase Brown", "James Cook", "Kenneth Walker", "Bucky Irving", "Alvin Kamara", "Chuba Hubbard", "Joe Mixon", "Omarion Hampton", "TreVeyon Henderson", "David Montgomery", "Aaron Jones", "D'Andre Swift", "Isiah Pacheco", "Tony Pollard", "Tyrone Tracy", "Rhamondre Stevenson", "Brian Robinson"],
    WR: ["Ja'Marr Chase", "Justin Jefferson", "CeeDee Lamb", "Amon-Ra St. Brown", "Puka Nacua", "Nico Collins", "A.J. Brown", "Brian Thomas", "Malik Nabers", "Drake London", "Ladd McConkey", "Tee Higgins", "Marvin Harrison", "Mike Evans", "Tyreek Hill", "Garrett Wilson", "Davante Adams", "Jaxon Smith-Njigba", "Rashee Rice", "DK Metcalf", "Terry McLaurin", "Courtland Sutton", "DeVonta Smith", "DJ Moore", "George Pickens", "Zay Flowers", "Chris Olave", "Jaylen Waddle", "Jameson Williams", "Xavier Worthy", "Rome Odunze", "Jordan Addison"],
    TE: ["Brock Bowers", "Trey McBride", "George Kittle", "Sam LaPorta", "Travis Kelce", "Mark Andrews", "T.J. Hockenson", "Evan Engram", "David Njoku", "Jake Ferguson", "Dallas Goedert", "Tucker Kraft", "Kyle Pitts", "Dalton Kincaid", "Pat Freiermuth", "Hunter Henry", "Zach Ertz", "Colston Loveland"],
    DEF: TEAM_DEFENSES.map(([, name]) => `${name} DEF`)
  };
  const anchors = {};
  Object.entries(byPosition).forEach(([position, names]) => {
    names.forEach((name, index) => {
      anchors[`${position}:${nameKey(name)}`] = index + 1;
    });
  });
  return anchors;
}

function defaultTeams() {
  const names = ["Kyle", "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Sam", "Drew", "Jamie"];
  return names.map((name, index) => ({
    id: cryptoSafeId(`team-${index + 1}`),
    name
  }));
}

function cryptoSafeId(fallback) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${fallback}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nameKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return;
    mergeImportedState(JSON.parse(saved), { silent: true });
    ui.autosaveStatus.textContent = "Restored";
  } catch (error) {
    showMessage(`Autosave restore failed: ${error.message}`, true);
  }
}

function ensureSettings() {
  state.settings = { ...defaultSettings(), ...state.settings };
  if (!state.settings.myTeamId || !state.teams.some((team) => team.id === state.settings.myTeamId)) {
    state.settings.myTeamId = state.teams[0]?.id || "";
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
  }, 160);
}

function createExportPayload() {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    players: state.players,
    playerOrder: state.playerOrder,
    prep: state.prep,
    drafted: state.drafted,
    teams: state.teams,
    trending: state.trending,
    settings: state.settings,
    lastSleeperRefresh: state.lastSleeperRefresh
  };
}

function mergeImportedState(payload, options = {}) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid JSON state file.");
  state.settings = { ...defaultSettings(), ...(payload.settings || {}) };
  state.teams = normalizeTeams(payload.teams || defaultTeams());
  ensureSettings();
  state.prep = normalizePrep(payload.prep || {});
  state.trending = payload.trending && typeof payload.trending === "object" ? payload.trending : {};
  state.players = normalizePlayers(payload.players || {});
  state.playerOrder = Array.isArray(payload.playerOrder) ? payload.playerOrder.filter((id) => state.players[id]) : Object.keys(state.players);
  const importedDrafted = payload.drafted || [];
  state.drafted = [];
  state.lastSleeperRefresh = payload.lastSleeperRefresh || null;
  state.selectedPlayerId = state.playerOrder[0] || null;
  state.history = [];
  rerankPlayers();
  state.drafted = normalizeDrafted(importedDrafted);
  invalidateFilters();
  if (!options.silent) {
    renderAll();
    scheduleSave();
    showMessage("Imported draft state, My Team, labels, tiers, teams, budgets, and roster history.");
  }
}

function normalizePlayers(players) {
  const normalized = {};
  Object.values(players).forEach((player) => {
    const clean = normalizePlayer(player);
    if (clean) normalized[clean.id] = clean;
  });
  ensureTeamDefenses(normalized);
  return normalized;
}

function normalizePlayer(raw) {
  if (!raw) return null;
  const position = normalizePosition(raw.position || raw.fantasy_positions?.[0]);
  if (!position || !DRAFT_POSITIONS.has(position)) return null;
  if (position !== "DEF" && !OFFENSIVE_POSITIONS.has(position)) return null;
  const first = raw.first_name || "";
  const last = raw.last_name || "";
  const fullName = raw.full_name || raw.name || `${first} ${last}`.trim();
  if (!fullName) return null;
  const id = String(raw.id || raw.player_id || raw.sleeper_id || fullName);
  const team = raw.team || raw.team_abbr || (position === "DEF" ? defenseTeamFromId(id) : "FA");
  const status = raw.status || (raw.active ? "Active" : "") || (position === "DEF" ? "Active" : "");
  const searchRank = numberOrFallback(raw.search_rank ?? raw.searchRank, 9999);
  const clean = {
    id,
    name: position === "DEF" && !fullName.includes("DEF") ? `${fullName} DEF` : fullName,
    position,
    team: team || "FA",
    age: raw.age || "",
    status,
    searchRank,
    yearsExp: numberOrFallback(raw.years_exp ?? raw.yearsExp, 0),
    depthChartOrder: numberOrFallback(raw.depth_chart_order ?? raw.depthChartOrder, 99),
    active: position === "DEF" || Boolean(raw.active) || ACTIVE_STATUSES.has(status),
    core: Boolean(raw.core),
    autoTier: String(raw.autoTier || ""),
    overallRank: Number(raw.overallRank || 9999),
    positionRank: Number(raw.positionRank || 9999),
    positionRankLabel: raw.positionRankLabel || "",
    heuristicScore: Number(raw.heuristicScore || 9999),
    estimatedValue: Number(raw.estimatedValue || 1),
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
    const legacyLabel = value.doNotDraft ? "avoid" : "";
    normalized[id] = {
      label: normalizeLabel(value.label || legacyLabel),
      notes: String(value.notes || ""),
      tier: String(value.tier || ""),
      customValue: value.customValue === "" || value.customValue == null ? "" : Number(value.customValue)
    };
  });
  return normalized;
}

function normalizeDrafted(drafted) {
  if (!Array.isArray(drafted)) return [];
  return drafted
    .filter((pick) => pick && state.players[pick.playerId])
    .map((pick) => {
      const player = state.players[pick.playerId];
      const prep = getPrep(pick.playerId);
      return {
        playerId: String(pick.playerId),
        nominatedByTeamId: String(pick.nominatedByTeamId || pick.nominatorTeamId || pick.teamId || state.settings.myTeamId || ""),
        teamId: String(pick.teamId || ""),
        price: Number(pick.price || 0),
        position: pick.position || player.position,
        tier: String(pick.tier || effectiveTier(player, prep)),
        estimatedValue: Number(pick.estimatedValue || player.estimatedValue || 1),
        customValue: pick.customValue === "" || pick.customValue == null ? "" : Number(pick.customValue),
        auctionValue: Number(pick.auctionValue || pick.customValue || pick.estimatedValue || player.estimatedValue || 1),
        draftedAt: pick.draftedAt || new Date().toISOString()
      };
    });
}

function normalizeLabel(label) {
  return ["target", "sleeper", "avoid"].includes(label) ? label : "";
}

function normalizeTeams(teams) {
  if (!Array.isArray(teams) || !teams.length) return defaultTeams();
  return teams.map((team, index) => ({
    id: String(team.id || cryptoSafeId(`team-${index + 1}`)),
    name: String(team.name || `Manager ${index + 1}`)
  }));
}

async function refreshSleeperPlayers() {
  ui.importSleeperBtn.disabled = true;
  showMessage("Refreshing Sleeper players and rebuilding the cleaned draft pool...");
  try {
    const data = await fetchJsonWithTimeout(SLEEPER_PLAYERS_URL, 20000);
    const existingPrep = state.prep;
    const players = {};
    Object.entries(data).forEach(([id, raw]) => {
      const player = normalizePlayer({ ...raw, id });
      if (!player) return;
      if (!isDraftRelevant(player, false) && !isDraftRelevant(player, true)) return;
      players[player.id] = player;
    });
    ensureTeamDefenses(players);
    state.players = players;
    state.prep = existingPrep;
    rerankPlayers();
    state.lastSleeperRefresh = new Date().toISOString();
    invalidateFilters();
    renderAll();
    scheduleSave();
    const coreCount = Object.values(state.players).filter((player) => player.core).length;
    showMessage(`Sleeper import complete: ${coreCount.toLocaleString()} core players, ${state.playerOrder.length.toLocaleString()} total cleaned players with deep pool on.`);
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
    rerankPlayers();
    invalidateFilters();
    renderAll();
    scheduleSave();
    showMessage(`Trending import complete: ${data.length} players marked and fallback ranks refreshed.`);
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
    ["sample-mahomes", "Patrick Mahomes", "QB", "KC", 1],
    ["sample-allen", "Josh Allen", "QB", "BUF", 2],
    ["sample-bijan", "Bijan Robinson", "RB", "ATL", 3],
    ["sample-jefferson", "Justin Jefferson", "WR", "MIN", 4],
    ["sample-chase", "Ja'Marr Chase", "WR", "CIN", 5],
    ["sample-gibbs", "Jahmyr Gibbs", "RB", "DET", 6],
    ["sample-kelce", "Travis Kelce", "TE", "KC", 7],
    ["sample-ravens", "Baltimore Ravens DEF", "DEF", "BAL", 8]
  ];
  state.players = {};
  sample.forEach(([id, name, position, team, searchRank]) => {
    state.players[id] = normalizePlayer({ id, name, position, team, status: "Active", search_rank: searchRank, core: true });
  });
  ensureTeamDefenses(state.players);
  rerankPlayers();
  invalidateFilters();
  scheduleSave();
}

function ensureTeamDefenses(players) {
  const existingTeams = new Set(Object.values(players).filter((player) => player.position === "DEF").map((player) => player.team));
  TEAM_DEFENSES.forEach(([abbr, name], index) => {
    if (existingTeams.has(abbr)) return;
    const id = `def-${abbr.toLowerCase()}`;
    players[id] = normalizePlayer({
      id,
      name: `${name} DEF`,
      position: "DEF",
      team: abbr,
      status: "Active",
      search_rank: 600 + index,
      core: true
    });
  });
}

function defenseTeamFromId(id) {
  const upper = String(id || "").toUpperCase();
  return TEAM_DEFENSES.some(([abbr]) => abbr === upper) ? upper : "DEF";
}

function isDraftRelevant(player, deep) {
  if (player.position === "DEF") return true;
  if (!OFFENSIVE_POSITIONS.has(player.position)) return false;
  if (!player.active) return false;
  if (!deep && (!player.team || player.team === "FA")) return false;
  const limit = deep ? DEEP_LIMITS[player.position] : CORE_LIMITS[player.position];
  const looseSearchCap = deep ? 9999 : 7500;
  return player.searchRank <= looseSearchCap || player.depthChartOrder <= 4 || player.yearsExp <= 2 || limit > 0;
}

function rerankPlayers() {
  const players = Object.values(state.players).filter(Boolean);
  players.forEach((player) => {
    player.heuristicScore = fallbackScore(player);
  });
  const byPosition = {};
  DRAFT_POSITIONS.forEach((position) => {
    byPosition[position] = players
      .filter((player) => player.position === position)
      .sort((a, b) => a.heuristicScore - b.heuristicScore || a.name.localeCompare(b.name));
    byPosition[position].forEach((player, index) => {
      player.positionRank = index + 1;
      player.positionRankLabel = `${player.position}${index + 1}`;
      player.autoTier = String(autoTierFor(player.position, index + 1));
      player.core = player.positionRank <= CORE_LIMITS[player.position] && player.active && (player.position === "DEF" || player.team !== "FA");
      player.estimatedValue = estimateAuctionValue(player);
      player.searchText = buildSearchText(player, state.prep[player.id]);
    });
  });
  state.playerOrder = players
    .filter((player) => player.positionRank <= DEEP_LIMITS[player.position])
    .sort((a, b) => effectiveAuctionValue(b, getPrep(b.id)) - effectiveAuctionValue(a, getPrep(a.id)) || a.heuristicScore - b.heuristicScore || a.name.localeCompare(b.name))
    .map((player, index) => {
      player.overallRank = index + 1;
      player.searchText = buildSearchText(player, state.prep[player.id]);
      return player.id;
    });
  syncTierFilterOptions();
}

function fallbackScore(player) {
  const anchor = anchorRank(player);
  const positionOffset = { RB: 0, WR: 5, QB: 8, TE: 22, DEF: 115 }[player.position] || 160;
  const searchComponent = Math.min(player.searchRank, 9999) / 55;
  const depthComponent = Math.min(player.depthChartOrder, 99) * 3.4;
  const agePenalty = player.age && (player.age < 21 || player.age > 32) ? 10 : 0;
  const freeAgentPenalty = player.team === "FA" ? 45 : 0;
  const inactivePenalty = player.active ? 0 : 100;
  const trendingBoost = state.trending[player.id] ? Math.max(0, 9 - state.trending[player.id].rank / 12) : 0;
  const anchorComponent = anchor ? anchor * 1.65 : 175;
  const rookieUpside = player.yearsExp <= 1 && player.depthChartOrder <= 3 ? -6 : 0;
  return positionOffset + anchorComponent + searchComponent + depthComponent + agePenalty + freeAgentPenalty + inactivePenalty + rookieUpside - trendingBoost;
}

function anchorRank(player) {
  const keys = [
    `${player.position}:${nameKey(player.name)}`,
    `${player.position}:${nameKey(String(player.name || "").replace(/\s+DEF$/i, ""))}`,
    `${player.position}:${nameKey(`${player.team} DEF`)}`
  ];
  return keys.map((key) => FANTASY_ANCHORS[key]).find(Boolean) || 0;
}

function estimateAuctionValue(player) {
  const curve = POSITION_VALUE_CURVES[player.position] || { max: 12, starterCut: 40, deepCut: 100, shape: 1.4 };
  const rank = Math.max(1, Number(player.positionRank || 999));
  if (!player.active || player.team === "FA" || rank > curve.deepCut) return 1;
  const remaining = Math.max(0, curve.starterCut - rank + 1);
  const ratio = remaining / curve.starterCut;
  if (ratio <= 0) return player.position === "DEF" ? 1 : Math.max(1, Math.round(4 - Math.min(3, (rank - curve.starterCut) / 28)));
  return Math.max(1, Math.round(curve.max * Math.pow(ratio, curve.shape)));
}

function effectiveAuctionValue(player, prep) {
  const custom = prep?.customValue;
  const number = Number(custom);
  return custom !== "" && custom != null && Number.isFinite(number) ? number : Number(player?.estimatedValue || 1);
}

function autoTierFor(position, rank) {
  const bands = {
    QB: [6, 14, 24, 36, 55],
    RB: [12, 24, 42, 70, 110],
    WR: [12, 24, 42, 72, 120],
    TE: [6, 12, 22, 38, 70],
    DEF: [5, 10, 16, 24, 32]
  }[position] || [12, 24, 48, 96];
  const tier = bands.findIndex((maxRank) => rank <= maxRank);
  return tier === -1 ? bands.length + 1 : tier + 1;
}

function numberOrFallback(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildSearchText(player, prep) {
  return [
    player.name,
    player.position,
    player.team,
    player.positionRankLabel,
    `overall ${player.overallRank}`,
    `tier ${effectiveTier(player, prep)}`,
    `est ${player.estimatedValue}`,
    prep?.label,
    prep?.notes,
    prep?.customValue
  ].filter(Boolean).join(" ").toLowerCase();
}

function renderAll() {
  syncControlValues();
  renderViewTabs();
  renderStatus();
  renderDraftControls();
  renderMyTeamSummary();
  renderSelectedPlayer();
  renderPlayers();
  renderTeams();
  renderTeamRosters();
  renderDraftBoard();
  renderDraftAssistant();
}

function syncControlValues() {
  ui.showDeepPoolToggle.checked = Boolean(state.settings.showDeepPool);
  ui.leagueBudgetInput.value = state.settings.budget;
  syncTierFilterOptions();
}

function syncTierFilterOptions() {
  if (!ui.tierFilter) return;
  const current = ui.tierFilter.value || "ALL";
  const tiers = Array.from(new Set(Object.values(state.players).map((player) => effectiveTier(player, getPrep(player.id))).filter(Boolean))).sort(tierSort);
  ui.tierFilter.innerHTML = '<option value="ALL">All</option>';
  tiers.forEach((tier) => {
    const option = document.createElement("option");
    option.value = tier;
    option.textContent = `Tier ${tier}`;
    ui.tierFilter.appendChild(option);
  });
  ui.tierFilter.value = tiers.includes(current) ? current : "ALL";
}

function renderViewTabs() {
  const activeView = state.settings.activeView || "live";
  [
    ["liveDraftTab", "liveDraftView", "live"],
    ["teamRostersTab", "teamRostersView", "rosters"],
    ["draftBoardTab", "draftBoardView", "board"]
  ].forEach(([tabId, viewId, value]) => {
    const isActive = activeView === value;
    ui[tabId].classList.toggle("active", isActive);
    ui[tabId].setAttribute("aria-selected", String(isActive));
    ui[viewId].classList.toggle("active", isActive);
    ui[viewId].hidden = !isActive;
  });
}

function setActiveView(view) {
  state.settings.activeView = ["live", "rosters", "board"].includes(view) ? view : "live";
  renderViewTabs();
  if (state.settings.activeView === "rosters") renderTeamRosters();
  if (state.settings.activeView === "board") renderDraftBoard();
  scheduleSave();
}

function tierSort(a, b) {
  return Number(a) - Number(b) || String(a).localeCompare(String(b));
}

function renderStatus() {
  const draftedIds = draftedIdSet();
  const poolCount = state.playerOrder.map((id) => state.players[id]).filter((player) => player && (state.settings.showDeepPool || player.core)).length;
  const availableCount = state.playerOrder.map((id) => state.players[id]).filter((player) => player && (state.settings.showDeepPool || player.core) && !draftedIds.has(player.id)).length;
  ui.playerCount.textContent = poolCount.toLocaleString();
  ui.availableCount.textContent = availableCount.toLocaleString();
  ui.draftedCount.textContent = String(draftedIds.size);
}

function renderDraftControls() {
  const previousDraftTeam = ui.draftTeam.value || state.settings.myTeamId;
  const previousNominatingTeam = ui.nominatingTeam.value || state.settings.myTeamId;
  const previousBoardTeam = ui.boardTeamFilter.value || "ALL";
  ui.draftTeam.innerHTML = "";
  ui.nominatingTeam.innerHTML = "";
  ui.myTeamSelect.innerHTML = "";
  ui.boardTeamFilter.innerHTML = '<option value="ALL">All</option>';
  state.teams.forEach((team) => {
    const draftOption = document.createElement("option");
    draftOption.value = team.id;
    draftOption.textContent = team.id === state.settings.myTeamId ? `${team.name} (My Team)` : team.name;
    ui.draftTeam.appendChild(draftOption);
    const nominatingOption = draftOption.cloneNode(true);
    ui.nominatingTeam.appendChild(nominatingOption);
    const myOption = document.createElement("option");
    myOption.value = team.id;
    myOption.textContent = team.name;
    ui.myTeamSelect.appendChild(myOption);
    const boardOption = myOption.cloneNode(true);
    ui.boardTeamFilter.appendChild(boardOption);
  });
  if (state.settings.myTeamId) ui.myTeamSelect.value = state.settings.myTeamId;
  ui.draftTeam.value = state.teams.some((team) => team.id === previousDraftTeam) ? previousDraftTeam : state.settings.myTeamId;
  ui.nominatingTeam.value = state.teams.some((team) => team.id === previousNominatingTeam) ? previousNominatingTeam : state.settings.myTeamId;
  ui.boardTeamFilter.value = previousBoardTeam === "ALL" || state.teams.some((team) => team.id === previousBoardTeam) ? previousBoardTeam : "ALL";
  ui.undoBtn.disabled = state.drafted.length === 0;
  renderDraftBudgetHint();
}

function renderDraftBudgetHint() {
  const team = teamInfoMap()[ui.draftTeam.value];
  const player = state.players[state.selectedPlayerId];
  const price = Number(ui.draftPrice.value || 0);
  if (!team) {
    ui.draftBudgetHint.textContent = "";
    return;
  }
  const afterBudget = team.budgetRemaining - price;
  const afterOpenSlots = player ? Math.max(0, team.remainingRequired - 1) : team.remainingRequired;
  const legal = !player || price <= team.maxBid;
  ui.draftBudgetHint.innerHTML = `Budget $${team.budgetRemaining} - Max bid $${team.maxBid} - After bid $${afterBudget} with ${afterOpenSlots} required slots left`;
  ui.draftBudgetHint.classList.toggle("bad", !legal);
}

function renderMyTeamSummary() {
  if (!ui.myTeamSummary) return;
  const info = teamInfoMap()[state.settings.myTeamId];
  if (!info) {
    ui.myTeamSummary.textContent = "Choose a manager to pin My Team.";
    return;
  }
  const needs = rosterNeedText(info.roster).join(", ");
  const warnings = scarcityWarnings().slice(0, 4);
  ui.myTeamSummary.innerHTML = `
    <div class="budget-grid">
      <div><span>Budget</span><strong>$${info.budgetRemaining}</strong></div>
      <div><span>Max bid</span><strong>$${info.maxBid}</strong></div>
      <div><span>Open slots</span><strong>${info.remainingRequired}</strong></div>
    </div>
    <p class="needs-line">${escapeHtml(needs || "Roster requirements are filled.")}</p>
    <div class="urgency-list">${warnings.map((warning) => `<div class="urgency ${warning.level}">${escapeHtml(warning.text)}</div>`).join("")}</div>
  `;
}

function renderSelectedPlayer() {
  const player = state.players[state.selectedPlayerId];
  const prep = getPrep(state.selectedPlayerId);
  const drafted = player ? findDraftPick(player.id) : null;
  ui.draftBtn.disabled = !player || Boolean(drafted);
  setPrepDisabled(!player);
  if (!player) {
    ui.selectedName.textContent = "No player selected";
    ui.selectedMeta.textContent = "Pick a player to draft, label, or research.";
    ui.selectedFlags.innerHTML = "";
    ui.selectedScarcity.innerHTML = "";
    renderDraftAssistant();
    return;
  }
  ui.selectedName.textContent = player.name;
  ui.selectedMeta.textContent = `#${player.overallRank} - ${player.positionRankLabel} - ${player.position} - ${player.team} - Est. $${player.estimatedValue}${prep.customValue !== "" ? ` - My $${prep.customValue}` : ""}${drafted ? ` - Drafted by ${teamName(drafted.teamId)} for $${drafted.price}` : ""}`;
  ui.tierInput.value = effectiveTier(player, prep);
  ui.customValueInput.value = prep.customValue;
  ui.notesInput.value = prep.notes;
  ["target", "sleeper", "avoid"].forEach((label) => {
    ui[`${label}Toggle`].classList.toggle("active", prep.label === label);
  });
  ui.selectedFlags.innerHTML = "";
  badgeList(player, prep, drafted).forEach((badge) => ui.selectedFlags.appendChild(badge));
  ui.selectedScarcity.innerHTML = selectedScarcityHtml(player);
  renderDraftBudgetHint();
  renderDraftAssistant();
}

function setPrepDisabled(disabled) {
  ["targetToggle", "sleeperToggle", "avoidToggle", "tierInput", "customValueInput", "notesInput"].forEach((id) => {
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
    card.classList.add(`pos-${player.position.toLowerCase()}`);
    card.classList.toggle("selected", player.id === state.selectedPlayerId);
    card.classList.toggle("drafted", Boolean(drafted));
    card.classList.toggle("avoid", prep.label === "avoid");
    card.querySelector(".overall-rank").textContent = `#${player.overallRank}`;
    card.querySelector(".position-rank").textContent = player.positionRankLabel;
    card.querySelector("h3").textContent = player.name;
    card.querySelector(".player-meta").textContent = `${player.position} - ${player.team} - Tier ${effectiveTier(player, prep)} - Est. $${player.estimatedValue}${prep.customValue !== "" ? ` - My $${prep.customValue}` : ""}${drafted ? ` - ${teamName(drafted.teamId)} $${drafted.price}` : ""}`;
    card.querySelector(".player-notes").textContent = prep.notes || scarcityShortText(player);
    card.querySelectorAll(".label-toggle").forEach((button) => {
      const label = button.dataset.label;
      button.classList.toggle("active", prep.label === label);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setPlayerLabel(player.id, label);
      });
    });
    const badgeWrap = card.querySelector(".player-badges");
    badgeList(player, prep, drafted).forEach((badge) => badgeWrap.appendChild(badge));
    card.addEventListener("click", () => selectPlayer(player.id));
    fragment.appendChild(card);
  });
  ui.playerList.replaceChildren(fragment);
  if (!ui.messages.textContent || ui.messages.dataset.auto === "true") {
    showMessage(`${filteredCache.length.toLocaleString()} players shown.`, false, true);
  }
}

function badgeList(player, prep, drafted) {
  const badges = [];
  badges.push(makeBadge(player.positionRankLabel, `pos-${player.position.toLowerCase()}`));
  badges.push(makeBadge(`Tier ${effectiveTier(player, prep)}`, "good"));
  badges.push(makeBadge(`Est. $${player.estimatedValue}`, "value"));
  if (prep.label) badges.push(makeBadge(labelName(prep.label), prep.label === "avoid" ? "bad" : "good"));
  if (prep.customValue !== "") badges.push(makeBadge(`My $${prep.customValue}`, "good"));
  if (state.trending[player.id]) badges.push(makeBadge(`Trending #${state.trending[player.id].rank}`, "warn"));
  if (!player.core) badges.push(makeBadge("Deep", "muted"));
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
  const tier = ui.tierFilter.value;
  const label = ui.labelFilter.value;
  const sort = ui.sortFilter.value;
  const draftKey = state.drafted.map((pick) => pick.playerId).join(",");
  const prepKey = Object.entries(state.prep).map(([id, prep]) => `${id}:${prep.label}:${prep.tier}:${prep.notes}:${prep.customValue}`).join("|");
  const trendKey = Object.keys(state.trending).join(",");
  const key = `${query}|${position}|${tier}|${label}|${sort}|${state.settings.showDeepPool}|${draftKey}|${prepKey}|${trendKey}|${state.playerOrder.length}`;
  if (key === filteredCacheKey) return filteredCache;
  const drafted = draftedIdSet();
  const availableOnly = sort === "available";
  filteredCache = state.playerOrder.map((id) => state.players[id]).filter((player) => {
    if (!player) return false;
    const prep = getPrep(player.id);
    if (!state.settings.showDeepPool && !player.core) return false;
    if (position !== "ALL" && player.position !== position) return false;
    if (tier !== "ALL" && effectiveTier(player, prep) !== tier) return false;
    if (label !== "ALL" && label !== "unlabeled" && prep.label !== label) return false;
    if (label === "unlabeled" && prep.label) return false;
    if (availableOnly && drafted.has(player.id)) return false;
    if (query && !player.searchText.includes(query)) return false;
    return true;
  }).sort((a, b) => comparePlayers(a, b, sort, drafted)).slice(0, 350);
  filteredCacheKey = key;
  return filteredCache;
}

function comparePlayers(a, b, sort, drafted) {
  if (drafted.has(a.id) !== drafted.has(b.id)) return drafted.has(a.id) ? 1 : -1;
  if (sort === "value") return effectiveAuctionValue(b, getPrep(b.id)) - effectiveAuctionValue(a, getPrep(a.id)) || a.overallRank - b.overallRank;
  if (sort === "position") return a.position.localeCompare(b.position) || a.positionRank - b.positionRank;
  if (sort === "tier") return Number(effectiveTier(a, getPrep(a.id))) - Number(effectiveTier(b, getPrep(b.id))) || a.overallRank - b.overallRank;
  if (sort === "label") return labelWeight(getPrep(a.id).label) - labelWeight(getPrep(b.id).label) || a.overallRank - b.overallRank;
  if (sort === "trending") return trendingWeight(a.id) - trendingWeight(b.id) || a.overallRank - b.overallRank;
  return a.overallRank - b.overallRank;
}

function labelWeight(label) {
  return { target: 0, sleeper: 1, avoid: 3, "": 2 }[label || ""] ?? 2;
}

function trendingWeight(playerId) {
  return state.trending[playerId] ? state.trending[playerId].rank : 9999;
}

function scheduleFilterRender() {
  clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => {
    invalidateFilters();
    renderPlayers();
    renderStatus();
  }, 50);
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
  const player = state.players[state.selectedPlayerId];
  const prep = getPrep(state.selectedPlayerId);
  prep.tier = ui.tierInput.value.trim();
  prep.customValue = ui.customValueInput.value === "" ? "" : Number(ui.customValueInput.value);
  prep.notes = ui.notesInput.value;
  player.searchText = buildSearchText(player, prep);
  invalidateFilters();
  syncTierFilterOptions();
  renderSelectedPlayer();
  renderPlayers();
  renderMyTeamSummary();
  renderDraftAssistant();
  scheduleSave();
}

function setSelectedLabel(label) {
  if (!state.selectedPlayerId) return;
  setPlayerLabel(state.selectedPlayerId, label);
}

function setPlayerLabel(playerId, label) {
  const prep = getPrep(playerId);
  prep.label = prep.label === label ? "" : label;
  state.players[playerId].searchText = buildSearchText(state.players[playerId], prep);
  invalidateFilters();
  renderSelectedPlayer();
  renderPlayers();
  renderDraftAssistant();
  scheduleSave();
}

function getPrep(playerId) {
  if (!playerId) return { label: "", notes: "", tier: "", customValue: "" };
  if (!state.prep[playerId]) {
    state.prep[playerId] = { label: "", notes: "", tier: "", customValue: "" };
  }
  state.prep[playerId].label = normalizeLabel(state.prep[playerId].label);
  return state.prep[playerId];
}

function effectiveTier(player, prep) {
  return String(prep?.tier || player?.autoTier || "");
}

function draftSelectedPlayer() {
  const player = state.players[state.selectedPlayerId];
  if (!player || findDraftPick(player.id)) return;
  const team = teamInfoMap()[ui.draftTeam.value];
  const price = Number(ui.draftPrice.value || 0);
  if (team && price > team.maxBid) {
    showMessage(`${team.name} cannot bid $${price}; max bid is $${team.maxBid}.`, true);
    return;
  }
  const prep = getPrep(player.id);
  const auctionValue = effectiveAuctionValue(player, prep);
  const pick = {
    playerId: player.id,
    nominatedByTeamId: ui.nominatingTeam.value || ui.draftTeam.value,
    teamId: ui.draftTeam.value,
    price,
    position: player.position,
    tier: effectiveTier(player, prep),
    estimatedValue: Number(player.estimatedValue || 1),
    customValue: prep.customValue === "" ? "" : Number(prep.customValue),
    auctionValue,
    draftedAt: new Date().toISOString()
  };
  state.drafted.push(pick);
  state.history.push({ type: "draft", pick });
  invalidateFilters();
  renderAll();
  scheduleSave();
  showMessage(`${player.name} nominated by ${teamName(pick.nominatedByTeamId)} and sold to ${teamName(pick.teamId)} for $${pick.price}.`);
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

function availablePlayers() {
  const drafted = draftedIdSet();
  return state.playerOrder.map((id) => state.players[id]).filter((player) => player && !drafted.has(player.id) && (state.settings.showDeepPool || player.core));
}

function findDraftPick(playerId) {
  return state.drafted.find((pick) => pick.playerId === playerId);
}

function renderTeams() {
  const infos = teamInfoMap();
  const fragment = document.createDocumentFragment();
  const orderedTeams = [...state.teams].sort((a, b) => {
    if (a.id === state.settings.myTeamId) return -1;
    if (b.id === state.settings.myTeamId) return 1;
    return 0;
  });
  orderedTeams.forEach((team, index) => {
    const info = infos[team.id];
    const card = document.createElement("article");
    card.className = `team-card${team.id === state.settings.myTeamId ? " my-team" : ""}`;
    const nameRow = document.createElement("div");
    nameRow.className = "team-name-row";
    const input = document.createElement("input");
    input.value = team.name;
    input.setAttribute("aria-label", `Manager ${index + 1} name`);
    input.addEventListener("input", () => {
      team.name = input.value || `Manager ${index + 1}`;
      renderDraftControls();
      renderSelectedPlayer();
      renderMyTeamSummary();
      renderTeamRosters();
      renderDraftBoard();
      renderDraftAssistant();
      scheduleSave();
    });
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.disabled = state.teams.length <= 1 || state.drafted.some((pick) => pick.teamId === team.id);
    remove.addEventListener("click", () => removeTeam(team.id));
    nameRow.append(input, remove);
    const budget = document.createElement("div");
    budget.className = "team-budget-row";
    budget.innerHTML = `<span>Budget $${info.budgetRemaining}</span><strong>Max $${info.maxBid}</strong>`;
    const needs = document.createElement("div");
    needs.className = "needs-grid";
    Object.entries(info.roster).forEach(([slot, count]) => {
      const limit = ROSTER_LIMITS[slot];
      const item = document.createElement("div");
      item.className = `need ${count >= limit ? "full" : "open"}`;
      item.setAttribute("aria-label", `${slot} ${count}/${limit}`);
      item.innerHTML = `<span>${slot}</span><span>${count}/${limit}</span>`;
      needs.appendChild(item);
    });
    card.append(nameRow, budget, needs);
    fragment.appendChild(card);
  });
  ui.teamsList.replaceChildren(fragment);
}

function renderTeamRosters() {
  if (!ui.teamRostersList) return;
  const infos = teamInfoMap();
  const fragment = document.createDocumentFragment();
  state.teams.forEach((team) => {
    const info = infos[team.id];
    const picks = state.drafted
      .map((pick, index) => ({ pick, index, player: state.players[pick.playerId] }))
      .filter((item) => item.pick.teamId === team.id && item.player)
      .sort((a, b) => positionSortWeight(a.player.position) - positionSortWeight(b.player.position) || a.player.positionRank - b.player.positionRank);
    const card = document.createElement("article");
    card.className = `roster-card${team.id === state.settings.myTeamId ? " my-team" : ""}`;
    const needs = Object.entries(info.roster).map(([slot, count]) => {
      const limit = ROSTER_LIMITS[slot];
      return `<span class="${count >= limit ? "full" : "open"}">${escapeHtml(slot)} ${count}/${limit}</span>`;
    }).join("");
    const playersHtml = picks.length ? picks.map(({ pick, index, player }) => {
      const tier = pick.tier || effectiveTier(player, getPrep(player.id));
      return `<li><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.position)} · Tier ${escapeHtml(tier)} · $${Number(pick.price || 0)} · Pick ${index + 1}</span><small>Nom: ${escapeHtml(teamName(pick.nominatedByTeamId))}</small></li>`;
    }).join("") : '<li class="empty-row">No players drafted yet.</li>';
    card.innerHTML = `
      <div class="roster-card-head">
        <div>
          <p class="eyebrow">${team.id === state.settings.myTeamId ? "My Team" : "Manager"}</p>
          <h3>${escapeHtml(team.name)}</h3>
        </div>
        <div class="roster-money">
          <span>Budget $${info.budgetRemaining}</span>
          <strong>Max $${info.maxBid}</strong>
        </div>
      </div>
      <div class="roster-needs">${needs}</div>
      <ul class="roster-player-list">${playersHtml}</ul>
    `;
    fragment.appendChild(card);
  });
  ui.teamRostersList.replaceChildren(fragment);
}

function renderDraftBoard() {
  if (!ui.draftBoardList) return;
  const position = ui.boardPositionFilter?.value || "ALL";
  const team = ui.boardTeamFilter?.value || "ALL";
  const sort = ui.boardSortFilter?.value || "pick";
  const rows = state.drafted
    .map((pick, index) => ({ pick, index, player: state.players[pick.playerId] }))
    .filter((row) => row.player)
    .filter((row) => position === "ALL" || row.player.position === position)
    .filter((row) => team === "ALL" || row.pick.teamId === team || row.pick.nominatedByTeamId === team)
    .sort((a, b) => {
      if (sort === "price") return Number(b.pick.price || 0) - Number(a.pick.price || 0) || a.index - b.index;
      if (sort === "value") return valueDelta(b.pick) - valueDelta(a.pick) || a.index - b.index;
      return a.index - b.index;
    });
  if (!rows.length) {
    ui.draftBoardList.innerHTML = '<div class="empty-board">No drafted players match these filters yet.</div>';
    return;
  }
  const table = document.createElement("table");
  table.className = "draft-board-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Pick</th>
        <th>Nominated by</th>
        <th>Winning team</th>
        <th>Player</th>
        <th>Pos</th>
        <th>Tier</th>
        <th>Value</th>
        <th>Sold</th>
        <th>Vs Est.</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const body = table.querySelector("tbody");
  rows.forEach(({ pick, index, player }) => {
    const row = document.createElement("tr");
    const tier = pick.tier || effectiveTier(player, getPrep(player.id));
    const value = pickAuctionValue(pick, player);
    const delta = valueDelta(pick, player);
    row.innerHTML = `
      <td>#${index + 1}</td>
      <td>${escapeHtml(teamName(pick.nominatedByTeamId))}</td>
      <td>${escapeHtml(teamName(pick.teamId))}</td>
      <td><strong>${escapeHtml(player.name)}</strong></td>
      <td><span class="badge pos-${player.position.toLowerCase()}">${escapeHtml(player.position)}</span></td>
      <td>${escapeHtml(tier)}</td>
      <td>$${value}</td>
      <td>$${Number(pick.price || 0)}</td>
      <td><span class="${delta >= 0 ? "value-good" : "value-bad"}">${delta >= 0 ? "+" : ""}${delta}</span></td>
    `;
    body.appendChild(row);
  });
  ui.draftBoardList.replaceChildren(table);
}

function positionSortWeight(position) {
  return { QB: 1, RB: 2, WR: 3, TE: 4, FLEX: 5, DEF: 6, Bench: 7, IR: 8 }[position] || 99;
}

function pickAuctionValue(pick, player) {
  return Number(pick.auctionValue || pick.customValue || pick.estimatedValue || player?.estimatedValue || 1);
}

function valueDelta(pick, player) {
  return pickAuctionValue(pick, player) - Number(pick.price || 0);
}

function buildTeamRosters() {
  const rosters = {};
  state.teams.forEach((team) => {
    rosters[team.id] = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, DEF: 0, Bench: 0, IR: 0 };
  });
  state.drafted.forEach((pick) => {
    const roster = rosters[pick.teamId];
    const player = state.players[pick.playerId];
    if (!roster || !player) return;
    assignRosterSlot(roster, player);
  });
  return rosters;
}

function assignRosterSlot(roster, player) {
  if (isIrEligible(player) && roster.IR < ROSTER_LIMITS.IR) {
    roster.IR += 1;
  } else if (player.position === "DEF") {
    roster.DEF += 1;
  } else if (ROSTER_LIMITS[player.position] && roster[player.position] < ROSTER_LIMITS[player.position]) {
    roster[player.position] += 1;
  } else if (FLEX_POSITIONS.has(player.position) && roster.FLEX < ROSTER_LIMITS.FLEX) {
    roster.FLEX += 1;
  } else {
    roster.Bench += 1;
  }
}

function isIrEligible(player) {
  return /injured reserve/i.test(player.status || "");
}

function teamInfoMap() {
  const rosters = buildTeamRosters();
  const infos = {};
  state.teams.forEach((team) => {
    const spent = state.drafted.filter((pick) => pick.teamId === team.id).reduce((sum, pick) => sum + Number(pick.price || 0), 0);
    const requiredFilled = REQUIRED_ROSTER_SLOTS.reduce((sum, slot) => sum + Math.min(rosters[team.id][slot], ROSTER_LIMITS[slot]), 0);
    const remainingRequired = Math.max(0, REQUIRED_ROSTER_SIZE - requiredFilled);
    const budgetRemaining = Math.max(0, Number(state.settings.budget || 200) - spent);
    const maxBid = Math.max(0, budgetRemaining - Math.max(0, remainingRequired - 1));
    infos[team.id] = {
      id: team.id,
      name: team.name,
      roster: rosters[team.id],
      spent,
      budgetRemaining,
      remainingRequired,
      maxBid
    };
  });
  return infos;
}

function rosterNeedText(roster) {
  return Object.entries(roster)
    .filter(([slot, count]) => count < ROSTER_LIMITS[slot])
    .map(([slot, count]) => `${slot} ${count}/${ROSTER_LIMITS[slot]}`);
}

function needsPosition(roster, position) {
  if (!roster) return false;
  if (position === "DEF") return roster.DEF < ROSTER_LIMITS.DEF;
  if (ROSTER_LIMITS[position] && roster[position] < ROSTER_LIMITS[position]) return true;
  return FLEX_POSITIONS.has(position) && roster.FLEX < ROSTER_LIMITS.FLEX;
}

function scarcityWarnings(player) {
  const infos = teamInfoMap();
  const myInfo = infos[state.settings.myTeamId];
  if (!myInfo) return [];
  const positions = player ? [player.position] : ["QB", "RB", "WR", "TE", "DEF"];
  return positions.map((position) => scarcityForPosition(position, player)).filter(Boolean);
}

function scarcityForPosition(position, player) {
  const infos = teamInfoMap();
  const myInfo = infos[state.settings.myTeamId];
  if (!myInfo || !needsPosition(myInfo.roster, position)) {
    return player ? { level: "low", text: `My Team does not have an urgent ${position} slot need.` } : null;
  }
  const otherTeams = state.teams.filter((team) => team.id !== state.settings.myTeamId);
  const otherNeedCount = otherTeams.filter((team) => needsPosition(infos[team.id].roster, position)).length;
  const otherNeedPct = otherTeams.length ? otherNeedCount / otherTeams.length : 0;
  const tier = player ? effectiveTier(player, getPrep(player.id)) : bestAvailableTier(position);
  const tierRemaining = availablePlayers().filter((candidate) => candidate.position === position && effectiveTier(candidate, getPrep(candidate.id)) === tier).length;
  let level = "medium";
  if (tierRemaining <= 2 || otherNeedPct >= 0.6) level = "high";
  if (tierRemaining >= 5 && otherNeedPct <= 0.25) level = "low";
  const text = `${position}: ${levelLabel(level)} urgency - ${otherNeedCount}/${otherTeams.length} other teams still need it; Tier ${tier || "?"} has ${tierRemaining} similar players left.`;
  return { level, text, position, tier, tierRemaining, otherNeedCount };
}

function bestAvailableTier(position) {
  const player = availablePlayers().find((candidate) => candidate.position === position);
  return player ? effectiveTier(player, getPrep(player.id)) : "";
}

function selectedScarcityHtml(player) {
  const warning = scarcityForPosition(player.position, player);
  if (!warning) return "";
  return `<div class="urgency ${warning.level}">${escapeHtml(warning.text)}</div>`;
}

function scarcityShortText(player) {
  const warning = scarcityForPosition(player.position, player);
  return warning ? warning.text : "";
}

function levelLabel(level) {
  return { high: "higher", medium: "moderate", low: "lower" }[level] || "moderate";
}

function addTeam() {
  state.teams.push({ id: cryptoSafeId("team"), name: `Manager ${state.teams.length + 1}` });
  ensureSettings();
  renderAll();
  scheduleSave();
}

function removeTeam(teamId) {
  state.teams = state.teams.filter((team) => team.id !== teamId);
  if (state.settings.myTeamId === teamId) state.settings.myTeamId = state.teams[0]?.id || "";
  renderAll();
  scheduleSave();
}

function teamName(teamId) {
  return state.teams.find((team) => team.id === teamId)?.name || "Unknown Team";
}

function clearFilters() {
  ui.searchInput.value = "";
  ui.positionFilter.value = "ALL";
  ui.tierFilter.value = "ALL";
  ui.labelFilter.value = "ALL";
  ui.sortFilter.value = "value";
  invalidateFilters();
  renderPlayers();
  renderStatus();
}

function refreshDraftContextLock() {
  return contextLock.update(buildContextLockInput());
}

function buildContextLockInput() {
  const infos = teamInfoMap();
  const selected = state.players[state.selectedPlayerId];
  const selectedPrep = getPrep(state.selectedPlayerId);
  const myInfo = infos[state.settings.myTeamId];
  const currentScarcity = selected ? scarcityForPosition(selected.position, selected) : null;
  const players = state.playerOrder.map((id) => {
    const player = state.players[id];
    const prep = getPrep(id);
    const pick = findDraftPick(id);
    return {
      id,
      name: player.name,
      team: player.team,
      position: player.position,
      tier: effectiveTier(player, prep),
      overallRank: player.overallRank,
      positionRank: player.positionRankLabel,
      positionRankLabel: player.positionRankLabel,
      label: prep.label,
      notes: prep.notes,
      customValue: prep.customValue,
      estimatedValue: player.estimatedValue,
      auctionValue: effectiveAuctionValue(player, prep),
      available: !pick && (state.settings.showDeepPool || player.core),
      drafted: Boolean(pick),
      price: pick?.price || 0
    };
  });
  return {
    leagueFormat: `${state.teams.length}-team 2QB full PPR auction draft`,
    budget: state.settings.budget,
    rosterLimits: ROSTER_LIMITS,
    teams: state.teams.map((team) => ({
      id: team.id,
      name: team.name,
      roster: infos[team.id]?.roster || {},
      budgetRemaining: infos[team.id]?.budgetRemaining || 0,
      maxBid: infos[team.id]?.maxBid || 0
    })),
    myTeam: state.teams.find((team) => team.id === state.settings.myTeamId),
    myTeamInfo: myInfo,
    myRoster: state.drafted.filter((pick) => pick.teamId === state.settings.myTeamId).map((pick) => ({
      name: state.players[pick.playerId]?.name || "Unknown",
      position: state.players[pick.playerId]?.position || "",
      price: Number(pick.price || 0)
    })),
    players,
    drafted: state.drafted,
    currentPlayer: selected ? {
      id: selected.id,
      name: selected.name,
      team: selected.team,
      position: selected.position,
      tier: effectiveTier(selected, selectedPrep),
      overallRank: selected.overallRank,
      positionRank: selected.positionRankLabel,
      positionRankLabel: selected.positionRankLabel,
      label: selectedPrep.label,
      notes: selectedPrep.notes,
      estimatedValue: selected.estimatedValue,
      customValue: selectedPrep.customValue,
      auctionValue: effectiveAuctionValue(selected, selectedPrep)
    } : null,
    currentBid: Number(ui.draftPrice?.value || 0),
    currentScarcity,
    positionalScarcity: scarcityWarnings(),
    auctionInflation: "Placeholder: auction inflation is not implemented yet."
  };
}

function renderDraftAssistant() {
  if (!ui.assistantSummary || !contextLock) return;
  const snapshot = refreshDraftContextLock();
  const myTeam = snapshot.myTeam;
  const player = snapshot.currentPlayer;
  ui.draftAssistantPanel.classList.toggle("collapsed", assistantCollapsed);
  ui.assistantBody.hidden = assistantCollapsed;
  ui.toggleAssistantBtn.textContent = assistantCollapsed ? "Expand" : "Collapse";
  ui.toggleAssistantBtn.setAttribute("aria-expanded", String(!assistantCollapsed));
  ui.assistantSummary.innerHTML = `
    <div class="assistant-grid">
      ${assistantMetric("My Team", myTeam?.name || "Unset")}
      ${assistantMetric("Budget", `$${myTeam?.budgetRemaining ?? 0}`)}
      ${assistantMetric("Max bid", `$${myTeam?.maxBid ?? 0}`)}
      ${assistantMetric("Draft #", snapshot.draft.currentDraftNumber)}
      ${assistantMetric("Bench open", myTeam?.benchSpotsRemaining ?? 0)}
      ${assistantMetric("Inflation", "Placeholder")}
    </div>
    <div class="assistant-block"><strong>Roster</strong><span>${escapeHtml(myTeam?.roster?.map((item) => `${item.name} $${item.price}`).join(", ") || "Empty")}</span></div>
    <div class="assistant-block"><strong>Starting needs</strong><span>${escapeHtml(myTeam?.openStartingPositions?.join(", ") || "None")}</span></div>
    <div class="assistant-block"><strong>Current player</strong><span>${escapeHtml(player ? `${player.name} - ${player.positionRank} - Overall #${player.overallRank} - Tier ${player.tier}` : "None selected")}</span></div>
    <div class="assistant-grid compact">
      ${assistantMetric("Same tier left", player?.sameTierRemaining ?? 0)}
      ${assistantMetric("Teams need pos", player?.teamsNeedingPosition ?? 0)}
      ${assistantMetric("Current bid", `$${player?.currentBid ?? Number(ui.draftPrice?.value || 0)}`)}
      ${assistantMetric("Position", player?.position || "-")}
    </div>
  `;
  updatePromptPreview(false);
}

function assistantMetric(label, value) {
  return `<div class="assistant-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function toggleDraftAssistant() {
  assistantCollapsed = !assistantCollapsed;
  renderDraftAssistant();
}

function previewPrompt() {
  updatePromptPreview(true);
}

function updatePromptPreview(showToast) {
  const type = ui.promptTypeSelect.value || "bid";
  ui.promptOutput.value = promptEngine.buildPrompt(type, promptAdditions());
  if (showToast) showAssistantToast("Prompt preview updated.");
}

async function copySelectedPrompt() {
  const type = ui.promptTypeSelect.value || "bid";
  const prompt = await promptEngine.copyPrompt(type, promptAdditions());
  ui.promptOutput.value = prompt;
  showAssistantToast("Prompt copied. Paste into ChatGPT.");
  showMessage("Prompt copied. Paste into ChatGPT.");
}

async function openSelectedPromptInChatGPT() {
  const type = ui.promptTypeSelect.value || "bid";
  const prompt = await promptEngine.openChatGPT(type, promptAdditions());
  ui.promptOutput.value = prompt;
  showAssistantToast("Prompt copied. Paste into ChatGPT.");
  showMessage("Prompt copied. Paste into ChatGPT.");
}

function promptAdditions() {
  const selected = state.players[state.selectedPlayerId];
  const prep = getPrep(state.selectedPlayerId);
  const info = teamInfoMap()[state.settings.myTeamId];
  return {
    currentBid: Number(ui.draftPrice?.value || 0),
    suggestedMaxBid: info?.maxBid || 0,
    player: selected ? {
      name: selected.name,
      team: selected.team,
      position: selected.position,
      tier: effectiveTier(selected, prep),
      positionRank: selected.positionRankLabel,
      overallRank: selected.overallRank,
      estimatedValue: selected.estimatedValue,
      customValue: prep.customValue,
      auctionValue: effectiveAuctionValue(selected, prep),
      currentBid: Number(ui.draftPrice?.value || 0),
      suggestedMaxBid: info?.maxBid || 0
    } : null
  };
}

function showAssistantToast(message) {
  ui.assistantToast.textContent = message;
  ui.assistantToast.classList.add("visible");
  window.clearTimeout(ui.assistantToast._timer);
  ui.assistantToast._timer = window.setTimeout(() => {
    ui.assistantToast.classList.remove("visible");
  }, 2600);
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
  showMessage("Exported JSON with My Team, labels, tiers, budgets, team names, picks, and player data.");
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

function labelName(label) {
  return { target: "Target", sleeper: "Sleeper", avoid: "Avoid" }[label] || "";
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
