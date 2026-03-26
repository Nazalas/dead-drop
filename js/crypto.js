/**
 * dead-drop — AES-256-GCM passphrase encryption
 * Uses Web Crypto API — zero dependencies
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/**
 * Derive an AES-GCM key from a passphrase.
 */
async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext bytes with a passphrase.
 * Returns: [salt(16) + iv(12) + ciphertext]
 */
export async function encrypt(plaintextBytes, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintextBytes
  );

  const result = new Uint8Array(SALT_BYTES + IV_BYTES + ciphertext.byteLength);
  result.set(salt, 0);
  result.set(iv, SALT_BYTES);
  result.set(new Uint8Array(ciphertext), SALT_BYTES + IV_BYTES);
  return result;
}

/**
 * Decrypt bytes (produced by encrypt) with a passphrase.
 * Returns plaintext bytes, or throws on wrong passphrase/corrupt data.
 */
export async function decrypt(encryptedBytes, passphrase) {
  const salt = encryptedBytes.slice(0, SALT_BYTES);
  const iv = encryptedBytes.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ciphertext = encryptedBytes.slice(SALT_BYTES + IV_BYTES);

  const key = await deriveKey(passphrase, salt);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new Uint8Array(plaintext);
}
