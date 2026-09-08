// Weekend boost events: a deterministic, preset-driven events calendar.
//
// Presets are plain JSON-safe objects — activeDays is an ARRAY of JS
// getUTCDay() values (0 = Sunday, 6 = Saturday), never a Set — so the same
// shape can later be served to the client, stored, or built from config.
// Each preset describes a per-currency multiplier window. Overlapping coin
// presets COMPOSE multiplicatively through coinMultiplier(), so a future
// 'double coins all week' event just adds another preset instead of
// special-casing the schedule.
//
// v1 ships a single preset: weekend_x2 — 2x coins from daily rewards and
// quest claims on Saturday and Sunday (UTC). Gems are never boosted.

const DEFAULT_PRESETS = Object.freeze([
  Object.freeze({
    slug: 'weekend_x2',
    name: 'Weekend Boost',
    description: 'Double coins from daily rewards and quests on weekends',
    multiplier: 2,
    currency: 'coins',
    // JS getUTCDay(): 6 = Saturday, 0 = Sunday.
    activeDays: [6, 0],
  }),
]);

function isDayActive(preset, utcDay) {
  return Array.isArray(preset.activeDays) && preset.activeDays.includes(utcDay);
}

function createEventService({ now = () => Date.now(), presets = DEFAULT_PRESETS } = {}) {
  const active = () => {
    const utcDay = new Date(now()).getUTCDay();
    return presets
      .filter((preset) => isDayActive(preset, utcDay))
      .map((preset) => ({
        slug: preset.slug,
        name: preset.name,
        description: preset.description,
        multiplier: preset.multiplier,
        currency: preset.currency,
        active: true,
      }));
  };

  // Product of every active preset that boosts coins (default 1). Filtering by
  // currency here keeps coinMultiplier() independent of active(): a gem-only
  // event overlapping a coin event must not change coin payouts, and future
  // overlapping coin events multiply together.
  const coinMultiplier = () => active()
    .filter((preset) => preset.currency === 'coins')
    .reduce((product, preset) => product * preset.multiplier, 1);

  return { active, coinMultiplier };
}

module.exports = { DEFAULT_PRESETS, isDayActive, createEventService };
