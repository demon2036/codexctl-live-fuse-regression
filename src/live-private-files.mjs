import fs from "node:fs/promises";

function expectedUid(stat) {
  return typeof process.getuid === "function" ? process.getuid() : stat.uid;
}

export async function ensureLivePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== expectedUid(stat)) {
    throw new Error("live directory is not owned by the current user");
  }
  await fs.chmod(directory, 0o700);
  stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (process.platform !== "win32" && (stat.mode & 0o777) !== 0o700)) {
    throw new Error("live directory is not private");
  }
  return stat;
}

export async function assertLivePrivateFile(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== expectedUid(stat)
    || (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600)) {
    throw new Error("live file is not private");
  }
  return stat;
}
