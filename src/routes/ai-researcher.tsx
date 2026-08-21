import { createFileRoute } from "@tanstack/react-router";
import { AiResearcherPro } from "@/components/market/AiResearcherPro";

export const Route = createFileRoute("/ai-researcher")({
  head: () => ({
    meta: [
      { title: "AI Researcher — Dalal Desk" },
      { name: "description", content: "AI-powered Indian stock research with market context, news intelligence and evidence-aware analysis." },
    ],
  }),
  component: AiResearcherPro,
});
