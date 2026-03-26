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

// ─── Generate a simple gradient image ────────────────────────────────────────
function makeGradientImage(width, height, colorFn) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = colorFn(x / width, y / height);
      img.data[i + 0] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
      // Add noise so it looks photographic
      const noise = (Math.random() - 0.5) * 20;
      img.data[i + 0] = Math.min(255, Math.max(0, img.data[i + 0] + noise));
      img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1] + noise));
      img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2] + noise));
    }
  }
  return { canvas, ctx, img };
}

// ─── Demo 1: Cityscape (sunset gradient) ─────────────────────────────────────
function generateDemo1() {
  const W = 640, H = 400;
  const { canvas, ctx, img } = makeGradientImage(W, H, (nx, ny) => {
    // sunset: deep blue at top → orange/red at horizon → dark at bottom
    const r = Math.round(30 + ny * 200 + (1 - ny) * 10);
    const g = Math.round(20 + ny * 80);
    const b = Math.round(80 - ny * 60);
    return [r, g, b];
  });

  const message = Buffer.from(
    'You found it. This message was hidden inside a sunset gradient using 1-bit LSB steganography on the Red channel. ' +
    'The image looks completely normal, yet carries this secret. Welcome to dead-drop.'
  );

  encode(img.data, message, { channels: [0], bitsPerChannel: 1 });
  ctx.putImageData(img, 0, 0);

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(__dirname, 'samples', 'demo-1.png'), buf);
  console.log(`✓ demo-1.png (${W}x${H}, ${message.length} bytes hidden in R channel @ 1bpp)`);
}

// ─── Demo 2: Forest (green gradient) ─────────────────────────────────────────
function generateDemo2() {
  const W = 640, H = 400;
  const { canvas, ctx, img } = makeGradientImage(W, H, (nx, ny) => {
    const r = Math.round(15 + ny * 40);
    const g = Math.round(60 + (1 - ny) * 80 + nx * 30);
    const b = Math.round(10 + ny * 25);
    return [r, g, b];
  });

  const message = Buffer.from(
    'Another drop, another secret. This forest image hides data in the Alpha channel — ' +
    'a channel most people never think to check. Invisible to the eye, but readable with the right tool. ' +
    'Try the Visualizer tab: switch to Alpha channel, LSB mode. You\'ll see the pattern.'
  );

  encode(img.data, message, { channels: [3], bitsPerChannel: 1 });
  ctx.putImageData(img, 0, 0);

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(__dirname, 'samples', 'demo-2.png'), buf);
  console.log(`✓ demo-2.png (${W}x${H}, ${message.length} bytes hidden in Alpha channel @ 1bpp)`);
}

generateDemo1();
generateDemo2();
console.log('\nDone. Samples written to samples/');
