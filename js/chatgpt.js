(function () {
  "use strict";

  const CHATGPT_URL = "https://chatgpt.com/";
  const PROMPT_TYPES = {
    research: "Research Player",
    bid: "Should I Bid?",
    nomination: "Nomination Strategy",
    strategy: "Overall Strategy"
  };

  function createPromptEngine({ contextLock, transport = {} } = {}) {
    if (!contextLock) throw new Error("ChatGPT prompt engine requires a Draft Context Lock.");
    const copyText = transport.copyText || defaultCopyText;
    const openUrl = transport.openUrl || defaultOpenUrl;

    function buildPrompt(type = "bid", additions = {}) {
      const snapshot = contextLock.getSnapshot();
      const context = contextLock.toPromptContext();
      const player = additions.player || snapshot.currentPlayer;
      const playerLine = describePlayer(player);
      const bid = additions.currentBid ?? player?.currentBid ?? 0;
      const suggestedMax = additions.suggestedMaxBid ?? player?.suggestedMaxBid ?? context.maxBid;

      if (type === "research") {
        return [
          `Act as a fantasy football draft research assistant for my ${context.league}.`,
          `Player to research: ${playerLine}.`,
          `My team: ${context.myTeamName}. Roster: ${context.roster}. Budget: $${context.budget}. Max bid: $${context.maxBid}. Needs: ${context.needs}.`,
          `Compare him against remaining same-tier or nearby alternatives: ${similarPlayers(snapshot, player)}.`,
          "Focus on recent news, injury concerns, camp reports, role, upside, downside, and a clear recommendation.",
          `Also consider my labels and notes: ${context.labels}. Notes: ${context.notes}.`
        ].join("\n\n");
      }

      if (type === "nomination") {
        return [
          `Act as my nomination strategist for a live ${context.league}.`,
          `Current draft number: ${context.draftNumber}. My roster: ${context.roster}.`,
          `Budget: $${context.budget}. Max bid: $${context.maxBid}. Starting needs: ${context.startingNeeds}. Bench spots remaining: ${context.benchSpots}.`,
          `Other teams' needs and budgets: ${context.otherNeeds}.`,
          `Remaining tiers: ${context.remainingTierSummary}.`,
          `Targets/Sleepers/Avoids: ${context.labels}.`,
          "Who should I nominate next and why? Include whether I should nominate a target, a sleeper, a price-enforcer, or a position I do not need."
        ].join("\n\n");
      }

      if (type === "strategy") {
        return [
          `Act as my overall strategy assistant for the next several nominations in my ${context.league}.`,
          `My team: ${context.myTeamName}. Roster: ${context.roster}.`,
          `Budget: $${context.budget}. Max bid: $${context.maxBid}. Auction inflation: ${context.inflation}.`,
          `Position needs: ${context.needs}. Starting needs: ${context.startingNeeds}. Bench spots remaining: ${context.benchSpots}.`,
          `Other teams: ${context.otherNeeds}.`,
          `Remaining tiers: ${context.remainingTierSummary}.`,
          `My labels and notes: ${context.labels}. Notes: ${context.notes}.`,
          "What should my priorities be over the next several nominations? Give a concise action plan."
        ].join("\n\n");
      }

      return [
        `Act as my live auction draft decision assistant for my ${context.league}.`,
        `Current player: ${playerLine}. Current bid: $${bid}. Suggested max bid from my budget math: $${suggestedMax}.`,
        `My team: ${context.myTeamName}. Roster: ${context.roster}. Remaining budget: $${context.budget}. Max bid: $${context.maxBid}.`,
        `Needs: ${context.needs}. Starting needs: ${context.startingNeeds}. Bench spots remaining: ${context.benchSpots}.`,
        `Scarcity: ${context.scarcity}. Same-tier alternatives: ${similarPlayers(snapshot, player)}.`,
        `Remaining tiers: ${context.remainingTierSummary}. Other teams' needs and budgets: ${context.otherNeeds}.`,
        "Should I continue bidding, stop, or only continue up to a specific number? Explain the recommendation and alternatives."
      ].join("\n\n");
    }

    async function copyPrompt(type, additions) {
      const prompt = buildPrompt(type, additions);
      await copyText(prompt);
      return prompt;
    }

    async function openChatGPT(type, additions) {
      const prompt = await copyPrompt(type, additions);
      openUrl(CHATGPT_URL);
      return prompt;
    }

    return {
      buildPrompt,
      copyPrompt,
      openChatGPT,
      promptTypes: PROMPT_TYPES
    };
  }

  function describePlayer(player) {
    if (!player) return "No player selected";
    const value = player.auctionValue || player.customValue || player.estimatedValue || "";
    return `${player.name} (${player.position || ""}${player.positionRank ? ` ${player.positionRank}` : ""}, overall #${player.overallRank || "?"}, Tier ${player.tier || "?"}, ${player.team || "FA"}${value ? `, est. value $${value}` : ""})`;
  }

  function similarPlayers(snapshot, player) {
    if (!player) return "No selected player; use the remaining tier summary.";
    const tierGroup = snapshot.remainingPlayersByTier?.find((tier) => tier.position === player.position && String(tier.tier) === String(player.tier));
    if (!tierGroup || !tierGroup.players.length) return "No same-tier alternatives remain.";
    return `${tierGroup.count} remain in ${player.position} Tier ${player.tier}: ${tierGroup.players.join(", ")}`;
  }

  async function defaultCopyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function defaultOpenUrl(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  window.ChatGPTPromptEngine = {
    CHATGPT_URL,
    PROMPT_TYPES,
    createPromptEngine
  };
})();
