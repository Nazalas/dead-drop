/**
 * dead-drop — main application
 */

import { encode, decode, capacity, autoDetect, imageDataToBytes, bytesToImageData, encodeSpatial, decodeSpatial } from './steganography.js';
import { encrypt, decrypt } from './crypto.js';
import { renderChannelView, renderLSBHeatmap, loadImageDataFromFile, loadImageData, CHANNEL_NAMES } from './visualizer.js';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  encode: { imageData: null, canvas: null, originalData: null },
  decode: { imageData: null },
  viz:    { imageData: null, originalData: null },
};

// ─── Tab switching (with URL hash persistence) ───────────────────────────────
function activateTab(target) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`.tab-btn[data-tab="${target}"]`);
  const pane = document.getElementById(`tab-${target}`);
  if (btn) btn.classList.add('active');
  if (pane) pane.classList.add('active');
  history.replaceState(null, '', `#${target}`);
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// Restore tab from URL hash on load
const hashTab = location.hash.replace('#', '');
if (hashTab && document.querySelector(`.tab-btn[data-tab="${hashTab}"]`)) {
  activateTab(hashTab);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getChannels(prefix) {
  const checked = [];
  ['r', 'g', 'b', 'a'].forEach((ch, i) => {
    const el = document.getElementById(`${prefix}-ch-${ch}`);
    if (el && el.checked) checked.push(i);
  });
  return checked.length ? checked : [0];
}

function getBPC(prefix) {
  return parseInt(document.getElementById(`${prefix}-bpc`)?.value || '1', 10);
}

function showStatus(id, msg, type = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `status status-${type}`;
  el.style.display = 'block';
}

function hideStatus(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ─── Drag & Drop / File loaders ───────────────────────────────────────────────
function setupDropzone(dropzoneId, inputId, onLoad) {
  const zone = document.getElementById(dropzoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files[0]) handleFile(input.files[0]);
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  async function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      showStatus(`${dropzoneId}-status`, 'Please upload an image file.', 'error');
      return;
    }
    try {
      const result = await loadImageDataFromFile(file);
      zone.classList.add('has-image');
      onLoad(result);
    } catch (e) {
      showStatus(`${dropzoneId}-status`, 'Failed to load image.', 'error');
    }
  }
}

// ─── ENCODE TAB ───────────────────────────────────────────────────────────────
setupDropzone('encode-drop', 'encode-file-input', ({ imageData, width, height, canvas }) => {
  state.encode.imageData = imageData;
  state.encode.originalData = new ImageData(
    new Uint8ClampedArray(imageData.data),
    width, height
  );
  state.encode.canvas = canvas;

  // Show preview
  const preview = document.getElementById('encode-preview');
  preview.width = width;
  preview.height = height;
  const ctx = preview.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  preview.style.display = 'block';
  document.getElementById('encode-preview-wrap').style.display = 'block';

  updateCapacity();
  hideStatus('encode-status');
});

function updateCapacity() {
  const el = document.getElementById('encode-capacity');
  if (!el || !state.encode.imageData) return;
  const px = state.encode.imageData.width * state.encode.imageData.height;
  const channels = getChannels('encode');
  const bpc = getBPC('encode');
  const cap = capacity(px, channels, bpc);
  el.textContent = `Capacity: ${cap.toLocaleString()} bytes (${(cap / 1024).toFixed(1)} KB)`;
}

['encode-ch-r','encode-ch-g','encode-ch-b','encode-ch-a'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', updateCapacity);
});
document.getElementById('encode-bpc')?.addEventListener('input', () => {
  const bpc = getBPC('encode');
  document.getElementById('encode-bpc-label').textContent = `${bpc} bit${bpc > 1 ? 's' : ''}`;
  updateCapacity();
});

// ─── Payload type toggle ──────────────────────────────────────────────────────
document.querySelectorAll('input[name="encode-type"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const isImage = document.getElementById('encode-type-image').checked;
    document.getElementById('encode-text-fields').style.display = isImage ? 'none' : 'block';
    document.getElementById('encode-image-fields').style.display = isImage ? 'block' : 'none';
  });
});

