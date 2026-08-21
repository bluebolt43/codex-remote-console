function decode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function encode(value) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function common(credential) {
  return { id: credential.id, rawId: encode(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults() };
}

export async function createPasskey(options) {
  const publicKey = {
    ...options,
    challenge: decode(options.challenge),
    user: { ...options.user, id: decode(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((item) => ({ ...item, id: decode(item.id) })),
  };
  const credential = await navigator.credentials.create({ publicKey });
  return {
    ...common(credential),
    response: {
      clientDataJSON: encode(credential.response.clientDataJSON),
      attestationObject: encode(credential.response.attestationObject),
      transports: credential.response.getTransports?.() || [],
      publicKeyAlgorithm: credential.response.getPublicKeyAlgorithm?.(),
      publicKey: credential.response.getPublicKey?.() ? encode(credential.response.getPublicKey()) : undefined,
      authenticatorData: credential.response.getAuthenticatorData?.() ? encode(credential.response.getAuthenticatorData()) : undefined,
    },
    authenticatorAttachment: credential.authenticatorAttachment,
  };
}

export async function getPasskey(options) {
  const publicKey = {
    ...options,
    challenge: decode(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((item) => ({ ...item, id: decode(item.id) })),
  };
  const credential = await navigator.credentials.get({ publicKey });
  return {
    ...common(credential),
    response: {
      clientDataJSON: encode(credential.response.clientDataJSON),
      authenticatorData: encode(credential.response.authenticatorData),
      signature: encode(credential.response.signature),
      userHandle: credential.response.userHandle ? encode(credential.response.userHandle) : undefined,
    },
    authenticatorAttachment: credential.authenticatorAttachment,
  };
}
