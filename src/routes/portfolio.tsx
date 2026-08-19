import { createFileRoute } from "@tanstack/react-router";
import { PortfolioFullPage } from "@/components/market/PortfolioFullPage";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "My Portfolio — Dalal Desk" },
      { name: "description", content: "View, filter and manage all stock holdings with live P&L." },
    ],
  }),
  component: PortfolioPage,
});

function PortfolioPage() {
  return <PortfolioFullPage />;
}
