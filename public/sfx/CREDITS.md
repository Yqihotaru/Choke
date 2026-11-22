# 音效素材来源 / Credits

本目录 `public/sfx/<音名>/` 下的所有 mp3 均由 **CC0 / Public Domain** 素材转码而来(来源页面均已核对标注为 CC0)。CC0 不要求署名,此处仍逐文件列出出处以便追溯。

通用处理:单声道、44.1 kHz、MP3 112 kbps(libmp3lame);裁掉首尾静音;峰值归一到约 -3 dBFS(`tick` 为 -9 dBFS);持续型素材(和弦/jingle)同时按平均响度(目标约 -23 dB)压低,噪声/瞬态型素材最多额外提升 6 dB 并用限幅器把峰值卡在目标处;超过目标时长的在末尾 80ms 淡出截断,其余 15ms 淡出。转码工具:ffmpeg 6.1.1(临时目录里的 ffmpeg-static,未改动项目依赖)。多层混合的文件(reveal-*、crit、cutin、melt-3)由多个 CC0 素材按表中延迟/增益叠加而成;charge-* 与 melt-3 的一层为原素材**倒放**(衍生作品,CC0 允许)。

来源包:
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/broken-glass-of-champagne-s1591.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/chimes-butterfly-1-s2087.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/chimes-butterfly-2-s2088.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/chimes-butterfly-3-s2089.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/chimes-dream-1-s2079.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/chimes-dream-2-s2080.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/chimes-dream-3-s2081.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/chimes-dream-4-s2082.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/chimes-dream-5-s2083.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/chimes-dream-6-s2084.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/chimes-dream-7-s2085.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/chimes-dream-8-s2086.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/dreamcatcher-s0040.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/glass-burst-s0148.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/glockenspiel-s0920.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/pages-that-turn-4-s2211.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/pages-that-turn-6-s2213.html
- BigSoundBank (Joseph SARDIN / LaSonotheque) — https://bigsoundbank.com/torn-paper-9-s3246.html
- Kenney - Casino Audio — https://kenney.nl/assets/casino-audio
- Kenney - Impact Sounds — https://kenney.nl/assets/impact-sounds
- Kenney - Interface Sounds — https://kenney.nl/assets/interface-sounds
- Kenney - RPG Audio — https://kenney.nl/assets/rpg-audio
- Kenney - Sci-Fi Sounds — https://kenney.nl/assets/sci-fi-sounds
- Kenney - UI Audio — https://kenney.nl/assets/ui-audio
- OpenGameArt - 100 CC0 SFX — https://opengameart.org/content/100-cc0-sfx
- OpenGameArt - 75 CC0 breaking / falling / hit sfx — https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx
- OpenGameArt - 85 Short music jingles (Kenney) — https://opengameart.org/content/85-short-music-jingles
- OpenGameArt - Various Paper Sound Effects — https://opengameart.org/content/various-paper-sound-effects

## 逐文件

