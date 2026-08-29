const ORDERS = Object.freeze([
  Object.freeze(["official", "injected", "injected", "official"]),
  Object.freeze(["injected", "official", "official", "injected"]),
]);

export function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0 || !Number.isFinite(fraction)
    || fraction < 0 || fraction > 1) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function reasonForSample(sample, fields, maximumSystemLoad) {
  if (!sample || typeof sample !== "object") return "sample-missing";
  if (sample.environment?.probePassed === false) return "probe-failed";
  if (sample.environment?.remoteConnected !== true) return "remote-disconnected";
  if (!Number.isFinite(sample.environment?.systemLoad)
    || sample.environment.systemLoad > maximumSystemLoad) return "system-high-load";
  if (typeof sample.environment?.appVersion !== "string"
    || typeof sample.environment?.profileId !== "string") return "identity-missing";
  if (fields.some((field) => !Number.isFinite(sample.metrics?.[field])
    || sample.metrics[field] < 0)) return "metric-non-finite";
  return null;
}

function groupReason(samples, fields) {
  const identity = samples[0]?.environment;
  if (samples.some(({ environment }) => environment.appVersion !== identity.appVersion)) {
    return "app-version-skew";
  }
  if (samples.some(({ environment }) => environment.profileId !== identity.profileId)) {
    return "profile-skew";
  }
  for (const field of fields) {
    for (const mode of ["official", "injected"]) {
      const values = samples.filter((sample) => sample.mode === mode)
        .map(({ metrics }) => metrics[field]);
      const median = percentile(values, 0.5);
      const maximum = Math.max(...values);
      if (maximum > Math.max(median * 5, median + 100)) return `outlier-${field}`;
    }
  }
  return null;
}

function summarize(rawSamples, fields) {
  const summary = {};
  for (const mode of ["official", "injected"]) {
    summary[mode] = {};
    for (const field of fields) {
      const values = rawSamples.filter(({ included, mode: sampleMode }) => (
        included && sampleMode === mode
      )).map(({ metrics }) => metrics[field]);
      summary[mode][field] = {
        max: Math.max(...values),
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        values,
      };
    }
  }
  return summary;
}

function pairedGroups(rawSamples, fields) {
  const groupIndexes = [...new Set(rawSamples.filter(({ included }) => included)
    .map(({ groupIndex }) => groupIndex))];
  return groupIndexes.map((groupIndex) => {
    const samples = rawSamples.filter((entry) => entry.included && entry.groupIndex === groupIndex);
    const metrics = {};
    for (const field of fields) {
      const official = average(samples.filter(({ mode }) => mode === "official")
        .map((entry) => entry.metrics[field]));
      const injected = average(samples.filter(({ mode }) => mode === "injected")
        .map((entry) => entry.metrics[field]));
      metrics[field] = { delta: injected - official, injected, official };
    }
    return { groupIndex, metrics };
  });
}

export async function runABSampler({
  fields,
  groups = 2,
  maxGroupAttempts = 2,
  maximumSystemLoad = 0.9,
  measure,
  warmups = 1,
} = {}) {
  if (!Array.isArray(fields) || fields.length === 0
    || fields.some((field) => !/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(field))) {
    throw new TypeError("A/B sampler requires safe metric fields");
  }
  if (typeof measure !== "function") throw new TypeError("A/B sampler requires measure");
  if (![groups, maxGroupAttempts, warmups].every(Number.isSafeInteger)
    || groups < 1 || groups > 8 || maxGroupAttempts < 1 || maxGroupAttempts > 3
    || warmups < 0 || warmups > 3) throw new RangeError("Invalid A/B sampler bounds");
  const rawSamples = [];
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    for (const mode of ["official", "injected"]) {
      try {
        const output = await measure({ mode, phase: "warmup", sampleIndex: warmup });
        rawSamples.push({ ...output, groupAttempt: 0, groupIndex: -1, included: false,
          mode, phase: "warmup", reasonCode: "warmup", sampleIndex: warmup });
      } catch {
        rawSamples.push({ environment: null, metrics: null, groupAttempt: 0, groupIndex: -1,
          included: false, mode, phase: "warmup", reasonCode: "warmup-error",
          sampleIndex: warmup });
      }
    }
  }

  let attempts = 0;
  let completedGroups = 0;
  for (let groupIndex = 0; groupIndex < groups; groupIndex += 1) {
    let accepted = false;
    for (let groupAttempt = 1; groupAttempt <= maxGroupAttempts; groupAttempt += 1) {
      attempts += 1;
      const records = [];
      const order = ORDERS[groupIndex % ORDERS.length];
      for (let sampleIndex = 0; sampleIndex < order.length; sampleIndex += 1) {
        const mode = order[sampleIndex];
        let output;
        let reasonCode = null;
        try {
          output = await measure({ groupAttempt, groupIndex, mode, phase: "sample", sampleIndex });
          reasonCode = reasonForSample(output, fields, maximumSystemLoad);
        } catch {
          output = { environment: null, metrics: null };
          reasonCode = "measure-error";
        }
        records.push({ ...output, groupAttempt, groupIndex, included: false, mode,
          phase: "sample", reasonCode, sampleIndex });
      }
      const firstReason = records.find(({ reasonCode }) => reasonCode)?.reasonCode
        ?? groupReason(records, fields);
      if (firstReason) {
        for (const record of records) record.reasonCode ||= `group-${firstReason}`;
      } else {
        for (const record of records) {
          record.included = true;
          record.reasonCode = null;
        }
        accepted = true;
        completedGroups += 1;
      }
      rawSamples.push(...records);
      if (accepted) break;
    }
    if (!accepted) break;
  }
  if (completedGroups !== groups) {
    return { attempts, completedGroups, groups, rawSamples, status: "invalid" };
  }
  return {
    attempts,
    completedGroups,
    groups,
    pairedGroups: pairedGroups(rawSamples, fields),
    rawSamples,
    status: "pass",
    summary: summarize(rawSamples, fields),
  };
}
