// Internal tool registry for server-side orchestration
// Keep tools simple, validated, and side-effect free where possible

export const tools = {
  // MVP tool: returns the current time
  // No arguments; returns ISO string and a human-friendly format
  get_time: {
    validate: (args) => {
      if (args && Object.keys(args).length > 0) {
        throw new Error('get_time takes no arguments');
      }
      return {};
    },
    handler: async () => {
      const now = new Date();
      const iso = now.toISOString();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const human = now.toLocaleString(undefined, {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });
      return { iso, human, timezone: tz };
    },
  },
};
