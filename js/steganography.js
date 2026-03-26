/**
 * dead-drop — steganography engine
 * LSB encoding/decoding across R, G, B, Alpha channels
 */

const MAGIC = [0xDE, 0xAD]; // 2-byte header signature
const VERSION = 0x01;
const VERSION_IMAGE = 0x02; // payload type: raw image

/**
 * Serialize an ImageData into bytes for hiding.
 * Format: [width: 2 bytes BE][height: 2 bytes BE][RGBA pixels...]
 */
export function imageDataToBytes(imageData) {
  const { width, height, data } = imageData;
  const out = new Uint8Array(4 + data.length);
  out[0] = (width >> 8) & 0xff;
  out[1] = width & 0xff;
  out[2] = (height >> 8) & 0xff;
  out[3] = height & 0xff;
  out.set(data, 4);
  return out;
}

/**
 * Deserialize bytes back into a usable ImageData.
 * Returns {imageData, width, height} or null if invalid.
 */
export function bytesToImageData(bytes) {
  if (bytes.length < 4) return null;
  const width  = (bytes[0] << 8) | bytes[1];
  const height = (bytes[2] << 8) | bytes[3];
  if (width <= 0 || height <= 0 || bytes.length < 4 + width * height * 4) return null;
  const pixels = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 4, width * height * 4);
  return { imageData: new ImageData(new Uint8ClampedArray(pixels), width, height), width, height };
}

/**
 * SPATIAL image-in-image encode.
 * Maps each hidden pixel directly onto the corresponding carrier pixel's LSBs.
 * This makes the hidden image visible in the LSB visualizer.
 *
 * Header: written into first 4 pixels of Red channel at full byte resolution
 *   pixel 0 R,G = magic 0xDE, 0xAD
 *   pixel 1 R,G = hidden width high/low byte
 *   pixel 2 R,G = hidden height high/low byte
 *   pixel 3 R   = bitsPerChannel used
 *
 * Then hidden pixel[x,y] channel[c] top-bpc-bits → carrier pixel[x,y] channel[c] LSBs
 * (hidden image must be ≤ carrier dimensions)
 *
 * @param {Uint8ClampedArray} carrierData - modified in place
 * @param {number} carrierW, carrierH
 * @param {ImageData} hiddenImageData
 * @param {number} bpc - bits per channel (1–4); more = more visible ghost
 */
export function encodeSpatial(carrierData, carrierW, carrierH, hiddenImageData, bpc = 2) {
  const { width: hW, height: hH, data: hData } = hiddenImageData;
  if (hW > carrierW || hH > carrierH) throw new Error(`Hidden image (${hW}×${hH}) exceeds carrier (${carrierW}×${carrierH})`);

  const mask = (1 << bpc) - 1;
  const shift = 8 - bpc; // take top bpc bits of hidden channel value

  // Write header into first 4 carrier pixels (Red channel only, full byte)
  // We overwrite the full red channel byte — slight color shift in 4 pixels, worth it for simplicity
  carrierData[0 * 4 + 0] = 0xDE;
  carrierData[1 * 4 + 0] = 0xAD;
  carrierData[2 * 4 + 0] = (hW >> 8) & 0xff;
  carrierData[3 * 4 + 0] = hW & 0xff;
  carrierData[4 * 4 + 0] = (hH >> 8) & 0xff;
  carrierData[5 * 4 + 0] = hH & 0xff;
  carrierData[6 * 4 + 0] = bpc;

  // Encode hidden pixels spatially — skip first 7 carrier pixels (header)
  const HEADER_PX = 7;
  for (let y = 0; y < hH; y++) {
    for (let x = 0; x < hW; x++) {
      // Map hidden (x,y) → carrier pixel, offset by header
      const hIdx = (y * hW + x) * 4;
      const cPx  = HEADER_PX + y * carrierW + x;
      const cIdx = cPx * 4;
      if (cIdx + 3 >= carrierData.length) continue;

      // Encode R, G, B channels (skip A — keep carrier alpha intact)
      for (let ch = 0; ch < 3; ch++) {
        const topBits = (hData[hIdx + ch] >> shift) & mask;
        carrierData[cIdx + ch] = (carrierData[cIdx + ch] & ~mask) | topBits;
      }
    }
  }
}

/**
 * SPATIAL image-in-image decode.
 * Returns {imageData, width, height, bpc} or null if no spatial header found.
 */
export function decodeSpatial(carrierData, carrierW, carrierH) {
  // Check magic
  if (carrierData[0] !== 0xDE || carrierData[4] !== 0xAD) return null;

  const hW  = (carrierData[8]  << 8) | carrierData[12];
  const hH  = (carrierData[16] << 8) | carrierData[20];
  const bpc = carrierData[24];

  if (hW <= 0 || hH <= 0 || hW > carrierW || hH > carrierH) return null;
  if (bpc < 1 || bpc > 4) return null;

  const mask  = (1 << bpc) - 1;
  const scale = Math.round(255 / mask); // amplify back to 0–255
  const HEADER_PX = 7;

  const hData = new Uint8ClampedArray(hW * hH * 4);

  for (let y = 0; y < hH; y++) {
    for (let x = 0; x < hW; x++) {
      const hIdx = (y * hW + x) * 4;
      const cPx  = HEADER_PX + y * carrierW + x;
      const cIdx = cPx * 4;
      if (cIdx + 3 >= carrierData.length) continue;

      for (let ch = 0; ch < 3; ch++) {
        hData[hIdx + ch] = Math.min(255, (carrierData[cIdx + ch] & mask) * scale);
      }
      hData[hIdx + 3] = 255; // fully opaque
    }
  }

  return { imageData: new ImageData(hData, hW, hH), width: hW, height: hH, bpc };
}

