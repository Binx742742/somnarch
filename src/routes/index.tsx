import { createFileRoute } from "@tanstack/react-router";
import { DreamApp } from "@/game/DreamApp";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <DreamApp />;
}
