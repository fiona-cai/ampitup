/** Explicit server-only switch; regular dev and production keep Google sign-in. */
export function demoMode(): boolean {
  return process.env.ALLOT_DEMO_MODE === "1";
}