// ─── Hidden image dropzone ────────────────────────────────────────────────────
setupDropzone('encode-hidden-drop', 'encode-hidden-file-input', ({ imageData, width, height }) => {
  state.encode.hiddenImageData = imageData;

  const preview = document.getElementById('encode-hidden-preview');
  preview.width = width;
  preview.height = height;
  preview.getContext('2d').putImageData(imageData, 0, 0);
  document.getElementById('encode-hidden-preview-wrap').style.display = 'block';
  document.getElementById('encode-hidden-drop').classList.add('has-image');

  // Show byte size needed
  const bytesNeeded = 4 + width * height * 4; // header + RGBA pixels
  const capEl = document.getElementById('encode-hidden-capacity');
  if (capEl) capEl.textContent = `Hidden image: ${width}×${height} = ${bytesNeeded.toLocaleString()} bytes needed`;
  updateCapacity();
});

document.getElementById('encode-btn')?.addEventListener('click', async () => {
  if (!state.encode.imageData) {
    showStatus('encode-status', 'Upload a carrier image first.', 'error');
    return;
  }

  const isImageMode = document.getElementById('encode-type-image')?.checked;
  const passphrase = document.getElementById('encode-passphrase').value;
  const channels = getChannels('encode');
  const bpc = getBPC('encode');

  // Work on a fresh copy of the original
  const workingData = new ImageData(
    new Uint8ClampedArray(state.encode.originalData.data),
    state.encode.originalData.width,
    state.encode.originalData.height
  );

  if (isImageMode) {
    // ── Spatial image-in-image ──────────────────────────────────────────────
    if (!state.encode.hiddenImageData) {
      showStatus('encode-status', 'Upload an image to hide.', 'error');
      return;
    }
    const { width: hW, height: hH } = state.encode.hiddenImageData;
    const cW = workingData.width, cH = workingData.height;
    if (hW > cW || hH > cH) {
      showStatus('encode-status', `Hidden image (${hW}×${hH}) is larger than the carrier (${cW}×${cH}). Use a larger carrier or smaller hidden image.`, 'error');
      return;
    }
    try {
      encodeSpatial(workingData.data, cW, cH, state.encode.hiddenImageData, bpc);
      const preview = document.getElementById('encode-preview');
      preview.getContext('2d').putImageData(workingData, 0, 0);
      state.encode.encodedData = workingData;
      document.getElementById('encode-download').style.display = 'inline-flex';
      showStatus('encode-status',
        `✓ Image hidden spatially (${hW}×${hH} inside ${cW}×${cH} at ${bpc} bpp). Try the Visualize tab — you can see the ghost.`,
        'success');
    } catch (e) {
      showStatus('encode-status', `Encoding failed: ${e.message}`, 'error');
    }
    return;
  }

  // ── Text message ────────────────────────────────────────────────────────────
  const message = document.getElementById('encode-message').value.trim();
  if (!message) {
    showStatus('encode-status', 'Enter a message to hide.', 'error');
    return;
  }
  const enc = new TextEncoder();
  let msgBytes = enc.encode(message); // declared here, only used in text branch

  if (passphrase) {
    showStatus('encode-status', 'Encrypting…', 'info');
    msgBytes = await encrypt(msgBytes, passphrase);
  }

  const px = workingData.width * workingData.height;
  const cap = capacity(px, channels, bpc);

  if (msgBytes.length > cap) {
    showStatus('encode-status', `Message too large: ${msgBytes.length} bytes vs ${cap} byte capacity. Increase bit depth or use more channels.`, 'error');
    return;
  }

  try {
    encode(workingData.data, msgBytes, { channels, bitsPerChannel: bpc });
    const preview = document.getElementById('encode-preview');
    preview.getContext('2d').putImageData(workingData, 0, 0);
    state.encode.encodedData = workingData;
    document.getElementById('encode-download').style.display = 'inline-flex';
    showStatus('encode-status', `✓ Message hidden (${msgBytes.length} bytes across ${channels.length} channel${channels.length > 1 ? 's' : ''} at ${bpc} bpp). Image looks identical.`, 'success');
  } catch (e) {
    showStatus('encode-status', `Encoding failed: ${e.message}`, 'error');
  }
});

