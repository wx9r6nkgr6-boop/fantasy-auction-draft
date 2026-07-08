(function () {
  "use strict";

  const POSITIONS = ["QB", "RB", "WR", "TE", "DEF"];
  const DEFAULT_LIMITS = { QB: 2, RB: 2, WR: 3, TE: 1, FLEX: 1, DEF: 1, Bench: 7, IR: 1 };

  function createDraftContextLock(options = {}) {
    let snapshot = buildSnapshot({ rosterLimits: DEFAULT_LIMITS, ...options.initialState });
    let revision = 0;

    function update(input = {}) {
      revision += 1;
      snapshot = buildSnapshot({ rosterLimits: DEFAULT_LIMITS, ...input, revision });
      return snapshot;
    }

    function getSnapshot() {
      return snapshot;
    }

    function toPromptContext() {
      return formatForPrompt(snapshot);
    }

    return {
      getSnapshot,
      toPromptContext,
      update
    };
  }

  function buildSnapshot(input = {}) {
    const rosterLimits = { ...DEFAULT_LIMITS, ...(input.rosterLimits || {}) };
    const teams = Array.isArray(input.teams) ? input.teams : [];
    const players = Array.isArray(input.players) ? input.players : [];
    const drafted = Array.isArray(input.drafted) ? input.drafted : [];
    const myTeam = input.myTeam || teams[0] || null;
    const currentPlayer = input.currentPlayer || null;
    const myInfo = input.myTeamInfo || {};
    const otherTeams = teams.filter((team) => !myTeam || team.id !== myTeam.id);
    const availablePlayers = players.filter((player) => player.available !== false && !player.drafted);
    const currentTier = currentPlayer ? String(currentPlayer.tier || "") : "";
    const currentPosition = currentPlayer ? currentPlayer.position : "";
    const sameTierRemaining = currentPlayer
      ? availablePlayers.filter((player) => player.position === currentPosition && String(player.tier || "") === currentTier).length
      : 0;
    const teamsNeedingCurrentPosition = currentPosition
      ? teams.filter((team) => needsPosition(team.roster, currentPosition, rosterLimits)).length
      : 0;
    const otherTeamNeeds = otherTeams.map((team) => ({
      id: team.id,
      name: team.name,
      budgetRemaining: numberOrZero(team.budgetRemaining),
      maxBid: numberOrZero(team.maxBid),
      needs: openNeeds(team.roster, rosterLimits),
      positionsNeeded: POSITIONS.filter((position) => needsPosition(team.roster, position, rosterLimits))
    }));

    return {
      revision: input.revision || 0,
      updatedAt: new Date().toISOString(),
      leagueSettings: {
        teams: teams.length,
        format: input.leagueFormat || "10-team 2QB full PPR auction draft",
        budget: numberOrZero(input.budget || myInfo.budget || 200),
        rosterLimits
      },
      myTeam: myTeam ? {
        id: myTeam.id,
        name: myTeam.name,
        budgetRemaining: numberOrZero(myInfo.budgetRemaining),
        maxBid: numberOrZero(myInfo.maxBid),
        roster: Array.isArray(input.myRoster) ? input.myRoster : [],
        rosterCounters: myInfo.roster || {},
        openStartingPositions: openStartingPositions(myInfo.roster, rosterLimits),
        openNeeds: openNeeds(myInfo.roster, rosterLimits),
        benchSpotsRemaining: Math.max(0, (rosterLimits.Bench || 0) - numberOrZero(myInfo.roster?.Bench)),
        remainingRequired: numberOrZero(myInfo.remainingRequired)
      } : null,
      currentPlayer: currentPlayer ? {
        id: currentPlayer.id,
        name: currentPlayer.name,
        team: currentPlayer.team,
        position: currentPlayer.position,
        tier: currentTier,
        positionRank: currentPlayer.positionRankLabel || "",
        overallRank: currentPlayer.overallRank || "",
        label: currentPlayer.label || "",
        notes: currentPlayer.notes || "",
        customValue: currentPlayer.customValue ?? "",
        sameTierRemaining,
        teamsNeedingPosition: teamsNeedingCurrentPosition,
        currentBid: numberOrZero(input.currentBid),
        suggestedMaxBid: numberOrZero(myInfo.maxBid)
      } : null,
      draft: {
        currentDraftNumber: drafted.length + 1,
        draftedCount: drafted.length,
        auctionInflation: input.auctionInflation || "Placeholder: auction inflation is not implemented yet."
      },
      scarcity: {
        currentPosition: input.currentScarcity || null,
        positional: input.positionalScarcity || []
      },
      remainingPlayersByTier: groupRemainingByTier(availablePlayers),
      labels: {
        target: summarizeLabeled(players, "target"),
        sleeper: summarizeLabeled(players, "sleeper"),
        avoid: summarizeLabeled(players, "avoid")
      },
      personalNotes: players
        .filter((player) => player.notes)
        .slice(0, 30)
        .map((player) => ({ name: player.name, position: player.position, notes: player.notes })),
      otherTeams: otherTeamNeeds,
      budgets: teams.map((team) => ({
        name: team.name,
        budgetRemaining: numberOrZero(team.budgetRemaining),
        maxBid: numberOrZero(team.maxBid)
      }))
    };
  }

  function needsPosition(roster = {}, position, limits = DEFAULT_LIMITS) {
    if (position === "DEF") return numberOrZero(roster.DEF) < limits.DEF;
    if (numberOrZero(roster[position]) < numberOrZero(limits[position])) return true;
    return ["RB", "WR", "TE"].includes(position) && numberOrZero(roster.FLEX) < numberOrZero(limits.FLEX);
  }

  function openStartingPositions(roster = {}, limits = DEFAULT_LIMITS) {
    return ["QB", "RB", "WR", "TE", "FLEX", "DEF"]
      .filter((slot) => numberOrZero(roster[slot]) < numberOrZero(limits[slot]))
      .map((slot) => `${slot} ${numberOrZero(roster[slot])}/${numberOrZero(limits[slot])}`);
  }

  function openNeeds(roster = {}, limits = DEFAULT_LIMITS) {
    return Object.entries(limits)
      .filter(([slot, limit]) => numberOrZero(roster[slot]) < numberOrZero(limit))
      .map(([slot, limit]) => `${slot} ${numberOrZero(roster[slot])}/${numberOrZero(limit)}`);
  }

  function groupRemainingByTier(players) {
    const groups = {};
    players.forEach((player) => {
      const position = player.position || "UNK";
      const tier = String(player.tier || "?");
      const key = `${position} Tier ${tier}`;
      if (!groups[key]) groups[key] = { position, tier, count: 0, players: [] };
      groups[key].count += 1;
      if (groups[key].players.length < 8) {
        groups[key].players.push(`${player.name} (${player.positionRank || player.positionRankLabel || position})`);
      }
    });
    return Object.values(groups).sort((a, b) => a.position.localeCompare(b.position) || Number(a.tier) - Number(b.tier));
  }

  function summarizeLabeled(players, label) {
    return players
      .filter((player) => player.label === label)
      .slice(0, 20)
      .map((player) => ({
        name: player.name,
        position: player.position,
        rank: player.positionRank || player.positionRankLabel || "",
        tier: player.tier || ""
      }));
  }

  function formatForPrompt(snapshot) {
    const myTeam = snapshot.myTeam || {};
    return {
      league: snapshot.leagueSettings?.format || "auction draft",
      myTeamName: myTeam.name || "My Team",
      roster: myTeam.roster?.length ? myTeam.roster.map((player) => `${player.name} ${player.price ? `$${player.price}` : ""}`.trim()).join(", ") : "empty",
      budget: myTeam.budgetRemaining ?? 0,
      maxBid: myTeam.maxBid ?? 0,
      needs: myTeam.openNeeds?.join(", ") || "none",
      startingNeeds: myTeam.openStartingPositions?.join(", ") || "none",
      benchSpots: myTeam.benchSpotsRemaining ?? 0,
      currentPlayer: snapshot.currentPlayer,
      draftNumber: snapshot.draft?.currentDraftNumber || 1,
      inflation: snapshot.draft?.auctionInflation || "Not implemented",
      scarcity: snapshot.scarcity?.currentPosition?.text || snapshot.scarcity?.positional?.map((item) => item.text).join(" | ") || "No scarcity warning",
      remainingTierSummary: snapshot.remainingPlayersByTier?.slice(0, 12).map((tier) => `${tier.position} Tier ${tier.tier}: ${tier.count}`).join(", ") || "none",
      otherNeeds: snapshot.otherTeams?.map((team) => `${team.name}: ${team.positionsNeeded.join("/") || "none"}; budget $${team.budgetRemaining}; max $${team.maxBid}`).join(" | ") || "none",
      labels: `Targets: ${snapshot.labels?.target?.map((p) => p.name).join(", ") || "none"}; Sleepers: ${snapshot.labels?.sleeper?.map((p) => p.name).join(", ") || "none"}; Avoid: ${snapshot.labels?.avoid?.map((p) => p.name).join(", ") || "none"}`,
      notes: snapshot.personalNotes?.map((note) => `${note.name}: ${note.notes}`).join(" | ") || "none"
    };
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  window.DraftContextLock = {
    createDraftContextLock,
    buildSnapshot,
    formatForPrompt
  };
})();
