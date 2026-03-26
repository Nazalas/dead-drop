/**
 * dead-drop — channel visualizer
 * Extracts and amplifies LSB channels for visual inspection
 */

const CHANNEL_NAMES = ['Red', 'Green', 'Blue', 'Alpha'];

/**
 * Render isolated channel data to a canvas.
 * Mode: 'raw' = show channel as grayscale
 *       'lsb' = extract N least significant bits, amplify to full range
 *       'diff' = pixel-wise absolute difference between two ImageData objects
 */
export function renderChannelView(srcImageData, destCanvas, channelIndex, mode = 'raw', bitsPerChannel = 1, referenceImageData = null) {
  const { width, height, data } = srcImageData;
  destCanvas.width = width;
  destCanvas.height = height;
  const ctx = destCanvas.getContext('2d');
  const out = ctx.createImageData(width, height);
  const mask = (1 << bitsPerChannel) - 1;
  const amplify = 255 / mask;

  for (let px = 0; px < width * height; px++) {
    const i = px * 4;
    let val;

    if (mode === 'diff' && referenceImageData) {
      // Absolute diff on this channel
      val = Math.abs(srcImageData.data[i + channelIndex] - referenceImageData.data[i + channelIndex]);
      val = Math.min(255, val * 20); // amplify for visibility
    } else if (mode === 'lsb') {
      val = Math.round((srcImageData.data[i + channelIndex] & mask) * amplify);
    } else {
      // raw grayscale of channel
      val = srcImageData.data[i + channelIndex];
    }

    if (channelIndex === 3) {
      // Alpha channel: show as grayscale against white
      out.data[i + 0] = val;
      out.data[i + 1] = val;
      out.data[i + 2] = val;
      out.data[i + 3] = 255;
    } else {
      out.data[i + 0] = channelIndex === 0 ? val : 0;
      out.data[i + 1] = channelIndex === 1 ? val : 0;
      out.data[i + 2] = channelIndex === 2 ? val : 0;
      out.data[i + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
}

/**
 * Render combined LSB heatmap — all selected channels merged as white dots on black.
 */
export function renderLSBHeatmap(srcImageData, destCanvas, channels = [0, 1, 2], bitsPerChannel = 1) {
  const { width, height, data } = srcImageData;
  destCanvas.width = width;
  destCanvas.height = height;
  const ctx = destCanvas.getContext('2d');
  const out = ctx.createImageData(width, height);
  const mask = (1 << bitsPerChannel) - 1;
  const amplify = 255 / mask;

  for (let px = 0; px < width * height; px++) {
    const i = px * 4;
    const combined = channels.reduce((sum, ch) => {
      return sum + (data[i + ch] & mask);
    }, 0);
    const brightness = Math.round(Math.min(255, (combined / channels.length) * amplify));
    out.data[i + 0] = brightness;
    out.data[i + 1] = brightness;
    out.data[i + 2] = brightness;
    out.data[i + 3] = 255;
  }

  ctx.putImageData(out, 0, 0);
}

/**
 * Given an image URL, load it into an ImageData.
 * Returns Promise<{imageData, width, height}>
 */
export function loadImageData(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ imageData, width: canvas.width, height: canvas.height, canvas });
    };
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Load ImageData from a File object.
 */
export function loadImageDataFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      loadImageData(e.target.result).then(resolve).catch(reject);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export { CHANNEL_NAMES };
