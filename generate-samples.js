/**
 * Node.js script to generate demo sample images with baked-in hidden messages.
 * Run: node generate-samples.js
 * Requires: npm install canvas
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// ─── LSB encode (mirrors steganography.js logic) ─────────────────────────────
const MAGIC = [0xDE, 0xAD];

function encode(pixelData, messageBytes, opts = {}) {
  const channels = opts.channels || [0];
  const bpc = Math.min(4, Math.max(1, opts.bitsPerChannel || 1));
  const mask = (1 << bpc) - 1;

  const payloadLen = messageBytes.length;
  const header = Buffer.alloc(7);
  header[0] = MAGIC[0]; header[1] = MAGIC[1]; header[2] = 0x01;
  header[3] = (payloadLen >>> 24) & 0xff;
  header[4] = (payloadLen >>> 16) & 0xff;
  header[5] = (payloadLen >>> 8)  & 0xff;
  header[6] =  payloadLen        & 0xff;

  const payload = Buffer.concat([header, Buffer.from(messageBytes)]);

  const bits = [];
  for (let i = 0; i < payload.length; i++) {
    for (let b = 7; b >= 0; b--) bits.push((payload[i] >> b) & 1);
  }

  let bitIndex = 0;
  const numPixels = pixelData.length / 4;
  for (let px = 0; px < numPixels && bitIndex < bits.length; px++) {
    for (const ch of channels) {
      if (bitIndex >= bits.length) break;
      const chunk = bits.slice(bitIndex, bitIndex + bpc).reduce((a, b) => (a << 1) | b, 0);
      const extra = bpc - bits.slice(bitIndex, bitIndex + bpc).length;
      const finalChunk = extra > 0 ? chunk << extra : chunk;
      const byteIndex = px * 4 + ch;
      pixelData[byteIndex] = (pixelData[byteIndex] & ~mask) | (finalChunk & mask);
      bitIndex += bpc;
    }
  }
}

const { loadImage } = require('canvas');

// ─── Demo 1: Mountain landscape — hidden in Red channel ──────────────────────
async function generateDemo1() {
  const srcPath = path.join(__dirname, 'samples', 'demo-1.png');
  const img = await loadImage(srcPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);

  const message = Buffer.from(
    'You found it. This message was hidden inside a real mountain landscape photo ' +
    'using 1-bit LSB steganography on the Red channel. Every pixel shifted by at most 1 — ' +
    'completely invisible to the human eye, yet carrying this secret. Welcome to dead-drop.'
  );

  encode(imageData.data, message, { channels: [0], bitsPerChannel: 1 });
  ctx.putImageData(imageData, 0, 0);

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(srcPath, buf);
  console.log(`✓ demo-1.png (${img.width}x${img.height}, ${message.length} bytes hidden in R channel @ 1bpp)`);
}

// ─── Demo 2: Forest — hidden in Alpha channel ────────────────────────────────
async function generateDemo2() {
  const srcPath = path.join(__dirname, 'samples', 'demo-2.png');
  const img = await loadImage(srcPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);

  const message = Buffer.from(
    'Another drop, another secret. This forest image hides data in the Alpha channel — ' +
    'a channel most people never think to check. The image is fully opaque, so the alpha ' +
    'channel is 255 everywhere. A perfect hiding spot. ' +
    'Try the Visualizer tab: switch to Alpha channel LSB mode. You\'ll see the pattern emerge.'
  );

  encode(imageData.data, message, { channels: [3], bitsPerChannel: 1 });
  ctx.putImageData(imageData, 0, 0);

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(srcPath, buf);
  console.log(`✓ demo-2.png (${img.width}x${img.height}, ${message.length} bytes hidden in Alpha channel @ 1bpp)`);
}

(async () => {
  await generateDemo1();
  await generateDemo2();
  console.log('\nDone. Samples written to samples/');
})();
