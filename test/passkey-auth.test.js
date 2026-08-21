import assert from "node:assert/strict";
import test from "node:test";
import { PasskeyAuth } from "../passkey-auth.js";

function authWithDevice() {
  const auth = new PasskeyAuth({
    dataFile: "/tmp/unused-codex-remote-devices.json",
    rpID: "example.test",
    origin: "https://example.test",
  });
  auth.loaded = true;
  auth.devices = [{ credential: { id: "credential-id", transports: [] } }];
  return auth;
}

test("limits authentication challenges per client", async () => {
  const auth = authWithDevice();
  for (let index = 0; index < 10; index += 1) {
    await auth.authenticationOptions("192.0.2.1");
  }

  await assert.rejects(
    auth.authenticationOptions("192.0.2.1"),
    (error) => error.statusCode === 429,
  );
  assert.equal(auth.authenticationChallenges.size, 10);
});

test("evicts the oldest authentication challenge when globally full", async () => {
  const auth = authWithDevice();
  let oldestId;
  for (let index = 0; index < 500; index += 1) {
    const result = await auth.authenticationOptions(`client-${index}`);
    if (index === 0) oldestId = result.authenticationId;
  }

  const replacement = await auth.authenticationOptions("replacement-client");
  assert.equal(auth.authenticationChallenges.size, 500);
  assert.equal(auth.authenticationChallenges.has(oldestId), false);
  assert.equal(auth.authenticationChallenges.has(replacement.authenticationId), true);
});

test("invalidates an active pair code after global failures", () => {
  const auth = authWithDevice();
  const { code } = auth.createPairCode();
  for (let index = 0; index < 19; index += 1) {
    assert.equal(auth.consumePairCode("wrong", `client-${index}`), false);
  }
  assert.equal(auth.pairCodes.has(code), true);
  assert.equal(auth.consumePairCode("wrong", "last-client"), false);
  assert.equal(auth.pairCodes.has(code), false);
});

test("lists and revokes devices with their login sessions", async () => {
  const auth = authWithDevice();
  auth.devices[0] = {
    id: "device-1",
    name: "Phone",
    createdAt: "2026-08-21T00:00:00.000Z",
    lastUsedAt: "2026-08-21T00:00:00.000Z",
    credential: { id: "credential-id", transports: [] },
  };
  auth.save = async () => {};
  const cookie = auth.createSession(auth.devices[0], { ip: "192.0.2.1", userAgent: "Test browser" });

  const devices = await auth.listedDevices(cookie);
  const sessions = auth.listedSessions(cookie);
  assert.deepEqual(devices.map(({ id, current, sessionCount }) => ({ id, current, sessionCount })), [
    { id: "device-1", current: true, sessionCount: 1 },
  ]);
  assert.equal(sessions[0].current, true);
  assert.equal(sessions[0].ip, "192.0.2.1");

  assert.equal(await auth.revokeDevice("device-1"), true);
  assert.equal(auth.authenticated(cookie), false);
  assert.deepEqual(await auth.listedDevices(cookie), []);
});

test("revokes one login session without revoking its device", async () => {
  const auth = authWithDevice();
  auth.devices[0].id = "device-1";
  const cookie = auth.createSession(auth.devices[0]);
  const [session] = auth.listedSessions(cookie);

  assert.equal(auth.revokeSession(session.id), true);
  assert.equal(auth.authenticated(cookie), false);
  assert.equal(auth.devices.length, 1);
});

test("blocks an address after repeated login verification failures", () => {
  const auth = authWithDevice();
  for (let index = 0; index < 4; index += 1) {
    assert.equal(auth.recordLoginFailure("192.0.2.1").blocked, false);
  }
  assert.equal(auth.recordLoginFailure("192.0.2.1").blocked, true);
  assert.throws(
    () => auth.assertLoginAllowed("192.0.2.1"),
    (error) => error.statusCode === 429,
  );
  assert.doesNotThrow(() => auth.assertLoginAllowed("192.0.2.2"));
});
