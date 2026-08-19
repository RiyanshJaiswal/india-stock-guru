import { createFileRoute } from "@tanstack/react-router";
import { AiResearcher } from "@/components/market/AiResearcher";

export const Route = createFileRoute("/ai-researcher")({
  head: () => ({
    meta: [
      { title: "AI Researcher — Dalal Desk" },
      { name: "description", content: "AI-powered Indian stock research with live market, portfolio and news context." },
    ],
  }),
  component: AiResearcher,
});
