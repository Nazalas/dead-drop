/**
 * dead-drop — steganography engine
 * LSB encoding/decoding across R, G, B, Alpha channels
 */

const MAGIC = [0xDE, 0xAD]; // 2-byte header signature
const VERSION = 0x01;

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
 */
export function autoDetect(pixelData) {
  const results = [];
  const channelCombos = [
    [0], [1], [2], [3],
    [0, 1, 2], [0, 1, 2, 3],
  ];
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
