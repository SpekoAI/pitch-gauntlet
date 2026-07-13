import type { Metadata } from "next";
import GauntletGame from "@/components/game/GauntletGame";

export const metadata: Metadata = {
  title: "Take the Gauntlet - Pitch Gauntlet",
  description:
    "Up to 90 seconds. Three AI VCs. They interrupt. Survive as long as you can.",
};

export default function PlayPage() {
  return <GauntletGame />;
}
