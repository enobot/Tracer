import path from 'node:path';

// Packaged builds serve the Tracer window from tracer://app instead of
// file://. Pages loaded from file:// need the GrantFileProtocolExtraPrivileges
// fuse to load their own scripts and styles; a custom protocol lets that fuse
// stay off, as Electron's security guide recommends.
export const APP_SCHEME = 'tracer';
export const APP_HOST = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

// Maps a tracer://app request to a file inside rootDir. Returns null for any
// other scheme or host, an unreadable path, or a path that leaves rootDir.
export function resolveAppFile(requestUrl, rootDir) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;

  let relative;
  try {
    relative = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (relative.includes('\0')) return null;

  const root = path.resolve(rootDir);
  const file = path.resolve(root, `.${path.posix.sep}${relative}`);
  if (!file.startsWith(root + path.sep)) return null;
  return file;
}
