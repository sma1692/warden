# Project Backlog: Tic-Tac-Toe Arena Expansion

This document outlines the expansion roadmap for Tic-Tac-Toe Arena, covering 4 core game-meta modules:
1. **Chest System (Gacha & Progression)**
2. **LiveOps (Daily Quests, Events & Dynamic Config)**
3. **Trophy & Ranked Ladder (Elo & Season Leagues)**
4. **Realtime Multiplayer (P2P / WebSockets / Matchmaking)**

---

## Module 1: Chest System (Loot & Progression)

### Objectives
Provide reward loops on victory, retention timers, and cosmetic/shard progression.

### Specifications
- **Chest Tiers**:
  - `Wood Chest`: 3h unlock timer or 15 gems. Contains 50-100 Gold + 2 Common Skin Shards.
  - `Silver Chest`: 8h unlock timer or 40 gems. Contains 200-400 Gold + 10 Shards (Guaranteed Rare).
  - `Gold Chest`: 12h unlock timer or 75 gems. Contains 500-1000 Gold + 25 Shards (Guaranteed Epic).
  - `Mythic Chest`: Instant unlock via Trophy milestones or Store. Contains Legendary Animated Skins.
- **Chest Slots**: 4 active chest inventory slots. If slots are full, additional wins grant trophies/gold only.
- **Data Model**:
  ```typescript
  interface ChestInstance {
    id: string;
    tier: 'wood' | 'silver' | 'gold' | 'mythic';
    acquiredAt: number;
    unlockStartedAt: number | null;
    durationMs: number;
    rewardsClaimed: boolean;
  }
  ```

---

## Module 2: LiveOps Module

### Objectives
Enable server-driven game rules, time-limited events, and daily retention loops without client updates.

### Specifications
- **Daily Quests Engine**:
  - 3 rotating quests reset daily at 00:00 UTC (e.g., "Win 3 matches", "Win in under 5 moves", "Block 5 opponent win lines").
- **Time-Limited Modifiers (Weekend Events)**:
  - *Speed Tic-Tac-Toe*: 3-second turn timer.
  - *3-in-a-Row Infinite*: Max 3 pieces per player; placing a 4th removes the oldest piece.
- **Remote Config Ingestion**:
  - Fetch `GET /api/v1/liveops/config` with schema:
  ```json
  {
    "activeSeasonId": "season_alpha_01",
    "eventBanner": "Weekend Double Trophy Rush!",
    "multipliers": { "gold": 2.0, "trophies": 1.5 },
    "questPoolVersion": "v1.2"
  }
  ```

---

## Module 3: Trophy & Ranked Ladder System

### Objectives
Drive competitive play, fair matchmaking placement, and seasonal reset rewards.

### Specifications
- **Ladder Leagues**:
  - Bronze: 0 - 499 Trophies
  - Silver: 500 - 999 Trophies
  - Gold: 1,000 - 1,999 Trophies
  - Diamond: 2,000 - 2,999 Trophies
  - Grandmaster: 3,000+ Trophies (Leaderboard view)
- **Trophy Calculation**:
  - Standard Elo variation: Winner gains +25 to +35 based on opponent differential; loser loses -15 to -25.
  - Win streak bonus (+5 extra per consecutive win, up to Gold).
- **Trophy Road Milestones**:
  - Unlock new boards (Neon Grid, Wood Grain, Cyberpunk) and avatar frames at fixed trophy milestones.

---

## Module 4: Realtime Multiplayer Module

### Objectives
Low-latency 1v1 online matchmaking and private friend room lobbies.

### Specifications
- **Architecture**:
  - Primary transport: WebSockets (Socket.io or raw WebSocket with Protobuf/JSON).
  - Optional fallback: WebRTC DataChannels for client-to-client low latency.
- **Network Protocol States**:
  1. `LOBBY_QUEUE`: Client sends `{ action: 'FIND_MATCH', mmr: 1250 }`.
  2. `MATCH_FOUND`: Server returns `{ matchId, opponent: { name, rating, avatar }, assignedSymbol: 'X' }`.
  3. `GAME_MOVE`: `{ matchId, cellIndex: 4, timestamp, sequence: 1 }`.
  4. `TIMEOUT_DETECTED`: 15-second turn timer enforced authoritative on server.
  5. `MATCH_END`: Server validates win conditions and broadcasts trophy deltas.
- **Reconnection Handling**:
  - Grace period of 30 seconds for mobile/tab-switch reconnects using `sessionToken`.
