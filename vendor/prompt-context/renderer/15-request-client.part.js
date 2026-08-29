  const patchManager = (manager) => {
    const client = manager?.requestClient;
    if (!client || typeof client.sendRequest !== "function"
      || typeof client.prewarmThreadStart !== "function") {
      throw new Error("The local request client does not expose the required thread/start methods");
    }
    const attachNotificationRepair = (patch) => {
      if (patch.notificationRepairAttached
        || typeof manager.addNotificationCallback !== "function") return;
      patch.notificationRepairAttached = true;
      try {
        const release = manager.addNotificationCallback(
          [
            "turn/started",
            "turn/completed",
            "thread/status/changed",
            "thread/tokenUsage/updated",
            "thread/compacted",
          ],
          (notification) => patch.controller.repairUiAfterNotification(notification),
        );
        patch.removeNotificationRepair = typeof release === "function" ? release : null;
      } catch (error) {
        patch.notificationRepairAttached = false;
        throw error;
      }
    };
    const installed = client[PATCH_KEY];
    if (installed && typeof installed === "object") {
      installed.controller = api;
      attachNotificationRepair(installed);
      state.manager = manager;
      state.managerStatus = "ready";
      state.managerError = null;
      return;
    }

    const patch = {
      controller: api,
      originalSendRequest: client.sendRequest,
      originalPrewarmThreadStart: client.prewarmThreadStart,
      notificationRepairAttached: false,
      removeNotificationRepair: null,
    };
    Object.defineProperty(client, PATCH_KEY, {
      value: patch,
      configurable: true,
      enumerable: false,
      writable: false,
    });
    attachNotificationRepair(patch);

    client.sendRequest = async function patchedBasePromptSendRequest(method, params, options) {
      const controller = patch.controller;
      const sendOriginal = async (requestParams) => {
        try {
          const result = await patch.originalSendRequest.call(this, method, requestParams, options);
          controller.recordProviderFromResult(method, requestParams, result);
          return result;
        } finally {
          controller.repairUiAfterRequest(method);
        }
      };
      if (controller.queuedContextForRequest(method, params)) {
        await controller.applyQueuedContextBeforeRequest(method, params);
      }
      if (method === "thread/start") {
        const profileClaim = controller.claimPendingProfileForTask(params);
        const providerClaim = controller.claimPendingProviderForTask(params);
        const profile = profileClaim.profile;
        const provider = providerClaim.providerId;
        const context = controller.selectedContextForRequest();
        const transformed = controller.transformThreadStart(params, profile, context, provider);
        const applied = controller.appliedOverrides(profile, context, params, provider);
        try {
          const result = await sendOriginal(transformed);
          controller.recordThreadFromResult(
            result, profile, context, "thread/start", applied,
            applied.provider ? provider : null,
          );
          return result;
        } catch (error) {
          controller.restorePendingProfileClaim(profileClaim);
          controller.restorePendingProviderClaim(providerClaim);
          throw error;
        }
      }
      if (method === "thread/resume") {
        const threadId = typeof params?.threadId === "string" ? params.threadId : null;
        // Unknown historical tasks must retain Codex's untouched resume request.
        if (controller.hasThreadRecord(threadId)) {
          const profile = controller.profileForThread(threadId);
          const context = controller.contextForThread(threadId);
          return sendOriginal(controller.transformThreadStart(params, profile, context));
        }
      }
      if (method === "thread/fork") {
        const parentId = typeof params?.threadId === "string"
          ? params.threadId : controller.currentConversationId();
        const profile = controller.profileForThread(parentId);
        const context = controller.contextForThread(parentId);
        const provider = controller.providerForThread(parentId);
        const result = await sendOriginal(params);
        controller.recordThreadFromResult(
          result,
          profile,
          context,
          "thread/fork",
          controller.appliedForThread(parentId),
          provider,
        );
        return result;
      }
      return sendOriginal(params);
    };

    client.prewarmThreadStart = async function patchedBasePromptPrewarmThreadStart(params, options) {
      const controller = patch.controller;
      const profileClaim = controller.claimPendingProfileForTask(params);
      const providerClaim = controller.claimPendingProviderForTask(params);
      const profile = profileClaim.profile;
      const provider = providerClaim.providerId;
      const context = controller.selectedContextForRequest();
      const transformed = controller.transformThreadStart(params, profile, context, provider);
      const applied = controller.appliedOverrides(profile, context, params, provider);
      try {
        const result = await patch.originalPrewarmThreadStart.call(this, transformed, options);
        controller.recordProviderFromResult("thread/prewarm", transformed, result);
        controller.recordThreadFromResult(
          result, profile, context, "thread/prewarm", applied,
          applied.provider ? provider : null,
        );
        return result;
      } catch (error) {
        controller.restorePendingProfileClaim(profileClaim);
        controller.restorePendingProviderClaim(providerClaim);
        throw error;
      }
    };

    state.manager = manager;
    state.managerStatus = "ready";
    state.managerError = null;
    if (resolvePendingProfile().path || resolvePendingContext().contextWindow) {
      try { manager.clearPrewarmedThreads(); } catch {}
    }
  };
