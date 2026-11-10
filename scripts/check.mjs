import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const build = spawnSync(process.execPath, ["scripts/build-client.mjs", "--check"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status || 1);

const files = (await readdir(new URL("../lib", import.meta.url))).filter(file => file.endsWith(".js")).sort();
for (const file of files) {
  const checked = spawnSync(process.execPath, ["--check", `lib/${file}`], { cwd: root, stdio: "inherit" });
  if (checked.status !== 0) process.exit(checked.status || 1);
}