document.getElementById('encode-download')?.addEventListener('click', () => {
  if (!state.encode.encodedData) return;
  const canvas = document.createElement('canvas');
  canvas.width = state.encode.encodedData.width;
  canvas.height = state.encode.encodedData.height;
  canvas.getContext('2d').putImageData(state.encode.encodedData, 0, 0);
  const a = document.createElement('a');
  a.download = 'dead-drop.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
});

// ─── DECODE TAB ───────────────────────────────────────────────────────────────
function renderDecodedImage(imageData, width, height, statusMsg) {
  const resultEl = document.getElementById('decode-result');
  const outputEl = document.getElementById('decode-output');
  outputEl.style.display = 'none';
  document.getElementById('decode-copy').style.display = 'none';

  let wrap = document.getElementById('decode-image-output');
  let canvas;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'decode-image-output';
    wrap.style.cssText = 'margin-bottom:0.75rem;';
    const lbl = document.createElement('p');
    lbl.id = 'decode-image-label';
    lbl.className = 'muted';
    lbl.style.cssText = 'font-size:0.78rem;margin-bottom:0.5rem;';
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'max-width:100%;border-radius:6px;display:block;';
    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    btnRow.style.marginTop = '0.75rem';
    const dlBtn = document.createElement('button');
    dlBtn.id = 'decode-image-dl';
    dlBtn.className = 'btn btn-ghost';
    dlBtn.textContent = '⬇ Save hidden image';
    btnRow.appendChild(dlBtn);
    wrap.appendChild(lbl);
    wrap.appendChild(canvas);
    wrap.appendChild(btnRow);
    resultEl.insertBefore(wrap, outputEl);
  } else {
    canvas = wrap.querySelector('canvas');
    wrap.style.display = 'block';
  }

  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  document.getElementById('decode-image-label').textContent = `Hidden image: ${width}×${height}`;

  const dlBtn = document.getElementById('decode-image-dl');
  dlBtn.onclick = () => {
    const a = document.createElement('a');
    a.download = 'hidden-image.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  resultEl.style.display = 'block';
  showStatus('decode-status', statusMsg, 'success');
}

setupDropzone('decode-drop', 'decode-file-input', ({ imageData, width, height }) => {
  state.decode.imageData = imageData;
  state.decode.width = width;
  state.decode.height = height;
  hideStatus('decode-status');
  document.getElementById('decode-result').style.display = 'none';
  document.getElementById('decode-autodetect-result').style.display = 'none';

  const preview = document.getElementById('decode-preview');
  preview.width = width;
  preview.height = height;
  preview.getContext('2d').putImageData(imageData, 0, 0);
  document.getElementById('decode-preview-wrap').style.display = 'block';
});

