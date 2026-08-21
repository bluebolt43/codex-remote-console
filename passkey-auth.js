import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

const pairLifetimeMs = 5 * 60 * 1000;
const challengeLifetimeMs = 5 * 60 * 1000;
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const loginAttemptLifetimeMs = 15 * 60 * 1000;
const maxLoginAttemptsPerClient = 10;
const maxAuthenticationChallenges = 500;
const maxPairCodeFailures = 20;
const maxLoginFailures = 5;
const loginBlockLifetimeMs = 30 * 60 * 1000;
const maxSecurityEvents = 100;
const cookieName = "__Host-codex_remote_session";

export class PasskeyAuth {
  constructor({ dataFile, rpID, origin }) {
    this.dataFile = dataFile;
    this.securityFile = join(dirname(dataFile), "security-events.json");
    this.rpID = rpID;
    this.origin = origin;
    this.devices = [];
    this.loaded = false;
    this.securityLoaded = false;
    this.securityEvents = [];
    this.pairCodes = new Map();
    this.pairAttempts = new Map();
    this.registrationChallenges = new Map();
    this.authenticationChallenges = new Map();
    this.loginAttempts = new Map();
    this.loginFailures = new Map();
    this.sessions = new Map();
    this.deviceWriteQueue = Promise.resolve();
    this.securityWriteQueue = Promise.resolve();
  }

