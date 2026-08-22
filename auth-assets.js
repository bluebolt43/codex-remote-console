export const pairingAssets = new Set(["/pair.html", "/pair.js"]);
export const loginAssets = new Set(["/login.html", "/login.js", "/passkey-client.js", "/i18n.js", "/app.css"]);

export function isPairingAsset(pathname) {
  return pairingAssets.has(pathname);
}

export function isUnauthenticatedAsset(pathname) {
  return loginAssets.has(pathname) || pairingAssets.has(pathname);
}
