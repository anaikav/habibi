// clock.js
// ---------
// The app has a "simulated clock" so we can jump to Monday 8:30 AM or Saturday
// 7:30 PM on demand for the demo. Every other module must read time from HERE,
// never call `new Date()` directly. That way the demo panel controls the whole
// world with one dial.
//
// The ONE deliberate exception (see spec §1) is moiApi's ride status, which
// uses REAL elapsed seconds so a booked ride visibly progresses during a demo
// regardless of what the simulated clock says.
//
// Filled in during Phase 1.
