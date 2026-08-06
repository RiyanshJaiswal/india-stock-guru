import { queryOptions } from "@tanstack/react-query";
import { getResearchContext } from "@/lib/research.functions";
import { DEFAULT_RESEARCH_DOMAINS, type ResearchDomain } from "@/lib/research-types";

/** Shared query definition for the research context engine. */
export const researchContextQuery = (
  symbol: string,
  domains: ResearchDomain[] = DEFAULT_RESEARCH_DOMAINS,
) =>
  queryOptions({
    queryKey: ["research-context", symbol, domains],
    queryFn: () =>
      getResearchContext({
        data: {
          symbol,
          domains: domains as ("market" | "technical" | "fundamental" | "news")[],
        },
      }),
    enabled: symbol.trim().length > 0,
    staleTime: 5 * 60_000,
  });
