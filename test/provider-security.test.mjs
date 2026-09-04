import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload, rendererHarness } from "../test-support/prompt-renderer-harness.mjs";

const THREAD = "11111111-2222-4333-8444-555555555555";

function mountComposer(harness, memoizedProps, manager = null) {
  const footer = harness.document.createElement("footer");
  footer.setAttribute("data-composer-footer-responsive", "true");
  const composer = harness.document.createElement("section");
  composer.setAttribute("data-codex-composer", "true");
  const permission = harness.document.createElement("button");
  permission.setAttribute("data-composer-navigation-target", "permissions");
  footer.append(composer, permission);
  harness.document.body.appendChild(footer);
  const fiber = {
    memoizedProps,
    updateQueue: manager ? { memoCache: { data: [[manager]] } } : null,
    return: null,
  };
  composer.__reactFiber$providerSecurity = { memoizedProps: {}, return: fiber };
  return { composer, fiber };
}

function makeManager(sendRequest) {
  const requestClient = { sendRequest, async prewarmThreadStart() { return {}; } };
  return {
    manager: {
      hostId: "local", requestClient, threadCreation: {},
      getHostId() { return "local"; }, startConversation() {}, clearPrewarmedThreads() {},
    },
    requestClient,
  };
}

async function setup(t, {
  memoizedProps = { clientThreadId: "client-new-thread:provider-security", hasConversation: false },
  payloadOverrides = {},
  sendRequest = null,
  storedProvider = undefined,
  storedThreadProvider = undefined,
} = {}) {
  const fixture = await makePayload(payloadOverrides);
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  if (storedProvider !== undefined || storedThreadProvider !== undefined) {
    harness.cleanup();
    harness.execute(`sessionStorage.setItem(
      "codex-provider-selection-revision-v1",
      ${JSON.stringify(fixture.loaded.config.providerSelectionRevision)}
    ); sessionStorage.setItem(
      "codex-provider-pending-v1",
      ${JSON.stringify(JSON.stringify(storedProvider))}
    ); localStorage.setItem(
      "codex-base-prompt-thread-map-v1",
      ${JSON.stringify(JSON.stringify({
        [THREAD]: {
          prompt: { id: "default", label: "Default", path: null },
          context: { id: "native", label: "Native / Official", native: true },
          provider: storedThreadProvider,
          applied: { prompt: false, context: false },
        },
      }))}
    );`);
    harness.execute(fixture.loaded.payload);
  }
  harness.createDom();
  const managed = sendRequest ? makeManager(sendRequest) : null;
  const mounted = mountComposer(harness, memoizedProps, managed?.manager ?? null);
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  if (managed) {
    assert.equal(harness.runNextTimer(), true, "manager discovery timer must run");
    await harness.flush();
  }
  return { fixture, harness, ...mounted, ...managed };
}

function domSurface(harness) {
  return harness.nodes().flatMap((node) => [
    node.textContent,
    ...[...node.attributes.entries()].flat(),
  ]).join("\n");
}

test("Provider catalog exposes IDs and labels without endpoint or credential metadata", async (t) => {
  const privateHost = "private-provider-gateway.example";
  const secretEnvironment = "CODEX_PROVIDER_SUPER_SECRET_ENV";
  const secretKey = "provider-secret-field-sentinel";
  const calls = [];
  const { harness } = await setup(t, {
    async sendRequest(method, params) {
      calls.push({ method, params });
      if (method !== "config/read") return {};
      return {
        config: {
          model_provider: "polo",
          model_providers: {
            polo: {
              name: "Polo",
              base_url: `https://user:password@${privateHost}/internal/v1?key=${secretKey}`,
              env_key: secretEnvironment,
              api_key: secretKey,
            },
          },
        },
      };
    },
  });
  const indicator = harness.document.querySelector('[data-codex-provider-indicator="true"]');
  indicator.click();
  await harness.flush();

  const api = harness.window.__CODEX_BASE_PROMPT_SWITCHER__;
  const catalog = JSON.parse(JSON.stringify(api.providerCatalog()));
  assert.deepEqual(catalog, [
    { id: "openai", label: "OpenAI", kind: "builtin", source: "builtin" },
    { id: "polo", label: "Polo", kind: "custom", source: "config" },
  ]);
  const storage = harness.execute(`JSON.stringify({
    pending: sessionStorage.getItem("codex-provider-pending-v1"),
    threads: localStorage.getItem("codex-base-prompt-thread-map-v1")
  })`);
  const surfaces = [
    domSurface(harness),
    JSON.stringify(api.diagnostics()),
    JSON.stringify(catalog),
    storage,
    JSON.stringify(calls),
  ].join("\n");
  for (const secret of [privateHost, secretEnvironment, secretKey]) {
    assert.equal(surfaces.includes(secret), false, `${secret} must not escape config/read`);
  }
});