document.getElementById('decode-btn')?.addEventListener('click', async () => {
  if (!state.decode.imageData) {
    showStatus('decode-status', 'Upload an image first.', 'error');
    return;
  }

  const { imageData, width: imgW, height: imgH } = state.decode;
  const channels = getChannels('decode');
  const bpc = getBPC('decode');
  const passphrase = document.getElementById('decode-passphrase').value;

  // Try spatial image-in-image first
  const spatial = decodeSpatial(imageData.data, imgW || Math.sqrt(imageData.data.length / 4), imgH || Math.sqrt(imageData.data.length / 4));
  if (spatial) {
    renderDecodedImage(spatial.imageData, spatial.width, spatial.height,
      `✓ Hidden image revealed spatially: ${spatial.width}×${spatial.height} at ${spatial.bpc} bpp.`);
    return;
  }

  const raw = decode(imageData.data, { channels, bitsPerChannel: bpc });

  if (!raw) {
    showStatus('decode-status', 'No hidden message found with these settings. Try auto-detect or adjust channels/bit depth.', 'error');
    return;
  }

  let msgBytes = raw;
  if (passphrase) {
    try {
      msgBytes = await decrypt(raw, passphrase);
    } catch {
      showStatus('decode-status', 'Wrong passphrase or message was not encrypted.', 'error');
      return;
    }
  }

  // Try to decode as a serialized image payload
  const hiddenImg = bytesToImageData(msgBytes);

  if (hiddenImg) {
    renderDecodedImage(hiddenImg.imageData, hiddenImg.width, hiddenImg.height,
      `✓ Hidden image revealed: ${hiddenImg.width}×${hiddenImg.height} (${raw.length} bytes).`);
  } else {
    // Text payload
    if (imgOutputEl) imgOutputEl.style.display = 'none';
    outputEl.style.display = 'block';
    document.getElementById('decode-copy').style.display = 'inline-flex';

    const dec = new TextDecoder();
    let text;
    try {
      text = dec.decode(msgBytes);
      // Check if it's actually readable text
      if (/[\x00-\x08\x0E-\x1F\x7F]/.test(text)) {
        text = `[binary data — may be encrypted. Enter passphrase and decode again. ${msgBytes.length} bytes]`;
      }
    } catch {
      text = `[binary data: ${msgBytes.length} bytes]`;
    }
    outputEl.textContent = text;
    resultEl.style.display = 'block';
    showStatus('decode-status', `✓ Decoded ${raw.length} bytes.`, 'success');
  }
});

document.getElementById('decode-autodetect-btn')?.addEventListener('click', async () => {
  if (!state.decode.imageData) {
    showStatus('decode-status', 'Upload an image first.', 'error');
    return;
  }

  showStatus('decode-status', 'Scanning all channel combinations…', 'info');
  const results = autoDetect(state.decode.imageData.data);

  const container = document.getElementById('decode-autodetect-result');
  container.innerHTML = '';

  if (!results.length) {
    container.innerHTML = '<p class="muted">No hidden data found in any channel combination.</p>';
  } else {
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.style.cssText = 'font-size:0.8rem;margin-bottom:0.6rem';
    hint.textContent = `Found ${results.length} match${results.length > 1 ? 'es' : ''}. Click a result to decode it.`;
    container.appendChild(hint);
    results.forEach(r => {
      const chNames = r.channels.map(i => CHANNEL_NAMES[i]).join('+');
      const div = document.createElement('div');
      div.className = 'detect-hit';
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');
      div.setAttribute('title', 'Click to decode with these settings');
      div.innerHTML = `
        <div class="detect-hit-info">
          <strong>${chNames}</strong> @ ${r.bitsPerChannel} bpp &mdash; ${r.byteLength} bytes hidden
        </div>
        <div class="detect-hit-action">Decode &rarr;</div>
      `;
      div.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') div.click(); });
      div.addEventListener('click', () => {
        // Highlight active result, keep list visible
        container.querySelectorAll('.detect-hit').forEach(el => el.classList.remove('active'));
        div.classList.add('active');

        ['decode-ch-r','decode-ch-g','decode-ch-b','decode-ch-a'].forEach((id, i) => {
          const el = document.getElementById(id);
          if (el) el.checked = r.channels.includes(i);
        });
        const bpcEl = document.getElementById('decode-bpc');
        if (bpcEl) {
          bpcEl.value = r.bitsPerChannel;
          document.getElementById('decode-bpc-label').textContent = `${r.bitsPerChannel} bit${r.bitsPerChannel > 1 ? 's' : ''}`;
        }
        document.getElementById('decode-btn').click();
      });
      container.appendChild(div);
    });
  }
  container.style.display = 'block';
  hideStatus('decode-status');
});

document.getElementById('decode-bpc')?.addEventListener('input', () => {
  const bpc = getBPC('decode');
  document.getElementById('decode-bpc-label').textContent = `${bpc} bit${bpc > 1 ? 's' : ''}`;
});

