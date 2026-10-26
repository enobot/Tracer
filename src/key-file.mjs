export function sealSecret(plain, encrypt) {
  if (typeof encrypt !== 'function') {
    return {
      ok: false,
      error: 'Secure storage is unavailable on this computer.',
    };
  }
  const sealed = encrypt(plain);
  if (!sealed) {
    return {
      ok: false,
      error: 'Secure storage is unavailable on this computer.',
    };
  }
  return { ok: true, sealed };
}

export function openSecret(sealed, decrypt) {
  if (!sealed || typeof decrypt !== 'function') return null;
  try {
    const plain = decrypt(sealed);
    return typeof plain === 'string' && plain ? plain : null;
  } catch {
    return null;
  }
}
