// Everything personal lives here. Edit freely; nothing else needs to change.
export const CONFIG = {
  title: "Sky Across Time",
  unlockAt: null,          // e.g. "2026-10-22T23:00:00+05:30": page shows a countdown until then

  // Where the timeline starts. It always runs up to tonight.
  from: "2003-01-01",

  // The dates you can jump to. Add or remove freely. Time is India time, 24-hour.
  // "Tonight" is added at the end automatically.
  dates: [
    { date: "2003-01-18", time: "23:30" },
    { date: "2003-04-20", time: "22:00" },
    { date: "2026-10-12", time: "23:00" },
  ],
};
