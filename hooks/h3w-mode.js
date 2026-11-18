'use strict';

// Shared mode-directive parser. Harness adapters decide how to persist mode.
function requestedMode(prompt) {
  const text = String(prompt || '').trim().toLowerCase();

  if (/\b(turn off|disable|deactivate|stop|kill|exit)\s+h3w\b/i.test(text) ||
      /\bh3w\s+(mode\s+)?(off|stop|disable|deactivate)\b/i.test(text) ||
      /\bnormal mode\b/i.test(text)) return 'off';

  if (/^\/h3w(\b|:h3w\b)/.test(text) ||
      /\b(activate|enable|turn on|start|use)\b.*\bh3w\b/i.test(text) ||
      /\bh3w\b.*\b(mode|activate|enable|on)\b/i.test(text) ||
      /\bh3wif(y|ier)\b/i.test(text)) return 'on';

  return null;
}

module.exports = { requestedMode };
