import type { AchievementTier } from "./schema";

export interface GamificationResponse {
  visitCount: number;
  milestones: {
    earned: string[];
  };
  streaks: {
    current: number;
    best: number;
    activeThisWeek: boolean;
  };
  runStats: {
    totalKm: number;
    bestRunParks: number;
    bestRunActivityId: string | null;
  };
  nextUnlocks: Array<{
    borough: string;
    currentTier: "none" | "bronze" | "silver" | "gold";
    nextTier: "bronze" | "silver" | "gold" | "king";
    parksNeeded: number;
  }>;
  activityBadges: {
    earned: string[];
  };
  localLegend: Array<{
    parkId: number;
    parkName: string;
    visitCount: number;
    currentTier: string;
  }>;
  leaderboards: {
    global: Array<{ displayName: string; visitCount: number; rank: number }>;
    weekly: Array<{ displayName: string; visitsThisWeek: number; rank: number }>;
    bestSingleRun: Array<{ displayName: string; parksInRun: number; rank: number }>;
  };
}
