# dead-drop

> Hide secret messages inside ordinary images. LSB steganography that runs entirely in your browser.

**[Live demo →](https://nazalas.github.io/dead-drop)**

Named after the spy tradecraft technique: leaving hidden messages in plain sight, for retrieval without direct contact.

---

## What it does

dead-drop lets you embed secret text inside any PNG image by manipulating the least significant bits (LSBs) of each pixel's color channels. The result looks identical to the original — but carries a hidden payload readable only with the right tool and passphrase.

### Features

- **LSB encoding** — hide data in 1–4 bits per channel (1 bit = completely invisible to the eye)
- **Multi-channel support** — encode across Red, Green, Blue, and/or Alpha channels
- **Alpha channel hiding** — particularly covert; barely anyone inspects the alpha channel
- **AES-256-GCM encryption** — optional passphrase encrypts the message before embedding (PBKDF2, 100k iterations)
- **Auto-detect** — scans all channel combinations to find hidden data without knowing the settings
- **Channel visualizer** — renders isolated LSB data to reveal hidden patterns visually
- **LSB heatmap** — combined view showing exactly where data is distributed
- **Zero backend** — everything runs in the browser via Canvas API and Web Crypto. No data is ever uploaded.
- **Demo images** — pre-baked samples with hidden messages ready to decode

---

## How it works

Every pixel in an image is stored as 4 bytes: Red, Green, Blue, Alpha (each 0–255).

Changing the **least significant bit** of a channel shifts its value by at most 1 — imperceptible as a color change, but enough to encode one bit of information per channel per pixel.

A 640×400 image has 256,000 pixels. At 1 bit per channel across all 4 channels, that's 128,000 bytes (~125 KB) of hidden data capacity.

**Payload format:**
```
[0xDE][0xAD][0x01][length: 4 bytes big-endian][message bytes…]
```
The `0xDEAD` magic header lets the decoder validate it found real data, not random noise.

**With a passphrase:**
1. Derive AES-256 key via PBKDF2 (SHA-256, 100k iterations, random 16-byte salt)
2. Encrypt message with AES-GCM (random 12-byte IV)
3. Store `[salt(16)][iv(12)][ciphertext]` as the payload
4. Embed that payload into the image LSBs

---

## Usage

### Encode
1. Drop a PNG image onto the Encode tab
2. Type your secret message
3. Choose channels (R/G/B/Alpha) and bit depth (1–4)
4. Optionally add a passphrase
5. Click **Hide Message** → download the output PNG

### Decode
1. Drop an encoded PNG onto the Decode tab
2. Match the channel and bit depth settings (or hit **Auto-detect**)
3. Enter passphrase if one was used
4. Click **Decode** → message appears

### Visualize
Upload any image and inspect its individual channels in LSB mode. Encoded images will show a visible pattern in the amplified LSB view that clean images won't.

---

## ⚠️ Use PNG, not JPEG

JPEG compression is lossy — it destroys the precise LSB values we embed. Always save and share encoded images as PNG.

---

## Project structure

```
dead-drop/
├── index.html              # Single-page app
├── css/
│   └── style.css           # Dark theme UI
├── js/
│   ├── steganography.js    # LSB encode/decode engine
│   ├── crypto.js           # AES-256-GCM via Web Crypto API
│   ├── visualizer.js       # Channel rendering + LSB heatmap
│   └── app.js              # UI logic
├── samples/
│   ├── demo-1.png          # Cityscape — hidden in Red channel
│   └── demo-2.png          # Forest — hidden in Alpha channel
└── generate-samples.js     # Node script to regenerate demo images
```

---

## Running locally

No build step needed — it's plain HTML/CSS/JS with ES modules.

```bash
# Any static server works:
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

> Note: ES modules require a server (can't open `index.html` directly as `file://` due to CORS restrictions on module imports).

---

## Deploying to GitHub Pages

```bash
git push origin main
# Enable GitHub Pages in repo settings → source: main branch / root
```

---

## License

MIT
