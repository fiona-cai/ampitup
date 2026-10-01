import raw from "../data/policy.json" with { type: "json" };

export type Policy = typeof raw;
export type CityRate = Policy["cities"]["default"];

export const policy: Policy = raw;

const CITY_ALIASES: Record<string, keyof Policy["cities"]> = {
  nyc: "new york",
  manhattan: "new york",
  "new york": "new york",
  chicago: "chicago",
  waterloo: "waterloo",
  default: "default",
};

export function cityRate(city: string): CityRate {
  const key = CITY_ALIASES[city.trim().toLowerCase()] ?? "default";
  return policy.cities[key];
}
