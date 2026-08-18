import assert from "node:assert/strict";
import test from "node:test";
import { publishGiteeRelease } from "./publish_gitee_release.mjs";

test("fails before network access when the Gitee release token is missing", async () => {
  await assert.rejects(
    () => publishGiteeRelease(new Map(), ""),
    /GITEE_RELEASE_TOKEN is not configured/,
  );
});
