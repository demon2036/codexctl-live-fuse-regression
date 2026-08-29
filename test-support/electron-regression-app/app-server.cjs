"use strict";

process.title = "codexctl-regression-app-server";
const heartbeat = setInterval(() => {}, 30_000);
const stop = () => {
  clearInterval(heartbeat);
  process.exit(0);
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