// ─── VISUALIZER TAB ───────────────────────────────────────────────────────────
setupDropzone('viz-drop', 'viz-file-input', ({ imageData, width, height }) => {
  state.viz.imageData = imageData;
  state.viz.originalData = null; // reset diff ref

  const preview = document.getElementById('viz-preview');
  preview.width = width;
  preview.height = height;
  preview.getContext('2d').putImageData(imageData, 0, 0);
  document.getElementById('viz-preview-wrap').style.display = 'block';

  document.getElementById('viz-controls').style.display = 'block';
  renderViz();
});

function renderViz() {
  if (!state.viz.imageData) return;

  const mode = document.getElementById('viz-mode')?.value || 'lsb';
  const bpc = parseInt(document.getElementById('viz-bpc')?.value || '1', 10);
  const grid = document.getElementById('viz-grid');
  grid.innerHTML = '';

  const channels = mode === 'heatmap' ? [0, 1, 2] : [0, 1, 2, 3];

  if (mode === 'heatmap') {
    const wrap = document.createElement('div');
    wrap.className = 'viz-cell';
    const label = document.createElement('div');
    label.className = 'viz-label';
    label.textContent = 'LSB Heatmap (all channels)';
    const canvas = document.createElement('canvas');
    renderLSBHeatmap(state.viz.imageData, canvas, [0, 1, 2], bpc);
    wrap.appendChild(label);
    wrap.appendChild(canvas);
    grid.appendChild(wrap);
    return;
  }

  channels.forEach(ch => {
    const wrap = document.createElement('div');
    wrap.className = 'viz-cell';
    const label = document.createElement('div');
    label.className = 'viz-label';
    label.textContent = CHANNEL_NAMES[ch];
    const canvas = document.createElement('canvas');
    renderChannelView(state.viz.imageData, canvas, ch, mode, bpc, state.viz.originalData);
    wrap.appendChild(label);
    wrap.appendChild(canvas);
    grid.appendChild(wrap);
  });
}

document.getElementById('viz-mode')?.addEventListener('change', renderViz);
document.getElementById('viz-bpc')?.addEventListener('input', () => {
  const bpc = parseInt(document.getElementById('viz-bpc').value, 10);
  document.getElementById('viz-bpc-label').textContent = `${bpc} bit${bpc > 1 ? 's' : ''}`;
  renderViz();
});

// ─── Demo samples ─────────────────────────────────────────────────────────────
document.querySelectorAll('.demo-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const src = btn.dataset.src;
    const tab = btn.dataset.tab || 'decode';
    if (!src) return;

    // Switch to target tab first
    activateTab(tab);

    try {
      const { imageData, width, height } = await loadImageData(src);

      if (tab === 'decode') {
        state.decode.imageData = imageData;
        state.decode.width = width;
        state.decode.height = height;

        const preview = document.getElementById('decode-preview');
        preview.width = width;
        preview.height = height;
        preview.getContext('2d').putImageData(imageData, 0, 0);
        document.getElementById('decode-preview-wrap').style.display = 'block';
        document.getElementById('decode-drop').classList.add('has-image');

        showStatus('decode-status', '✓ Demo image loaded — hit Decode to reveal the message.', 'success');
      } else if (tab === 'visualize') {
        state.viz.imageData = imageData;

        const preview = document.getElementById('viz-preview');
        preview.width = width;
        preview.height = height;
        preview.getContext('2d').putImageData(imageData, 0, 0);
        document.getElementById('viz-preview-wrap').style.display = 'block';
        document.getElementById('viz-drop').classList.add('has-image');

        document.getElementById('viz-controls').style.display = 'block';
        renderViz();
      }
    } catch (e) {
      console.error('Failed to load demo image:', e);
      const statusId = tab === 'decode' ? 'decode-status' : 'decode-status';
      showStatus(statusId, `Failed to load demo image: ${e.message}`, 'error');
    }
  });
});

// ─── Copy to clipboard ────────────────────────────────────────────────────────
document.getElementById('decode-copy')?.addEventListener('click', () => {
  const text = document.getElementById('decode-output').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('decode-copy');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
});
