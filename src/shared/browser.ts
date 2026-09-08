// One namespace for both browsers.
//
// Firefox exposes promise-returning APIs as `browser`; Chrome exposes them as
// `chrome` (promise-based since MV3). Picking whichever exists lets the rest of
// the codebase `await` extension APIs without per-browser branches.
//
// Read off `globalThis` rather than as a bare identifier so that importing any
// module that touches settings does not throw outside an extension — unit tests
// run in plain jsdom, where neither global exists.
const global = globalThis as {
  browser?: typeof chrome
  chrome?: typeof chrome
}

export const api: typeof chrome = (global.browser?.runtime ? global.browser : global.chrome)!

/** Chrome puts the panel behind `sidePanel`; Firefox uses `sidebarAction`. */
export const hasSidePanel = (): boolean => Boolean(api && 'sidePanel' in api)