  get configured() {
    return Boolean(this.rpID && this.origin);
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const data = JSON.parse(await readFile(this.dataFile, "utf8"));
      this.devices = Array.isArray(data.devices) ? data.devices : [];
    } catch {}
  }

  async save() {
    const contents = `${JSON.stringify({ devices: this.devices }, null, 2)}\n`;
    const write = async () => {
      await mkdir(dirname(this.dataFile), { recursive: true, mode: 0o700 });
      const temporary = `${this.dataFile}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, contents, { mode: 0o600 });
      await rename(temporary, this.dataFile);
    };
    const result = this.deviceWriteQueue.then(write, write);
    this.deviceWriteQueue = result.catch(() => {});
    return result;
  }

  async lastLoginAt() {
    await this.load();
    const values = this.devices.map((device) => device.lastUsedAt).filter(Boolean).sort();
    return values.at(-1) || null;
  }

  async loadSecurityEvents() {
    if (this.securityLoaded) return;
    this.securityLoaded = true;
    try {
      const data = JSON.parse(await readFile(this.securityFile, "utf8"));
      this.securityEvents = Array.isArray(data.events) ? data.events.slice(0, maxSecurityEvents) : [];
    } catch {}
  }

  async recordSecurityEvent({ type, success, ip, userAgent, alert = false }) {
    const write = async () => {
      await this.loadSecurityEvents();
      const normalizedIp = String(ip || "unknown").replace(/^::ffff:/, "");
      const normalizedAgent = String(userAgent || "unknown").slice(0, 300);
      this.securityEvents.unshift({
        id: randomUUID(),
        type,
        success,
        alert,
        timestamp: new Date().toISOString(),
        ip: normalizedIp,
        userAgent: normalizedAgent,
      });
      this.securityEvents = this.securityEvents.slice(0, maxSecurityEvents);
      await mkdir(dirname(this.securityFile), { recursive: true, mode: 0o700 });
      const temporary = `${this.securityFile}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify({ events: this.securityEvents }, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.securityFile);
    };
    const result = this.securityWriteQueue.then(write, write);
    this.securityWriteQueue = result.catch(() => {});
    return result;
  }

  async recentSecurityEvents() {
    await this.loadSecurityEvents();
    return this.securityEvents;
  }

  cleanup() {
    const now = Date.now();
    for (const collection of [this.pairCodes, this.pairAttempts, this.registrationChallenges, this.authenticationChallenges, this.loginAttempts, this.loginFailures, this.sessions]) {
      for (const [key, value] of collection) {
        const expiresAt = typeof value === "number" ? value : value.expiresAt;
        if (expiresAt <= now) collection.delete(key);
      }
    }
  }

  createPairCode() {
    this.cleanup();
    this.pairCodes.clear();
    this.pairAttempts.clear();
    this.registrationChallenges.clear();
    const code = `${randomBytes(3).readUIntBE(0, 3) % 1_000_000}`.padStart(6, "0");
    this.pairCodes.set(code, { expiresAt: Date.now() + pairLifetimeMs, attempts: 0, failures: 0 });
    return { code, expiresAt: Date.now() + pairLifetimeMs };
  }

  pairingEnabled() {
    this.cleanup();
    return this.pairCodes.size > 0;
  }

  consumePairCode(code, clientId) {
    this.cleanup();
    const attempt = this.pairAttempts.get(clientId) || { count: 0, expiresAt: Date.now() + 15 * 60 * 1000 };
    attempt.count += 1;
    this.pairAttempts.set(clientId, attempt);
    if (attempt.count > 10) return false;
    const pair = this.pairCodes.get(String(code || ""));
    if (!pair) {
      const activePair = this.pairCodes.values().next().value;
      if (activePair && ++activePair.failures >= maxPairCodeFailures) {
        this.pairCodes.clear();
        this.registrationChallenges.clear();
      }
      return false;
    }
    if (pair.attempts >= 5) return false;
    pair.attempts += 1;
    return true;
  }

  async registrationOptions(code, deviceName, clientId) {
    if (!this.configured) throw new Error("Public Passkey authentication is not configured");
    if (!this.consumePairCode(code, clientId)) throw new Error("Invalid or expired pairing code");
    await this.load();
    const registrationId = randomUUID();
    const options = await generateRegistrationOptions({
      rpName: "Codex Remote Console",
      rpID: this.rpID,
      userName: `device-${registrationId}`,
      userDisplayName: "Codex Remote Console Passkey",
      attestationType: "none",
      excludeCredentials: this.devices.map((device) => ({ id: device.credential.id, transports: device.credential.transports })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    this.registrationChallenges.set(registrationId, {
      challenge: options.challenge,
      code: String(code),
      deviceName: String(deviceName || "Passkey").trim().slice(0, 80) || "Passkey",
      clientId,
      expiresAt: Date.now() + challengeLifetimeMs,
    });
    return { registrationId, options };
  }

  async verifyRegistration(registrationId, response) {
    this.cleanup();
    const pending = this.registrationChallenges.get(registrationId);
    if (!pending || !this.pairCodes.has(pending.code)) throw new Error("Registration expired");
    this.registrationChallenges.delete(registrationId);
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      requireUserVerification: true,
    });
    if (!verification.verified) throw new Error("Passkey verification failed");
    this.pairCodes.delete(pending.code);
    this.pairAttempts.clear();
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const device = {
      id: randomUUID(),
      name: pending.deviceName,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      lastIp: pending.clientId,
      credentialDeviceType,
      credentialBackedUp,
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports || [],
      },
    };
    this.devices.push(device);
    await this.save();
    return device;
  }

  async authenticationOptions(clientId) {
    if (!this.configured) throw new Error("Public Passkey authentication is not configured");
    this.assertLoginAllowed(clientId);
    this.cleanup();
    const key = String(clientId || "unknown");
    const attempt = this.loginAttempts.get(key) || { count: 0, expiresAt: Date.now() + loginAttemptLifetimeMs };
    if (attempt.count >= maxLoginAttemptsPerClient) {
      const error = new Error("Too many login attempts");
      error.statusCode = 429;
      throw error;
    }
    attempt.count += 1;
    this.loginAttempts.set(key, attempt);
    if (this.authenticationChallenges.size >= maxAuthenticationChallenges) {
      this.authenticationChallenges.delete(this.authenticationChallenges.keys().next().value);
    }
    await this.load();
    if (!this.devices.length) throw new Error("No paired devices");
    const authenticationId = randomUUID();
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: "required",
      allowCredentials: this.devices.map((device) => ({ id: device.credential.id, transports: device.credential.transports })),
    });
    this.authenticationChallenges.set(authenticationId, { challenge: options.challenge, expiresAt: Date.now() + challengeLifetimeMs });
    return { authenticationId, options };
  }

  async verifyAuthentication(authenticationId, response, clientId) {
    this.assertLoginAllowed(clientId);
    this.cleanup();
    const pending = this.authenticationChallenges.get(authenticationId);
    if (!pending) throw new Error("Authentication expired");
    this.authenticationChallenges.delete(authenticationId);
    await this.load();
    const device = this.devices.find((value) => value.credential.id === response.id);
    if (!device) throw new Error("Device is not paired");
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      credential: {
        ...device.credential,
        publicKey: Buffer.from(device.credential.publicKey, "base64url"),
      },
      requireUserVerification: true,
    });
    if (!verification.verified) throw new Error("Passkey verification failed");
    const normalizedIp = String(clientId || "unknown").replace(/^::ffff:/, "");
    const previousIp = device.lastIp || null;
    device.credential.counter = verification.authenticationInfo.newCounter;
    device.lastUsedAt = new Date().toISOString();
    device.lastIp = normalizedIp;
    this.loginFailures.delete(normalizedIp);
    await this.save();
    return { device, newAddress: Boolean(previousIp && previousIp !== normalizedIp), previousIp };
  }

  assertLoginAllowed(clientId) {
    this.cleanup();
    const key = String(clientId || "unknown").replace(/^::ffff:/, "");
    const failure = this.loginFailures.get(key);
    if (failure?.blockedUntil > Date.now()) {
      const error = new Error("Login temporarily blocked");
      error.statusCode = 429;
      throw error;
    }
  }

  recordLoginFailure(clientId) {
    this.cleanup();
    const key = String(clientId || "unknown").replace(/^::ffff:/, "");
    const now = Date.now();
    const failure = this.loginFailures.get(key) || { count: 0, blockedUntil: 0, expiresAt: now + loginAttemptLifetimeMs };
    failure.count += 1;
    if (failure.count >= maxLoginFailures) {
      failure.blockedUntil = now + loginBlockLifetimeMs;
      failure.expiresAt = failure.blockedUntil;
    }
    this.loginFailures.set(key, failure);
    return { blocked: failure.blockedUntil > now, blockedUntil: failure.blockedUntil || null };
  }

  createSession(device, { ip, userAgent } = {}) {
    const token = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    this.sessions.set(token, {
      id: randomUUID(),
      deviceId: device.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: Date.now() + sessionLifetimeMs,
      ip: String(ip || "unknown").replace(/^::ffff:/, ""),
      userAgent: String(userAgent || "unknown").slice(0, 300),
    });
    return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${sessionLifetimeMs / 1000}`;
  }

  clearSession(cookieHeader) {
    this.sessions.delete(this.cookieToken(cookieHeader));
    return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
  }

  cookieToken(cookieHeader) {
    for (const part of String(cookieHeader || "").split(";")) {
      const [name, ...value] = part.trim().split("=");
      if (name === cookieName) return value.join("=");
    }
    return "";
  }

  session(cookieHeader) {
    this.cleanup();
    return this.sessions.get(this.cookieToken(cookieHeader)) || null;
  }

  authenticated(cookieHeader) {
    const session = this.session(cookieHeader);
    if (!session) return false;
    session.lastSeenAt = new Date().toISOString();
    return true;
  }

  async listedDevices(cookieHeader) {
    await this.load();
    const current = this.session(cookieHeader);
    return this.devices.map((device) => ({
      id: device.id,
      name: device.name,
      createdAt: device.createdAt,
      lastUsedAt: device.lastUsedAt,
      current: current?.deviceId === device.id,
      sessionCount: [...this.sessions.values()].filter((session) => session.deviceId === device.id).length,
    }));
  }

  listedSessions(cookieHeader) {
    const currentToken = this.cookieToken(cookieHeader);
    this.cleanup();
    return [...this.sessions.entries()].map(([token, session]) => ({
      id: session.id,
      deviceId: session.deviceId,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: new Date(session.expiresAt).toISOString(),
      ip: session.ip,
      userAgent: session.userAgent,
      current: token === currentToken,
    }));
  }

  async revokeDevice(deviceId) {
    await this.load();
    const index = this.devices.findIndex((device) => device.id === deviceId);
    if (index < 0) return false;
    this.devices.splice(index, 1);
    for (const [token, session] of this.sessions) {
      if (session.deviceId === deviceId) this.sessions.delete(token);
    }
    await this.save();
    return true;
  }

  revokeSession(sessionId) {
    for (const [token, session] of this.sessions) {
      if (session.id !== sessionId) continue;
      this.sessions.delete(token);
      return true;
    }
    return false;
  }
}