| 文件 | 来源包 | 原文件名 | 作者 | 许可证 | 来源页面 | 处理 |
| --- | --- | --- | --- | --- | --- | --- |
| click/click-1.mp3 | Kenney - UI Audio | click2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/ui-audio | 裁首尾静音、单声道 44.1k、增益 -9.0dB |
| click/click-2.mp3 | Kenney - UI Audio | click3.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/ui-audio | 裁首尾静音、单声道 44.1k、增益 1.2dB |
| click/click-3.mp3 | Kenney - UI Audio | mouseclick1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/ui-audio | 裁首尾静音、单声道 44.1k、增益 -1.7dB |
| click/click-4.mp3 | OpenGameArt - 100 CC0 SFX | switch_01.ogg | rubberduck | CC0 | https://opengameart.org/content/100-cc0-sfx | 裁首尾静音、单声道 44.1k、增益 -1.7dB |
| tick/tick-1.mp3 | Kenney - UI Audio | rollover2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/ui-audio | 裁首尾静音、单声道 44.1k、增益 -9.9dB |
| tick/tick-2.mp3 | Kenney - UI Audio | rollover3.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/ui-audio | 裁首尾静音、单声道 44.1k、增益 -9.4dB |
| tick/tick-3.mp3 | Kenney - Interface Sounds | tick_004.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/interface-sounds | 裁首尾静音、单声道 44.1k、增益 -8.1dB |
| pick/pick-1.mp3 | Kenney - Casino Audio | chip-lay-1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 -1.0dB |
| pick/pick-2.mp3 | Kenney - Casino Audio | chip-lay-3.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 0.7dB |
| pick/pick-3.mp3 | Kenney - Casino Audio | chips-stack-6.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 1.4dB |
| lift/lift-1.mp3 | Kenney - Casino Audio | cards-pack-take-out-1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 -7.0dB |
| lift/lift-2.mp3 | Kenney - Casino Audio | cards-pack-take-out-2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 -2.3dB |
| lift/lift-3.mp3 | Kenney - Casino Audio | card-fan-1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 -1.4dB |
| drop/drop-1.mp3 | Kenney - Casino Audio | card-place-1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 1.2dB |
| drop/drop-2.mp3 | Kenney - Casino Audio | card-place-2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 2.0dB |
| drop/drop-3.mp3 | Kenney - Casino Audio | card-place-4.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 2.7dB |
| drop/drop-4.mp3 | Kenney - Casino Audio | card-place-3.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 1.1dB、截断至 0.80s |
| thud/thud-1.mp3 | Kenney - RPG Audio | bookPlace1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 -7.5dB |
| thud/thud-2.mp3 | Kenney - RPG Audio | bookPlace2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 -8.5dB |
| thud/thud-3.mp3 | Kenney - Impact Sounds | impactSoft_heavy_001.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -8.6dB |
| thud/thud-4.mp3 | Kenney - RPG Audio | dropLeather.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 -2.8dB |
| paper/paper-1.mp3 | OpenGameArt - Various Paper Sound Effects | Paper Sound - 1.mp3 | Luckius | CC0 | https://opengameart.org/content/various-paper-sound-effects | 裁首尾静音、单声道 44.1k、增益 6.3dB |
| paper/paper-2.mp3 | OpenGameArt - Various Paper Sound Effects | Paper Sound - 2.mp3 | Luckius | CC0 | https://opengameart.org/content/various-paper-sound-effects | 裁首尾静音、单声道 44.1k、增益 7.1dB |
| paper/paper-3.mp3 | OpenGameArt - Various Paper Sound Effects | Paper Sound - 3.mp3 | Luckius | CC0 | https://opengameart.org/content/various-paper-sound-effects | 裁首尾静音、单声道 44.1k、增益 8.3dB |
| paper/paper-4.mp3 | OpenGameArt - 100 CC0 SFX | paper_01.ogg | rubberduck | CC0 | https://opengameart.org/content/100-cc0-sfx | 裁首尾静音、单声道 44.1k、增益 5.3dB |
| flip/flip-1.mp3 | Kenney - RPG Audio | bookFlip1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 -0.7dB |
| flip/flip-2.mp3 | Kenney - RPG Audio | bookFlip3.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 5.7dB |
| flip/flip-3.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Pages that turn #6 (sound #2213, /UPLOAD/mp3/2213.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/pages-that-turn-6-s2213.html | 裁首尾静音、单声道 44.1k、增益 8.2dB |
| flip/flip-4.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Pages that turn #4 (sound #2211, /UPLOAD/mp3/2211.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/pages-that-turn-4-s2211.html | 裁首尾静音、单声道 44.1k、增益 13.2dB、截断至 1.00s |
| slide/slide-1.mp3 | Kenney - Casino Audio | card-slide-1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 1.2dB |
| slide/slide-2.mp3 | Kenney - Casino Audio | card-slide-3.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 1.1dB |
| slide/slide-3.mp3 | Kenney - Casino Audio | card-slide-5.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 2.2dB |
| slide/slide-4.mp3 | Kenney - Casino Audio | card-shove-3.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 4.6dB |
| coin/coin-1.mp3 | Kenney - RPG Audio | handleCoins2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 7.7dB |
| coin/coin-2.mp3 | Kenney - RPG Audio | handleCoins.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 -0.2dB |
| coin/coin-3.mp3 | Kenney - Casino Audio | chips-collide-1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 1.4dB |
| coin/coin-4.mp3 | Kenney - Casino Audio | chips-handle-3.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 1.2dB |
| levelup/levelup-1.mp3 | OpenGameArt - 85 Short music jingles (Kenney) | jingles_STEEL10.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -10.6dB |
| levelup/levelup-2.mp3 | OpenGameArt - 85 Short music jingles (Kenney) | jingles_PIZZA10.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -10.6dB |
| levelup/levelup-3.mp3 | OpenGameArt - 85 Short music jingles (Kenney) | jingles_SAX10.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -6.6dB |
| melt/melt-1.mp3 | Kenney - Sci-Fi Sounds | slime_000.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/sci-fi-sounds | 裁首尾静音、单声道 44.1k、增益 3.4dB |
| melt/melt-2.mp3 | Kenney - Sci-Fi Sounds | slime_001.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/sci-fi-sounds | 裁首尾静音、单声道 44.1k、增益 0.2dB<br>层1: 截取 1.4s |
| melt/melt-3.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque)<br>Kenney - Sci-Fi Sounds | Chimes "dream" #7 (sound #2085, /UPLOAD/mp3/2085.mp3)<br>slime_000.ogg | Joseph SARDIN<br>Kenney Vleugels (Kenney.nl) | CC0 | https://bigsoundbank.com/chimes-dream-7-s2085.html<br>https://kenney.nl/assets/sci-fi-sounds | 裁首尾静音、单声道 44.1k、增益 -1.5dB、截断至 1.50s、2 层混合<br>层1: 截取 1.2s、倒放(蓄力上升感); 层2: 延迟 1.1s 叠加、-2dB |
| shatter/shatter-1.mp3 | OpenGameArt - 75 CC0 breaking / falling / hit sfx | bfh1_glass_breaking_02.ogg | rubberduck | CC0 | https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx | 裁首尾静音、单声道 44.1k、增益 -2.1dB |
| shatter/shatter-2.mp3 | OpenGameArt - 75 CC0 breaking / falling / hit sfx | bfh1_glass_breaking_05.ogg | rubberduck | CC0 | https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx | 裁首尾静音、单声道 44.1k、增益 -0.4dB |
| shatter/shatter-3.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Glass Burst (sound #148, /UPLOAD/mp3/148.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/glass-burst-s0148.html | 裁首尾静音、单声道 44.1k、增益 -8.2dB、截断至 1.20s |
| shatter/shatter-4.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Broken Glass of Champagne (sound #1591, /UPLOAD/mp3/1591.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/broken-glass-of-champagne-s1591.html | 裁首尾静音、单声道 44.1k、增益 -1.3dB |
| deny/deny-1.mp3 | Kenney - RPG Audio | metalLatch.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 -5.4dB |
| deny/deny-2.mp3 | Kenney - RPG Audio | creak3.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 -4.9dB |
| deny/deny-3.mp3 | Kenney - Impact Sounds | impactSoft_medium_001.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -11.2dB |
| error/error-1.mp3 | Kenney - Impact Sounds | impactPlate_light_002.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -0.8dB |
| error/error-2.mp3 | Kenney - Impact Sounds | impactMetal_light_003.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -5.3dB |
| error/error-3.mp3 | Kenney - Interface Sounds | error_006.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/interface-sounds | 裁首尾静音、单声道 44.1k、增益 -8.2dB |
| success/success-1.mp3 | OpenGameArt - 85 Short music jingles (Kenney) | jingles_PIZZA08.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -9.4dB |
| success/success-2.mp3 | OpenGameArt - 85 Short music jingles (Kenney) | jingles_STEEL08.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -8.6dB |
| success/success-3.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Chimes "butterfly" #2 (sound #2088, /UPLOAD/mp3/2088.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/chimes-butterfly-2-s2088.html | 裁首尾静音、单声道 44.1k、增益 0.6dB<br>层1: 截取 1.1s |
| equip/equip-1.mp3 | Kenney - RPG Audio | beltHandle1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 1.8dB |
| equip/equip-2.mp3 | Kenney - RPG Audio | beltHandle2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 4.6dB |
| equip/equip-3.mp3 | Kenney - RPG Audio | clothBelt.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 4.3dB |
| equip/equip-4.mp3 | Kenney - RPG Audio | metalClick.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 8.1dB |
| unequip/unequip-1.mp3 | Kenney - RPG Audio | handleSmallLeather.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 9.4dB |
| unequip/unequip-2.mp3 | Kenney - RPG Audio | handleSmallLeather2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 12.0dB |
| unequip/unequip-3.mp3 | Kenney - RPG Audio | cloth2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 2.7dB |
| unequip/unequip-4.mp3 | Kenney - RPG Audio | cloth3.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 4.5dB |
| tear/tear-1.mp3 | Kenney - Casino Audio | cards-pack-open-1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 0.1dB |
| tear/tear-2.mp3 | Kenney - Casino Audio | cards-pack-open-2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 2.9dB |
| tear/tear-3.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Torn paper #9 (sound #3246, /UPLOAD/mp3/3246.mp3) | Joseph SARDIN & Axeline T. | CC0 | https://bigsoundbank.com/torn-paper-9-s3246.html | 裁首尾静音、单声道 44.1k、增益 5.1dB |
| tear/tear-4.mp3 | OpenGameArt - Various Paper Sound Effects | Paper Ripped - 1.mp3 | Luckius | CC0 | https://opengameart.org/content/various-paper-sound-effects | 裁首尾静音、单声道 44.1k、增益 1.7dB |
| charge/charge-1.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Chimes "Dream" #8 (sound #2086, /UPLOAD/mp3/2086.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/chimes-dream-8-s2086.html | 裁首尾静音、单声道 44.1k、增益 -2.6dB<br>层1: 截取 1.5s、倒放(蓄力上升感) |
| charge/charge-2.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Chimes "Dream" #1 (sound #2079, /UPLOAD/mp3/2079.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/chimes-dream-1-s2079.html | 裁首尾静音、单声道 44.1k、增益 -4.3dB<br>层1: 截取 1.5s、倒放(蓄力上升感) |
| charge/charge-3.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Glockenspiel (sound #920, /UPLOAD/mp3/920.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/glockenspiel-s0920.html | 裁首尾静音、单声道 44.1k、增益 -3.4dB<br>层1: 截取 1.5s、倒放(蓄力上升感) |
| shine/shine-1.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Chimes "dream" #3 (sound #2081, /UPLOAD/mp3/2081.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/chimes-dream-3-s2081.html | 裁首尾静音、单声道 44.1k、增益 -0.5dB |
| shine/shine-2.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Chimes "dream" #5 (sound #2083, /UPLOAD/mp3/2083.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/chimes-dream-5-s2083.html | 裁首尾静音、单声道 44.1k、增益 0.3dB |
| shine/shine-3.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Chimes "butterfly" #3 (sound #2089, /UPLOAD/mp3/2089.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/chimes-butterfly-3-s2089.html | 裁首尾静音、单声道 44.1k、增益 -0.2dB、截断至 1.50s |
| reveal-c/reveal-c-1.mp3 | Kenney - Casino Audio | card-slide-8.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 2.9dB |
| reveal-c/reveal-c-2.mp3 | Kenney - Casino Audio | card-slide-6.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/casino-audio | 裁首尾静音、单声道 44.1k、增益 4.7dB |
| reveal-c/reveal-c-3.mp3 | Kenney - RPG Audio | bookFlip2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 9.7dB |
| reveal-r/reveal-r-1.mp3 | Kenney - Casino Audio<br>BigSoundBank (Joseph SARDIN / LaSonotheque) | card-slide-2.ogg<br>Chimes "dream" #3 (sound #2081, /UPLOAD/mp3/2081.mp3) | Kenney Vleugels (Kenney.nl)<br>Joseph SARDIN | CC0 | https://kenney.nl/assets/casino-audio<br>https://bigsoundbank.com/chimes-dream-3-s2081.html | 裁首尾静音、单声道 44.1k、增益 0.7dB、2 层混合<br>层2: 截取 1s、延迟 0.1s 叠加、-6dB |
| reveal-r/reveal-r-2.mp3 | Kenney - Casino Audio<br>BigSoundBank (Joseph SARDIN / LaSonotheque) | card-slide-4.ogg<br>Chimes "dream" #2 (sound #2080, /UPLOAD/mp3/2080.mp3) | Kenney Vleugels (Kenney.nl)<br>Joseph SARDIN | CC0 | https://kenney.nl/assets/casino-audio<br>https://bigsoundbank.com/chimes-dream-2-s2080.html | 裁首尾静音、单声道 44.1k、增益 1.2dB、2 层混合<br>层2: 截取 1s、延迟 0.1s 叠加、-6dB |
| reveal-e/reveal-e-1.mp3 | Kenney - Casino Audio<br>BigSoundBank (Joseph SARDIN / LaSonotheque)<br>BigSoundBank (Joseph SARDIN / LaSonotheque) | card-slide-6.ogg<br>Chimes "butterfly" #1 (sound #2087, /UPLOAD/mp3/2087.mp3)<br>Chimes "dream" #4 (sound #2082, /UPLOAD/mp3/2082.mp3) | Kenney Vleugels (Kenney.nl)<br>Joseph SARDIN<br>Joseph SARDIN | CC0 | https://kenney.nl/assets/casino-audio<br>https://bigsoundbank.com/chimes-butterfly-1-s2087.html<br>https://bigsoundbank.com/chimes-dream-4-s2082.html | 裁首尾静音、单声道 44.1k、增益 3.7dB、3 层混合<br>层2: 截取 1.5s、延迟 0.1s 叠加、-4dB; 层3: 截取 1.2s、延迟 0.25s 叠加、-8dB |
| reveal-e/reveal-e-2.mp3 | Kenney - Casino Audio<br>BigSoundBank (Joseph SARDIN / LaSonotheque)<br>BigSoundBank (Joseph SARDIN / LaSonotheque) | card-slide-7.ogg<br>Chimes "butterfly" #2 (sound #2088, /UPLOAD/mp3/2088.mp3)<br>Chimes "dream" #5 (sound #2083, /UPLOAD/mp3/2083.mp3) | Kenney Vleugels (Kenney.nl)<br>Joseph SARDIN<br>Joseph SARDIN | CC0 | https://kenney.nl/assets/casino-audio<br>https://bigsoundbank.com/chimes-butterfly-2-s2088.html<br>https://bigsoundbank.com/chimes-dream-5-s2083.html | 裁首尾静音、单声道 44.1k、增益 1.9dB、3 层混合<br>层2: 截取 1.5s、延迟 0.1s 叠加、-4dB; 层3: 截取 1.2s、延迟 0.22s 叠加、-8dB |
| reveal-l/reveal-l-1.mp3 | Kenney - Casino Audio<br>BigSoundBank (Joseph SARDIN / LaSonotheque)<br>BigSoundBank (Joseph SARDIN / LaSonotheque) | card-slide-1.ogg<br>Glockenspiel (sound #920, /UPLOAD/mp3/920.mp3)<br>Chimes "Dream" #8 (sound #2086, /UPLOAD/mp3/2086.mp3) | Kenney Vleugels (Kenney.nl)<br>Joseph SARDIN<br>Joseph SARDIN | CC0 | https://kenney.nl/assets/casino-audio<br>https://bigsoundbank.com/glockenspiel-s0920.html<br>https://bigsoundbank.com/chimes-dream-8-s2086.html | 裁首尾静音、单声道 44.1k、增益 -1.0dB、3 层混合<br>层2: 截取 2.2s、延迟 0.08s 叠加、-4dB; 层3: 截取 2s、延迟 0.1s 叠加、-6dB |
| reveal-l/reveal-l-2.mp3 | Kenney - Casino Audio<br>BigSoundBank (Joseph SARDIN / LaSonotheque)<br>BigSoundBank (Joseph SARDIN / LaSonotheque)<br>BigSoundBank (Joseph SARDIN / LaSonotheque) | card-place-3.ogg<br>Chimes "Dream" #8 (sound #2086, /UPLOAD/mp3/2086.mp3)<br>Chimes "butterfly" #3 (sound #2089, /UPLOAD/mp3/2089.mp3)<br>Chimes "dream" #7 (sound #2085, /UPLOAD/mp3/2085.mp3) | Kenney Vleugels (Kenney.nl)<br>Joseph SARDIN<br>Joseph SARDIN<br>Joseph SARDIN | CC0 | https://kenney.nl/assets/casino-audio<br>https://bigsoundbank.com/chimes-dream-8-s2086.html<br>https://bigsoundbank.com/chimes-butterfly-3-s2089.html<br>https://bigsoundbank.com/chimes-dream-7-s2085.html | 裁首尾静音、单声道 44.1k、增益 -1.8dB、4 层混合<br>层2: 截取 2.2s、延迟 0.1s 叠加、-3dB; 层3: 截取 1.8s、延迟 0.3s 叠加、-6dB; 层4: 截取 1.6s、延迟 0.6s 叠加、-9dB |
| reveal-radiant/reveal-radiant-1.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque)<br>Kenney - Impact Sounds<br>BigSoundBank (Joseph SARDIN / LaSonotheque)<br>BigSoundBank (Joseph SARDIN / LaSonotheque) | Chimes "Dream" #8 (sound #2086, /UPLOAD/mp3/2086.mp3)<br>impactBell_heavy_002.ogg<br>Dreamcatcher (sound #40, /UPLOAD/mp3/40.mp3)<br>Glockenspiel (sound #920, /UPLOAD/mp3/920.mp3) | Joseph SARDIN<br>Kenney Vleugels (Kenney.nl)<br>Joseph SARDIN<br>Joseph SARDIN | CC0 | https://bigsoundbank.com/chimes-dream-8-s2086.html<br>https://kenney.nl/assets/impact-sounds<br>https://bigsoundbank.com/dreamcatcher-s0040.html<br>https://bigsoundbank.com/glockenspiel-s0920.html | 裁首尾静音、单声道 44.1k、增益 1.2dB、4 层混合<br>层1: 截取 1s、倒放(蓄力上升感)、-4dB; 层2: 延迟 1s 叠加、-3dB; 层3: 截取 2s、延迟 1s 叠加、-3dB; 层4: 截取 1.9s、延迟 1.05s 叠加、-5dB |
| reveal-radiant/reveal-radiant-2.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque)<br>Kenney - Casino Audio<br>BigSoundBank (Joseph SARDIN / LaSonotheque)<br>BigSoundBank (Joseph SARDIN / LaSonotheque) | Chimes "Dream" #1 (sound #2079, /UPLOAD/mp3/2079.mp3)<br>card-place-3.ogg<br>Chimes "butterfly" #2 (sound #2088, /UPLOAD/mp3/2088.mp3)<br>Chimes "dream" #6 (sound #2084, /UPLOAD/mp3/2084.mp3) | Joseph SARDIN<br>Kenney Vleugels (Kenney.nl)<br>Joseph SARDIN<br>Joseph SARDIN | CC0 | https://bigsoundbank.com/chimes-dream-1-s2079.html<br>https://kenney.nl/assets/casino-audio<br>https://bigsoundbank.com/chimes-butterfly-2-s2088.html<br>https://bigsoundbank.com/chimes-dream-6-s2084.html | 裁首尾静音、单声道 44.1k、增益 1.2dB、4 层混合<br>层1: 截取 1s、倒放(蓄力上升感)、-4dB; 层2: 延迟 1s 叠加; 层3: 截取 2s、延迟 1s 叠加、-3dB; 层4: 截取 1.6s、延迟 1.3s 叠加、-8dB |
| reveal-prismatic/reveal-prismatic-1.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque)<br>Kenney - Impact Sounds<br>BigSoundBank (Joseph SARDIN / LaSonotheque)<br>BigSoundBank (Joseph SARDIN / LaSonotheque)<br>OpenGameArt - 85 Short music jingles (Kenney) | Chimes "Dream" #1 (sound #2079, /UPLOAD/mp3/2079.mp3)<br>impactBell_heavy_000.ogg<br>Dreamcatcher (sound #40, /UPLOAD/mp3/40.mp3)<br>Glockenspiel (sound #920, /UPLOAD/mp3/920.mp3)<br>jingles_STEEL02.ogg | Joseph SARDIN<br>Kenney Vleugels (Kenney.nl)<br>Joseph SARDIN<br>Joseph SARDIN<br>Kenney Vleugels (Kenney.nl) | CC0 | https://bigsoundbank.com/chimes-dream-1-s2079.html<br>https://kenney.nl/assets/impact-sounds<br>https://bigsoundbank.com/dreamcatcher-s0040.html<br>https://bigsoundbank.com/glockenspiel-s0920.html<br>https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -2.5dB、5 层混合<br>层1: 截取 0.9s、倒放(蓄力上升感)、-4dB; 层2: 延迟 0.9s 叠加、-4dB; 层3: 截取 2.1s、延迟 0.9s 叠加、-3dB; 层4: 截取 2s、延迟 0.95s 叠加、-5dB; 层5: 延迟 0.95s 叠加、-7dB |
| reveal-prismatic/reveal-prismatic-2.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque)<br>Kenney - Impact Sounds<br>BigSoundBank (Joseph SARDIN / LaSonotheque)<br>BigSoundBank (Joseph SARDIN / LaSonotheque)<br>OpenGameArt - 85 Short music jingles (Kenney) | Chimes "Dream" #8 (sound #2086, /UPLOAD/mp3/2086.mp3)<br>impactBell_heavy_001.ogg<br>Chimes "butterfly" #3 (sound #2089, /UPLOAD/mp3/2089.mp3)<br>Chimes "butterfly" #1 (sound #2087, /UPLOAD/mp3/2087.mp3)<br>jingles_PIZZA02.ogg | Joseph SARDIN<br>Kenney Vleugels (Kenney.nl)<br>Joseph SARDIN<br>Joseph SARDIN<br>Kenney Vleugels (Kenney.nl) | CC0 | https://bigsoundbank.com/chimes-dream-8-s2086.html<br>https://kenney.nl/assets/impact-sounds<br>https://bigsoundbank.com/chimes-butterfly-3-s2089.html<br>https://bigsoundbank.com/chimes-butterfly-1-s2087.html<br>https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -2.5dB、5 层混合<br>层1: 截取 0.9s、倒放(蓄力上升感)、-4dB; 层2: 延迟 0.9s 叠加、-4dB; 层3: 截取 2.1s、延迟 0.9s 叠加、-3dB; 层4: 截取 1.8s、延迟 1.2s 叠加、-6dB; 层5: 延迟 0.95s 叠加、-7dB |
| hit/hit-1.mp3 | Kenney - Impact Sounds | impactPunch_medium_000.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -10.6dB |
| hit/hit-2.mp3 | Kenney - Impact Sounds | impactPunch_medium_001.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -10.7dB |
| hit/hit-3.mp3 | Kenney - Impact Sounds | impactWood_heavy_000.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -6.4dB |
| crit/crit-1.mp3 | Kenney - Impact Sounds<br>Kenney - Impact Sounds | impactPunch_heavy_002.ogg<br>impactMetal_light_000.ogg | Kenney Vleugels (Kenney.nl)<br>Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds<br>https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -10.2dB、截断至 0.40s、2 层混合<br>层2: -4dB |
| crit/crit-2.mp3 | Kenney - Impact Sounds<br>Kenney - Impact Sounds | impactPunch_heavy_003.ogg<br>impactMetal_light_001.ogg | Kenney Vleugels (Kenney.nl)<br>Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds<br>https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -9.7dB、截断至 0.40s、2 层混合<br>层2: -4dB |
| crit/crit-3.mp3 | Kenney - Impact Sounds | impactMetal_heavy_001.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -2.4dB |
| miss/miss-1.mp3 | Kenney - RPG Audio | cloth1.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 0.1dB、截断至 0.50s |
| miss/miss-2.mp3 | Kenney - RPG Audio | cloth2.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 2.7dB |
| miss/miss-3.mp3 | Kenney - RPG Audio | clothBelt.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 4.3dB、截断至 0.50s |
| heal/heal-1.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Chimes "dream" #6 (sound #2084, /UPLOAD/mp3/2084.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/chimes-dream-6-s2084.html | 裁首尾静音、单声道 44.1k、增益 -0.3dB、截断至 1.00s |
| heal/heal-2.mp3 | BigSoundBank (Joseph SARDIN / LaSonotheque) | Chimes "dream" #7 (sound #2085, /UPLOAD/mp3/2085.mp3) | Joseph SARDIN | CC0 | https://bigsoundbank.com/chimes-dream-7-s2085.html | 裁首尾静音、单声道 44.1k、增益 -1.6dB、截断至 1.00s |
| guard/guard-1.mp3 | Kenney - Impact Sounds | impactMetal_medium_000.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -4.5dB |
| guard/guard-2.mp3 | Kenney - Impact Sounds | impactMetal_medium_001.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -6.5dB |
| guard/guard-3.mp3 | Kenney - Impact Sounds | impactPlate_medium_000.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -0.4dB、截断至 0.60s |
| turn/turn-1.mp3 | Kenney - Impact Sounds | impactBell_heavy_004.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -3.8dB |
| turn/turn-2.mp3 | Kenney - Impact Sounds | impactBell_heavy_003.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -1.4dB |
| turn/turn-3.mp3 | OpenGameArt - 100 CC0 SFX | bell_02.ogg | rubberduck | CC0 | https://opengameart.org/content/100-cc0-sfx | 裁首尾静音、单声道 44.1k、增益 -2.0dB |
| cutin/cutin-1.mp3 | Kenney - RPG Audio<br>Kenney - Impact Sounds | knifeSlice.ogg<br>impactMetal_light_000.ogg | Kenney Vleugels (Kenney.nl)<br>Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio<br>https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -6.3dB、2 层混合<br>层2: 延迟 0.15s 叠加、-3dB |
| cutin/cutin-2.mp3 | Kenney - RPG Audio<br>Kenney - Impact Sounds | knifeSlice2.ogg<br>impactPlate_light_000.ogg | Kenney Vleugels (Kenney.nl)<br>Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio<br>https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -6.3dB、2 层混合<br>层2: 延迟 0.18s 叠加、-3dB |
| break/break-1.mp3 | Kenney - Impact Sounds | impactGlass_heavy_000.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -3.6dB |
| break/break-2.mp3 | Kenney - Impact Sounds | impactGlass_heavy_002.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -2.9dB |
| break/break-3.mp3 | Kenney - Impact Sounds | impactMetal_heavy_001.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -2.4dB |
| down/down-1.mp3 | Kenney - Impact Sounds | impactSoft_heavy_002.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -8.9dB |
| down/down-2.mp3 | Kenney - RPG Audio | dropLeather.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/rpg-audio | 裁首尾静音、单声道 44.1k、增益 -2.8dB |
| down/down-3.mp3 | Kenney - Impact Sounds | impactWood_heavy_003.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://kenney.nl/assets/impact-sounds | 裁首尾静音、单声道 44.1k、增益 -5.6dB |
| win/win-1.mp3 | OpenGameArt - 85 Short music jingles (Kenney) | jingles_STEEL02.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -10.2dB |
| win/win-2.mp3 | OpenGameArt - 85 Short music jingles (Kenney) | jingles_PIZZA02.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -11.3dB |
| win/win-3.mp3 | OpenGameArt - 85 Short music jingles (Kenney) | jingles_SAX02.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -6.7dB |
| lose/lose-1.mp3 | OpenGameArt - 85 Short music jingles (Kenney) | jingles_STEEL01.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -10.5dB |
| lose/lose-2.mp3 | OpenGameArt - 85 Short music jingles (Kenney) | jingles_STEEL07.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -8.7dB |
| lose/lose-3.mp3 | OpenGameArt - 85 Short music jingles (Kenney) | jingles_PIZZA01.ogg | Kenney Vleugels (Kenney.nl) | CC0 | https://opengameart.org/content/85-short-music-jingles | 裁首尾静音、单声道 44.1k、增益 -10.9dB |
