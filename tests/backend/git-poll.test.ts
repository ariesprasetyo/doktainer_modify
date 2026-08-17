import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_POLL_INTERVAL_SECONDS,
  decideDeploy,
  isDueForPoll,
  normalizePollInterval,
  resolvePollInterval,
} from "../../src/server/services/git-poll.service";

const NOW = new Date("2026-08-17T12:00:00.000Z");

function agoSeconds(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

test("auto deploy off is never polled", () => {
  assert.equal(
    isDueForPoll(
      { autoDeployOnPush: false, pollIntervalSeconds: 30, lastPolledAt: null },
      NOW,
    ),
    false,
  );
});

test("a container never polled before is due at once", () => {
  // Enabling auto deploy should take effect without waiting out an interval.
  assert.equal(
    isDueForPoll(
      { autoDeployOnPush: true, pollIntervalSeconds: 600, lastPolledAt: null },
      NOW,
    ),
    true,
  );
});

test("a container is not polled faster than its interval", () => {
  const candidate = {
    autoDeployOnPush: true,
    pollIntervalSeconds: 120,
    lastPolledAt: agoSeconds(119),
  };
  assert.equal(isDueForPoll(candidate, NOW), false);
  assert.equal(
    isDueForPoll({ ...candidate, lastPolledAt: agoSeconds(120) }, NOW),
    true,
  );
});

test("no interval set falls back to the default", () => {
  assert.equal(resolvePollInterval(null), DEFAULT_POLL_INTERVAL_SECONDS);
  assert.equal(resolvePollInterval(45), 45);

  assert.equal(
    isDueForPoll(
      {
        autoDeployOnPush: true,
        pollIntervalSeconds: null,
        lastPolledAt: agoSeconds(DEFAULT_POLL_INTERVAL_SECONDS - 1),
      },
      NOW,
    ),
    false,
  );
});

test("an interval outside the accepted range is refused", () => {
  assert.equal(normalizePollInterval(30), 30);
  assert.equal(normalizePollInterval(86_400), 86_400);
  for (const value of [29, 0, -60, 86_401, 1.5, "abc"]) {
    assert.throws(() => normalizePollInterval(value), undefined, `accepted ${value}`);
  }
});

test("an empty interval means the default, not an error", () => {
  for (const value of [null, undefined, ""]) {
    assert.equal(normalizePollInterval(value), null);
  }
});

test("the first observation does not deploy", () => {
  // Otherwise every panel restart would redeploy whatever is already running,
  // because the newest commit always differs from nothing.
  assert.deepEqual(
    decideDeploy({ latestCommitSha: "abc", lastPolledCommitSha: null }),
    { deploy: false, reason: "first-observation" },
  );
});

test("a new commit deploys", () => {
  assert.deepEqual(
    decideDeploy({ latestCommitSha: "def", lastPolledCommitSha: "abc" }),
    { deploy: true, reason: "new-commit" },
  );
});

test("the same commit does not deploy again", () => {
  assert.deepEqual(
    decideDeploy({ latestCommitSha: "abc", lastPolledCommitSha: "abc" }),
    { deploy: false, reason: "unchanged" },
  );
});

test("a container running an older commit catches up on the first poll", () => {
  // Nothing is recorded yet, but the running commit is a known baseline, so it
  // should not sit on an old build until the next push.
  assert.deepEqual(
    decideDeploy({
      latestCommitSha: "newer",
      lastPolledCommitSha: null,
      deployedCommitSha: "older",
    }),
    { deploy: true, reason: "new-commit" },
  );
});

test("a container already on the newest commit stays put", () => {
  assert.deepEqual(
    decideDeploy({
      latestCommitSha: "same",
      lastPolledCommitSha: null,
      deployedCommitSha: "same",
    }),
    { deploy: false, reason: "first-observation" },
  );
});

test("an empty commit never deploys", () => {
  assert.deepEqual(
    decideDeploy({ latestCommitSha: "   ", lastPolledCommitSha: "abc" }),
    { deploy: false, reason: "no-commit-recorded" },
  );
});