/**
 * Encode a message into image pixel data.
 * @param {Uint8ClampedArray} pixelData - RGBA pixel data (modified in place)
 * @param {Uint8Array} messageBytes - bytes to hide
 * @param {Object} opts
 *   channels: array of channel indices to use (0=R,1=G,2=B,3=A)
 *   bitsPerChannel: 1–4
 * @returns {number} total bits used
 */
export function encode(pixelData, messageBytes, opts = {}) {
  const channels = opts.channels || [0]; // default: Red only
  const bpc = Math.min(4, Math.max(1, opts.bitsPerChannel || 1));
  const mask = (1 << bpc) - 1;

  // Build payload: MAGIC(2) + VERSION(1) + length(4) + message
  const payloadLen = messageBytes.length;
  const header = new Uint8Array(7);
  header[0] = MAGIC[0];
  header[1] = MAGIC[1];
  header[2] = VERSION;
  header[3] = (payloadLen >>> 24) & 0xff;
  header[4] = (payloadLen >>> 16) & 0xff;
  header[5] = (payloadLen >>> 8) & 0xff;
  header[6] = payloadLen & 0xff;

  const payload = new Uint8Array(header.length + messageBytes.length);
  payload.set(header, 0);
  payload.set(messageBytes, header.length);

  // Convert payload to bit stream
  const bits = [];
  for (let i = 0; i < payload.length; i++) {
    for (let b = 7; b >= 0; b--) {
      bits.push((payload[i] >> b) & 1);
    }
  }

  // Pack bpc bits at a time into channel slots
  let bitIndex = 0;
  const numPixels = pixelData.length / 4;

  for (let px = 0; px < numPixels && bitIndex < bits.length; px++) {
    for (let ch of channels) {
      if (bitIndex >= bits.length) break;
      let chunkBits = bits.slice(bitIndex, bitIndex + bpc);
      while (chunkBits.length < bpc) chunkBits.push(0);
      const chunk = chunkBits.reduce((acc, b) => (acc << 1) | b, 0);
      const byteIndex = px * 4 + ch;
      pixelData[byteIndex] = (pixelData[byteIndex] & ~mask) | (chunk & mask);
      bitIndex += bpc;
    }
  }

  return bitIndex;
}

/**
 * Decode a message from image pixel data.
 * @param {Uint8ClampedArray} pixelData
 * @param {Object} opts
 *   channels: array of channel indices
 *   bitsPerChannel: 1–4
 * @returns {Uint8Array|null} decoded message bytes, or null if no valid header
 */
export function decode(pixelData, opts = {}) {
  const channels = opts.channels || [0];
  const bpc = Math.min(4, Math.max(1, opts.bitsPerChannel || 1));
  const mask = (1 << bpc) - 1;

  const numPixels = pixelData.length / 4;
  const bits = [];

  for (let px = 0; px < numPixels; px++) {
    for (let ch of channels) {
      const byteIndex = px * 4 + ch;
      const val = pixelData[byteIndex] & mask;
      for (let b = bpc - 1; b >= 0; b--) {
        bits.push((val >> b) & 1);
      }
    }
  }

  // Read bytes from bit stream
  function readByte(bitOffset) {
    let byte = 0;
    for (let i = 0; i < 8; i++) {
      byte = (byte << 1) | (bits[bitOffset + i] || 0);
    }
    return byte;
  }

  // Validate magic header
  if (readByte(0) !== MAGIC[0] || readByte(8) !== MAGIC[1]) {
    return null;
  }
  // Check version
  // const version = readByte(16); // reserved for future use

  // Read length (4 bytes big-endian)
  const len =
    (readByte(24) << 24) |
    (readByte(32) << 16) |
    (readByte(40) << 8) |
    readByte(48);

  if (len <= 0 || len > 10_000_000) return null; // sanity check

  const headerBits = 7 * 8; // 7 header bytes
  const result = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = readByte(headerBits + i * 8);
  }
  return result;
}

/**
 * Calculate max message bytes for an image with given settings.
 */
export function capacity(pixelCount, channels, bitsPerChannel) {
  const totalBits = pixelCount * channels.length * bitsPerChannel;
  const headerBits = 7 * 8;
  const usableBits = totalBits - headerBits;
  return Math.max(0, Math.floor(usableBits / 8));
}

/**
 * Auto-detect which channel+bitdepth combos have a valid header.
 * Returns array of {channels, bitsPerChannel} matches.
 * Scans all non-empty subsets of [R,G,B,A] × bpc 1–4 = 60 combinations.
 */
export function autoDetect(pixelData) {
  const results = [];

  // Generate all non-empty subsets of channels [0,1,2,3]
  const channelCombos = [];
  for (let mask = 1; mask < 16; mask++) {
    const combo = [];
    for (let bit = 0; bit < 4; bit++) {
      if (mask & (1 << bit)) combo.push(bit);
    }
    channelCombos.push(combo);
  }

  for (const channels of channelCombos) {
    for (let bpc = 1; bpc <= 4; bpc++) {
      const msg = decode(pixelData, { channels, bitsPerChannel: bpc });
      if (msg !== null) {
        results.push({ channels, bitsPerChannel: bpc, byteLength: msg.length });
      }
    }
  }
  return results;
}