test("renderer rejects malformed Provider IDs at fiber, result, transform, and API boundaries", async (t) => {
  const invalidIds = [
    "https://evil.example/v1",
    "provider with spaces",
    "provider/with/slashes",
    "provider:with:colons",
    "\u0000polo",
    `p${"x".repeat(120)}`,
  ];
  const { harness } = await setup(t, {
    memoizedProps: {
      conversationId: THREAD,
      hasConversation: true,
      modelProvider: invalidIds[0],
    },
  });
  const api = harness.window.__CODEX_BASE_PROMPT_SWITCHER__;
  assert.deepEqual(JSON.parse(JSON.stringify(api.currentSessionProvider())), {
    id: null,
    threadId: THREAD,
    status: "unknown",
    source: "provider-not-exposed",
    candidate: null,
  });
  for (const id of invalidIds) {
    assert.equal(api.recordProviderFromResult("thread/read", { threadId: THREAD }, {
      thread: { id: THREAD, modelProvider: id },
    }), null, `result Provider must reject ${JSON.stringify(id)}`);
    const transformed = api.transformThreadStart(
      { threadSource: "user" },
      api.selectedProfileForRequest(),
      api.selectedContextForRequest(),
      id,
    );
    assert.equal(transformed.modelProvider, undefined,
      `request Provider must reject ${JSON.stringify(id)}`);
    await assert.rejects(api.selectProvider(id), /Provider ID 无效/);
  }
  const valid = api.transformThreadStart(
    { threadSource: "user" },
    api.selectedProfileForRequest(),
    api.selectedContextForRequest(),
    " polo ",
  );
  assert.equal(valid.modelProvider, "polo");
});

test("invalid persisted Provider values are ignored and purged", async (t) => {
  const invalid = "https://persisted-provider.invalid/v1";
  const { harness } = await setup(t, {
    storedProvider: invalid,
    storedThreadProvider: invalid,
  });
  const api = harness.window.__CODEX_BASE_PROMPT_SWITCHER__;
  assert.equal(api.selectedProviderForRequest(), null);
  assert.equal(api.pendingProviderDetails(), null);
  assert.equal(
    harness.document.querySelector('[data-codex-provider-indicator="true"]')
      .getAttribute("data-provider"),
    "openai",
  );
  assert.equal(
    harness.execute('sessionStorage.getItem("codex-provider-pending-v1")'),
    "null",
  );
  const threadMap = JSON.parse(harness.execute(
    'localStorage.getItem("codex-base-prompt-thread-map-v1")',
  ));
  assert.equal(threadMap[THREAD].provider, undefined);
  assert.equal(JSON.stringify(threadMap).includes(invalid), false);
});

test("failed Provider refresh preserves the last-known-good catalog and default", async (t) => {
  let configReads = 0;
  const { harness } = await setup(t, {
    async sendRequest(method) {
      if (method !== "config/read") return {};
      configReads += 1;
      if (configReads > 1) throw new Error("temporary config/read outage");
      return {
        config: {
          model_provider: "polo",
          model_providers: { polo: { name: "Polo" } },
        },
      };
    },
  });
  const api = harness.window.__CODEX_BASE_PROMPT_SWITCHER__;
  harness.document.querySelector('[data-codex-provider-indicator="true"]').click();
  await harness.flush();
  assert.equal(api.providerDefaultId(), "polo");
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.providerCatalog().map(({ id }) => id))),
    ["openai", "polo"],
  );

  await assert.rejects(api.loadProviderCatalog(true), /无法读取/);
  const diagnostics = api.diagnostics();
  assert.equal(diagnostics.providerCatalogStatus, "error");
  assert.equal(diagnostics.providerDefaultId, "polo");
  assert.deepEqual(
    JSON.parse(JSON.stringify(diagnostics.providerCatalog.map(({ id }) => id))),
    ["openai", "polo"],
  );
});
