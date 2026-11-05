# Assets Manifest: Tic-Tac-Toe Arena

This manifest catalogues all visual graphics, UI sprites, 2D/3D assets, animations, and sound effects required for the full production release.

---

## 1. UI & HUD Elements

| Asset Key | Type | Resolution / Format | Description |
| :--- | :--- | :--- | :--- |
| `ui_icon_player_x` | SVG / PNG | 128x128 Vector | Primary energetic cyan cross mark with glow state |
| `ui_icon_player_o` | SVG / PNG | 128x128 Vector | Primary neon orange ring mark with glow state |
| `ui_btn_primary` | 9-slice PNG | 256x96 (3x scale) | Pill button, active/hover/pressed states (Emerald Green) |
| `ui_btn_gold` | 9-slice PNG | 256x96 (3x scale) | Ranked/Store purchase button with gold sheen |
| `ui_badge_trophy` | SVG / Sprite | 64x64 Vector | Cartoon-dungeon Golden Crypt Chalice & Dragon Relic emblems (Bronze Buckler, Silver Runeblade, Gold Chalice, Diamond Soul Gem, Mythic Dragon Crown) |
| `ui_badge_gem` | SVG / PNG | 64x64 | Purple cut diamond icon for premium currency |
| `ui_badge_gold_coin` | SVG / PNG | 64x64 | Gold coin stack with sparkle highlight |

---

## 2. Chest & Gacha Visuals

| Asset Key | Dimensions / Spec | States Needed | Purpose |
| :--- | :--- | :--- | :--- |
| `chest_wood` | 512x512 Sprite / GLTF Model | Closed, Unlocking, Burst Open | Tier 1 reward container |
| `chest_silver` | 512x512 Sprite / GLTF Model | Closed, Unlocking, Burst Open | Tier 2 reward container |
| `chest_gold` | 512x512 Sprite / GLTF Model | Closed, Unlocking, Burst Open | Tier 3 reward container |
| `chest_mythic` | 512x512 Sprite / GLTF Model | Closed, Unlocking, Burst Open, Rotating aura | Tier 4 high-tier gacha chest |
| `fx_card_reveal_ray` | Particle Texture / WebGL Shader | Golden radial sunburst | Loot open celebration background |

---

## 3. Boards & Thematic Skins

| Theme ID | Board Background | Cell Style | Win Line VFX |
| :--- | :--- | :--- | :--- |
| `theme_default_dark` | Slate/Carbon (`#0d1117`) | Rounded dark gray tiles | Green laser glow trace |
| `theme_cyber_neon` | Grid blueprint dark blue | Glassmorphism with edge glow | Electric lightning arc |
| `theme_classic_wood` | Polished mahogany texture | Carved inset wood tiles | Gold leaf slash |
| `theme_arcade_retro` | CRT scanline filter overlay | Chunky 8-bit bordered squares | Pixel burst dissolve |

---

## 4. Particles & Animation VFX

| FX Key | Target | Format | Description |
| :--- | :--- | :--- | :--- |
| `fx_cell_place_dust` | Grid Cell | Sprite Sheet / CSS Keyframes | Subtle shockwave ripple when X or O lands |
| `fx_win_confetti` | Fullscreen Canvas | Confetti particle emitter | Celebration on round victory |
| `fx_trophy_gain_pop` | Header HUD | Animated SVG / Lottie | Trophy count bounce with floating `+30` text |

---

## 5. Audio & SFX Assets

| Sound Key | Format | Duration | Audio Profile |
| :--- | :--- | :--- | :--- |
| `sfx_place_x` | OGG / MP3 | 120ms | Crisp metallic snap / clack |
| `sfx_place_o` | OGG / MP3 | 120ms | Deep resonant acoustic pop |
| `sfx_round_win` | OGG / MP3 | 1.8s | Bright celebratory fanfare with chime chord |
| `sfx_round_tie` | OGG / MP3 | 1.2s | Neutral ascending dual chime |
| `sfx_chest_unlock` | OGG / MP3 | 2.4s | Mechanical lock click followed by treasure sparkle |
| `bgm_lobby_loop` | OGG / MP3 | 45s Loop | Low-tempo lofi electronic ambient groove |
