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
 * Header: 8 pixels, Red channel only, full byte overwrite
 *   px 0: magic 0x5D
 *   px 1: magic 0xD5
 *   px 2-3: hidden width (big-endian)
 *   px 4-5: hidden height (big-endian)
 *   px 6: bitsPerChannel
 *   px 7: channel bitmask (bit 0=R, bit 1=G, bit 2=B, bit 3=A)
 *
 * Then hidden pixel[x,y] → carrier pixel[x,y+HEADER_PX] for each selected channel
 * Hidden image must be ≤ carrier dimensions.
 *
 * @param {Uint8ClampedArray} carrierData - modified in place
 * @param {number} carrierW, carrierH
 * @param {ImageData} hiddenImageData
 * @param {number} bpc - bits per channel (1–4)
 * @param {number[]} channels - which carrier channels to use (0=R,1=G,2=B,3=A)
 *   RGB → full color. 1 channel → grayscale (luminance). 2 channels → partial color.
 */
export function encodeSpatial(carrierData, carrierW, carrierH, hiddenImageData, bpc = 2, channels = [0, 1, 2]) {
  const { width: hW, height: hH, data: hData } = hiddenImageData;
  if (hW > carrierW || hH > carrierH) throw new Error(`Hidden image (${hW}×${hH}) exceeds carrier (${carrierW}×${carrierH})`);

  const mask = (1 << bpc) - 1;
  const shift = 8 - bpc;

  // Build channel bitmask for header
  const chMask = channels.reduce((m, ch) => m | (1 << ch), 0);

  // Write 8-pixel header into Red channel, full byte overwrite
  const HEADER_PX = 8;
  carrierData[0 * 4 + 0] = 0x5D;
  carrierData[1 * 4 + 0] = 0xD5;
  carrierData[2 * 4 + 0] = (hW >> 8) & 0xff;
  carrierData[3 * 4 + 0] = hW & 0xff;
  carrierData[4 * 4 + 0] = (hH >> 8) & 0xff;
  carrierData[5 * 4 + 0] = hH & 0xff;
  carrierData[6 * 4 + 0] = bpc;
  carrierData[7 * 4 + 0] = chMask;

  // Compute luminance for single/partial channel encoding
  // When < 3 color channels selected, encode luminance into each selected channel
  const isFullColor = channels.includes(0) && channels.includes(1) && channels.includes(2);

  for (let y = 0; y < hH; y++) {
    for (let x = 0; x < hW; x++) {
      const hIdx = (y * hW + x) * 4;
      const cPx  = HEADER_PX + y * carrierW + x;
      const cIdx = cPx * 4;
      if (cIdx + 3 >= carrierData.length) continue;

      for (const ch of channels) {
        let srcVal;
        if (isFullColor) {
          // Map hidden channel directly to same carrier channel
          srcVal = hData[hIdx + Math.min(ch, 2)]; // clamp A→B for safety
        } else {
          // Single/partial: encode luminance into each selected channel
          const luma = Math.round(0.299 * hData[hIdx] + 0.587 * hData[hIdx + 1] + 0.114 * hData[hIdx + 2]);
          srcVal = luma;
        }
        const topBits = (srcVal >> shift) & mask;
        carrierData[cIdx + ch] = (carrierData[cIdx + ch] & ~mask) | topBits;
      }
    }
  }
}

/**
 * SPATIAL image-in-image decode.
 * Returns {imageData, width, height, bpc, channels} or null if no spatial header found.
 */
export function decodeSpatial(carrierData, carrierW, carrierH) {
  if (carrierData[0] !== 0x5D || carrierData[4] !== 0xD5) return null;

  const hW    = (carrierData[8]  << 8) | carrierData[12];
  const hH    = (carrierData[16] << 8) | carrierData[20];
  const bpc   = carrierData[24];
  const chMask = carrierData[28] || 0b0111; // default RGB for old files

  if (hW <= 0 || hH <= 0 || hW > carrierW || hH > carrierH) return null;
  if (bpc < 1 || bpc > 4) return null;

  const channels = [0, 1, 2, 3].filter(b => chMask & (1 << b));
  const isFullColor = channels.includes(0) && channels.includes(1) && channels.includes(2);
  const mask  = (1 << bpc) - 1;
  const scale = Math.round(255 / mask);
  const HEADER_PX = 8;

  const hData = new Uint8ClampedArray(hW * hH * 4);

  for (let y = 0; y < hH; y++) {
    for (let x = 0; x < hW; x++) {
      const hIdx = (y * hW + x) * 4;
      const cPx  = HEADER_PX + y * carrierW + x;
      const cIdx = cPx * 4;
      if (cIdx + 3 >= carrierData.length) continue;

      if (isFullColor) {
        // Reconstruct each color channel from its corresponding carrier channel
        for (const ch of channels) {
          if (ch < 3) hData[hIdx + ch] = Math.min(255, (carrierData[cIdx + ch] & mask) * scale);
        }
        // Fill any missing color channels with 0 (partial color = tinted result)
        for (let ch = 0; ch < 3; ch++) {
          if (!channels.includes(ch)) hData[hIdx + ch] = 0;
        }
      } else {
        // Grayscale: read luminance from first selected channel, apply to R+G+B
        const srcCh = channels[0];
        const luma = Math.min(255, (carrierData[cIdx + srcCh] & mask) * scale);
        hData[hIdx + 0] = luma;
        hData[hIdx + 1] = luma;
        hData[hIdx + 2] = luma;
      }
      hData[hIdx + 3] = 255;
    }
  }

  return { imageData: new ImageData(hData, hW, hH), width: hW, height: hH, bpc, channels };
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
