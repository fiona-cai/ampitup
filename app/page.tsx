import ConditionedDemo from "@/components/ConditionedDemo";
import RampAllotApp from "@/components/RampAllotApp";

export default function Home() {
  // The live Laya harness needs a local Apple GPU and signed-in Codex CLI.
  // Keep the existing cloud product usable on Vercel's Node runtime.
  return process.env.VERCEL ? <RampAllotApp /> : <ConditionedDemo />;
}
