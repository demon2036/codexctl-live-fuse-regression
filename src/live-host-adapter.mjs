import { validateLiveDiagnostics } from "./live-diagnostics.mjs";

function hostArtifact(value, slotId) {
  const artifact = {
    id: value.id,
    payload: value.payload,
    revision: value.revision,
    schema: "codexctl-live-renderer-artifact/1",
    type: slotId,
  };
  if (slotId === "wallpaper") artifact.image = value.image;
  return artifact;
}

export class LiveHostAdapter {
  constructor(connection) {
    if (!connection || typeof connection.call !== "function") {
      throw new TypeError("live host adapter requires a connection");
    }
    this.connection = connection;
  }

  async mount(slotId, artifact) {
    return this.connection.call("slot.mount", {
      artifact: hostArtifact(artifact, slotId),
      slotId,
    });
  }

  async unmount(slotId) {
    return this.connection.call("slot.unmount", { slotId });
  }

  async diagnostics(slotId) {
    return validateLiveDiagnostics(await this.connection.call(
      "slot.diagnostics", { slotId },
    ));
  }

  setRecovery(slotId, artifact) {
    return this.connection.call("recovery.set", {
      artifact: artifact ? hostArtifact(artifact, slotId) : null,
      slotId,
    });
  }

  clearRecovery(slotId) {
    return this.connection.call("recovery.clear", { slotId });
  }

  setUiStatus(status) {
    return this.connection.call("ui.status", { status });
  }
}
