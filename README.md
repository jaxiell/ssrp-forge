# SSRP Forge Studio

Android-first local PWA untuk membuat GTA San Andreas Multiplayer / SSRP / ACT screenshot.

## Fitur

- ACT Builder: `/me`, `/do`, IC, whisper, shout, system; timestamp; variables; live preview; raw command copy.
- Layer engine: image, text, chat, shape, brush, mask, blur/pixelate; hide, lock, duplicate, reorder, opacity, transform.
- Touch: satu jari drag layer, dua jari pinch-zoom + pan, pointer capture, no page zoom pada canvas.
- HUD Cleaner: cover, erase, sample warna dari screenshot.
- Crop, rotate, flip, guides, grid, resize canvas.
- Effects: brightness, contrast, saturation, warmth, vignette, grain, fade, soft blur + style presets.
- Local project autosave di IndexedDB; export/import `.ssrp`; server presets di local storage.
- Export PNG/JPG/WebP, kualitas, ukuran output, Share API + download fallback.
- PWA offline shell.

## Run

Jalankan dari HTTP(S), bukan `file://`:

```bash
python3 -m http.server 8080
```

Buka `http://localhost:8080`. Untuk Android, host folder yang sama melalui LAN/hosting HTTPS lalu pilih Install / Add to Home screen.
