# dead-drop

> Hide secret messages — and entire images — inside ordinary photos. LSB steganography that runs entirely in your browser.

**[Live demo →](https://nazalas.github.io/dead-drop)**

Named after the spy tradecraft technique: leaving hidden messages in plain sight, for retrieval without direct contact.

---

## What it does

dead-drop lets you embed secret text or images inside any PNG by manipulating the least significant bits (LSBs) of each pixel's color channels. The result looks identical to the original — but carries a hidden payload readable only with the right tool and passphrase.

### Features

- **LSB text encoding** — hide text in 1–4 bits per channel (1 bit = completely invisible)
- **Image-in-image (spatial)** — hide an entire image inside another; the hidden image is spatially mapped pixel-to-pixel so it's visible as a ghost in the visualizer
- **Channel-aware color encoding** — RGB = full color recovery, single channel = grayscale, partial = tinted; your choice, stored in the header
- **Multi-channel support** — encode across any combination of Red, Green, Blue, and Alpha
- **Alpha channel hiding** — the most covert option; barely anyone inspects alpha
- **AES-256-GCM encryption** — optional passphrase encrypts text payloads before embedding (PBKDF2, 100k iterations)
- **Auto-detect** — scans all 60 channel/bit-depth combinations to find hidden data automatically
- **Channel visualizer** — four modes: raw channel, LSB amplified, LSB heatmap, and Reveal Hidden Image
- **Zero backend** — everything runs in the browser via Canvas API and Web Crypto. No data is ever uploaded.
- **Demo images** — pre-baked samples with hidden messages ready to decode

---

## How it works

Every pixel is stored as 4 bytes: Red, Green, Blue, Alpha (0–255 each).

Changing the **least significant bit** of a channel shifts its value by at most 1 — imperceptible as a color change, but enough to carry one bit of information per channel per pixel.

A 800×533 image has ~426K pixels. At 1 bpp across 4 channels that's ~213KB of capacity — enough for a long text message or a small hidden image.

### Text payload format
```
[0xDE][0xAD][0x01][length: 4 bytes BE][message bytes…]
```

### Spatial image-in-image format
```
Header (8 pixels, Red channel, full byte):
  px0: 0x5D  px1: 0xD5  (magic)
  px2-3: hidden width (BE)
  px4-5: hidden height (BE)
  px6: bits per channel
  px7: channel bitmask (bit0=R, bit1=G, bit2=B, bit3=A)

Then: hidden pixel[x,y] → carrier pixel[x+8,y] LSBs
```

The spatial format maps hidden pixels directly onto carrier pixels at the same coordinates — so the hidden image is visible as a ghost in the LSB visualizer.

### With a passphrase
1. Derive AES-256 key via PBKDF2 (SHA-256, 100k iterations, 16-byte random salt)
2. Encrypt with AES-GCM (12-byte random IV)
3. Store `[salt(16)][iv(12)][ciphertext]` as the payload
4. Embed into image LSBs

---

## Usage

### Hide a text message
1. **Encode tab** → upload a PNG carrier image
2. Select **Text message**, type your secret
3. Choose channels and bit depth; add passphrase if desired
4. **Hide Message** → download the output PNG

### Hide an image inside an image
1. **Encode tab** → upload a carrier PNG
2. Select **Hidden image** → upload the image to hide
3. Choose channels — RGB = full color, one channel = grayscale
4. **Hide Message** → download output
5. Load into **Visualize → Reveal hidden image** to see it materialize

### Decode
1. **Decode tab** → upload an encoded PNG
2. Hit **Auto-detect** — it scans all combinations and lists what it finds
3. Click a result to decode it instantly
4. Enter passphrase if the message was encrypted

### Visualize
Upload any image and switch between:
- **LSB amplified** — see where data lives in each channel
- **LSB heatmap** — combined view across all channels
- **Reveal hidden image** — decodes a spatial image payload directly in the visualizer

---

## ⚠️ Always use PNG

JPEG compression is lossy — it destroys the precise LSB values. Always download and share as PNG to preserve the hidden payload.

---

## Project structure

```
dead-drop/
├── index.html              # Single-page app
├── css/style.css           # Dark theme UI
├── js/
│   ├── steganography.js    # LSB + spatial encode/decode engine
│   ├── crypto.js           # AES-256-GCM via Web Crypto API
│   ├── visualizer.js       # Channel rendering, heatmap, spatial reveal
│   └── app.js              # UI logic
├── samples/
│   ├── demo-1.png          # Mountains — hidden text in Red channel
│   └── demo-2.png          # Forest — hidden text in Alpha channel
├── favicon.ico / favicon.png / favicon-192.png
├── dead-drop-hero.png      # Portfolio hero image
└── generate-samples.js     # Node script to regenerate demo images
```

---

## Running locally

No build step — plain HTML/CSS/JS with ES modules.

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open `http://localhost:8080`. ES modules require a server — can't open `index.html` as `file://`.

---

## License

MIT
