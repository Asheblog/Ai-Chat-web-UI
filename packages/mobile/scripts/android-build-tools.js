const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const mobileDir = path.resolve(__dirname, "..");
const androidDir = path.join(mobileDir, "android");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? mobileDir,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    throw new Error(`${command} 执行失败，退出码 ${result.status}${detail}`);
  }
  return options.capture ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
}

function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), ".local", "share", "android-sdk"),
    path.join(os.homedir(), "Android", "Sdk"),
    path.join(os.homedir(), "android-sdk"),
  ].filter(Boolean);
  if (process.platform === "win32") {
    candidates.push(path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk"));
  }
  const sdk = candidates.find(
    (candidate) => fs.existsSync(path.join(candidate, "platforms")) && fs.existsSync(path.join(candidate, "build-tools")),
  );
  if (!sdk) {
    throw new Error("未找到 Android SDK；请设置 ANDROID_HOME 或 ANDROID_SDK_ROOT");
  }
  return path.resolve(sdk);
}

function findJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    path.join(os.homedir(), ".local", "share", "jdks", "temurin-17"),
    "/usr/lib/jvm/java-17-openjdk-amd64",
    "/usr/lib/jvm/java-21-openjdk-amd64",
  ].filter(Boolean);
  return candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "bin", process.platform === "win32" ? "java.exe" : "java")),
  );
}

function findBuildTool(sdk, name) {
  const buildToolsDir = path.join(sdk, "build-tools");
  const versions = fs
    .readdirSync(buildToolsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.bat`, name] : [name];
  for (const version of versions) {
    for (const executable of names) {
      const candidate = path.join(buildToolsDir, version, executable);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`Android SDK 中未找到 ${name}`);
}

function writeLocalProperties(sdk) {
  const escaped = sdk.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/ /g, "\\ ");
  fs.writeFileSync(path.join(androidDir, "local.properties"), `sdk.dir=${escaped}\n`, "utf8");
}

module.exports = {
  androidDir,
  findAndroidSdk,
  findBuildTool,
  findJavaHome,
  mobileDir,
  run,
  writeLocalProperties,
};
