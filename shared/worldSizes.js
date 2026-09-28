// World dimensions and content density shared by generation entry points.
// Tiny islands use tinyRadius [minimum, usual maximum, rare maximum] and
// tinyDistribution [center ring, team rings, far scatter, stacked]. A tiny
// island holds at most one loose chest or dragon roost. Dragons and Crawlers
// tune from the per-island/per-structure counts below.

// The same for every size.
const ROOSTS = { chance: 0.12, minRadius: 8 };
const CRAWLERS = { perStructure: [3, 5], cavernCap: 2, cavernChance: 0.4 };
// Tiny islands this big grow 1-2 trees (never on a roost).
const TINY_TREES = { minRadius: 7, count: [1, 2] };

export const WORLD_SIZES = {
  small: {
    label: 'Small', centralRadius: 110, teamRadius: 45, gap: 35,
    tinyCount: [22, 30], tinyRadius: [4, 10, 14], teamHeightOffset: 15, teamDragons: 0, centralDragons: 2, eels: 4,
    roosts: { ...ROOSTS, max: 1 }, crawlers: CRAWLERS, tinyTrees: TINY_TREES, tinyStackOffset: 15,
    centralSurfaceY: 86, teamAngleJitterDegrees: 15, keepInnerRadius: 0.7,
    islandSpacing: 12, verticalClearance: 20, tinyKeepClearance: 25,
    aboveClearance: 30, belowClearance: 20, outerReach: 28,
    centerRingWidth: 25, teamRingWidth: 20, tinySurfaceOffset: [-20, 60],
    tinyDistribution: [0.45, 0.25, 0.15, 0.15], placementAttempts: 80,
    caveArea: 6000, pondArea: 1500, worldMargin: 24,
    rivers: 1,
    quarry: { perTeam: 2, caveAdjacent: 1, tinyChance: 0.05 },
    structures: { tinyChance: 0.4,
      caveTeam: 1, caveCentral: 3, houseTeam: [1, 1], houseCentral: 2,
      towerTeamChance: 0.5, towerCentral: 2, undersideTeamChance: 0.5,
      undersideCentral: 2, dungeonTeam: 1, dungeonCentral: 2 },
  },
  medium: {
    label: 'Medium', centralRadius: 155, teamRadius: 65, gap: 55,
    tinyCount: [34, 45], tinyRadius: [5, 12, 17], teamHeightOffset: 22, teamDragons: 1, centralDragons: 3, eels: 7,
    roosts: { ...ROOSTS, max: 2 }, crawlers: CRAWLERS, tinyTrees: TINY_TREES, tinyStackOffset: 15,
    centralSurfaceY: 86, teamAngleJitterDegrees: 15, keepInnerRadius: 0.7,
    islandSpacing: 20, verticalClearance: 20, tinyKeepClearance: 25,
    aboveClearance: 30, belowClearance: 20, outerReach: 20,
    centerRingWidth: 35, teamRingWidth: 25, tinySurfaceOffset: [-20, 60],
    tinyDistribution: [0.45, 0.25, 0.15, 0.15], placementAttempts: 80,
    caveArea: 6000, pondArea: 1500, worldMargin: 24,
    rivers: 2,
    quarry: { perTeam: 3, caveAdjacent: 1, tinyChance: 0.05 },
    structures: { tinyChance: 0.4,
      caveTeam: 2, caveCentral: 6, houseTeam: [1, 2], houseCentral: 3,
      towerTeamChance: 0.5, towerCentral: 3, undersideTeamChance: 0.5,
      undersideCentral: 3, dungeonTeam: 1, dungeonCentral: 3 },
  },
  large: {
    label: 'Large', centralRadius: 210, teamRadius: 90, gap: 80,
    tinyCount: [50, 66], tinyRadius: [5, 15, 20], teamHeightOffset: 30, teamDragons: 1, centralDragons: 5, eels: 10,
    roosts: { ...ROOSTS, max: 4 }, crawlers: CRAWLERS, tinyTrees: TINY_TREES, tinyStackOffset: 15,
    centralSurfaceY: 86, teamAngleJitterDegrees: 15, keepInnerRadius: 0.7,
    islandSpacing: 20, verticalClearance: 20, tinyKeepClearance: 25,
    aboveClearance: 30, belowClearance: 20, outerReach: 20,
    centerRingWidth: 45, teamRingWidth: 30, tinySurfaceOffset: [-20, 60],
    tinyDistribution: [0.45, 0.25, 0.15, 0.15], placementAttempts: 80,
    caveArea: 6000, pondArea: 1500, worldMargin: 24,
    rivers: 3,
    quarry: { perTeam: 4, caveAdjacent: 2, tinyChance: 0.05 },
    structures: { tinyChance: 0.4,
      caveTeam: 3, caveCentral: 9, houseTeam: [2, 2], houseCentral: 5,
      towerTeamChance: 0.5, towerCentral: 5, undersideTeamChance: 0.5,
      undersideCentral: 5, dungeonTeam: 2, dungeonCentral: 6 },
  },
};
export const DEFAULT_WORLD_SIZE = 'medium';
