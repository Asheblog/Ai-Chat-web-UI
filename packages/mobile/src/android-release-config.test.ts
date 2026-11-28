import { describe, expect, it } from "vitest";

const { applyReleaseSigning } = require("../plugins/with-android-release-signing");
const { applyAndroidShareIntent } = require("../plugins/with-android-share-intent");
const {
  parseMobileReleaseTag,
  validateMobileManifestConsistency,
} = require("../scripts/mobile-release-metadata");
const {
  SIGNING_ENV,
  resolveReleaseSigningMode,
} = require("../scripts/android-signing");

function findRepoRoot(): string {
  const fs = require("node:fs");
  const path = require("node:path");
  let current = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    if (fs.existsSync(path.join(current, ".github", "workflows", "mobile-release.yml"))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("未找到包含 .github/workflows/mobile-release.yml 的仓库根目录");
}

function hasBash(): boolean {
  const { spawnSync } = require("node:child_process");
  const probe = spawnSync("bash", ["-c", "printf bash-ok"]);
  return !probe.error && probe.status === 0;
}

function readWorkflowStepScript(stepName: string): string {
  const fs = require("node:fs");
  const path = require("node:path");
  const lines: string[] = fs
    .readFileSync(path.join(findRepoRoot(), ".github", "workflows", "mobile-release.yml"), "utf8")
    .split(/\r?\n/);
  const start = lines.findIndex((line: string) => line.includes("- name: " + stepName));
  if (start === -1) {
    throw new Error("mobile-release.yml 缺少步骤: " + stepName);
  }
  const stepLines: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^      - name: /.test(lines[index])) {
      break;
    }
    stepLines.push(lines[index]);
  }
  const runIndex = stepLines.findIndex((line: string) => line.trim() === "run: |");
  return stepLines
    .slice(runIndex + 1)
    .map((line: string) => line.replace(/^ {10}/, ""))
    .join("\n");
}

const generatedBuildGradle = `
android {
    defaultConfig {
        applicationId 'com.aichat.mobile'
        versionCode 2
        versionName "1.0.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

describe("双端构建与发布配置", () => {
  it("Android release 支持外部 keystore 且在无秘密时平滑回退免密签名", () => {
    const result = applyReleaseSigning(generatedBuildGradle);

    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEYSTORE_PATH")');
    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEYSTORE_PASSWORD")');
    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEY_ALIAS")');
    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEY_PASSWORD")');
    expect(result).toContain("initWith debug");
    expect(result).toMatch(/release\s*\{\s*signingConfig signingConfigs\.release\s*minifyEnabled false/);
  });

  it("Android release 签名来源仅在四个变量全空时回退免密自签名", () => {
    expect(resolveReleaseSigningMode({})).toBe("free");

    const completeEnvironment = Object.fromEntries(
      SIGNING_ENV.map((name: string) => [name, "configured"]),
    );
    expect(resolveReleaseSigningMode(completeEnvironment)).toBe("external");

    expect(() => resolveReleaseSigningMode({ [SIGNING_ENV[0]]: "configured" })).toThrow(
      "Android 签名环境变量不完整",
    );
  });

  it("签名插件与构建脚本共用同一组签名环境变量", () => {
    const { SIGNING_ENV: pluginSigningEnv } = require("../plugins/with-android-release-signing");
    expect(pluginSigningEnv).toEqual(SIGNING_ENV);
  });

  it("Windows shell 下含空格的可执行路径与参数会被正确引用", () => {
    const { quoteShellArgument } = require("../scripts/android-build-tools");

    expect(quoteShellArgument("E:\\Program Files\\Java\\bin\\keytool.exe")).toBe(
      '"E:\\Program Files\\Java\\bin\\keytool.exe"',
    );
    expect(quoteShellArgument("CN=AIChat Mobile, OU=Community, O=AIChat")).toBe(
      '"CN=AIChat Mobile, OU=Community, O=AIChat"',
    );
    expect(quoteShellArgument("--no-daemon")).toBe("--no-daemon");
    expect(quoteShellArgument("E:\\Android\\Sdk\\gradlew.bat")).toBe(
      "E:\\Android\\Sdk\\gradlew.bat",
    );
  });

  it("外部 keystore 使用绝对路径，缺失时失败", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { ensureReleaseSigningEnvironment } = require("../scripts/android-signing");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aichat-external-keystore-"));
    const keystore = path.join(dir, "release.keystore");
    fs.writeFileSync(keystore, "fixture");
    const completeEnvironment = Object.fromEntries(
      SIGNING_ENV.map((name: string) => [name, "configured"]),
    );

    const resolved = ensureReleaseSigningEnvironment(
      { ...completeEnvironment, AICHAT_ANDROID_KEYSTORE_PATH: keystore },
      null,
    );
    expect(resolved.AICHAT_ANDROID_KEYSTORE_PATH).toBe(path.resolve(keystore));

    expect(() =>
      ensureReleaseSigningEnvironment(
        { ...completeEnvironment, AICHAT_ANDROID_KEYSTORE_PATH: path.join(dir, "missing.keystore") },
        null,
      ),
    ).toThrow("keystore 不存在");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("免密自签名路径用 keytool 生成 keystore 并回填四个签名变量", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { ensureReleaseSigningEnvironment } = require("../scripts/android-signing");

    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "aichat-free-keystore-"));
    const calls: Array<{ command: string; args: string[] }> = [];
    const environment = ensureReleaseSigningEnvironment({}, "/opt/fake-jdk", {
      cacheDir,
      runCommand: (command: string, args: string[]) => {
        calls.push({ command, args });
        fs.writeFileSync(path.join(cacheDir, "free-release.keystore"), "fixture");
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(
      path.join("/opt/fake-jdk", "bin", process.platform === "win32" ? "keytool.exe" : "keytool"),
    );
    const keystoreIndex = calls[0].args.indexOf("-keystore");
    expect(calls[0].args[keystoreIndex + 1]).toBe(path.join(cacheDir, "free-release.keystore"));
    const dnameIndex = calls[0].args.indexOf("-dname");
    expect(calls[0].args[dnameIndex + 1]).toBe(
      "CN=AIChat Mobile, OU=Community, O=AIChat, L=Local, ST=Local, C=CN",
    );
    expect(calls[0].args).toContain("2048");

    expect(environment.AICHAT_ANDROID_KEYSTORE_PATH).toBe(
      path.join(cacheDir, "free-release.keystore"),
    );
    expect(environment.AICHAT_ANDROID_KEY_ALIAS).toBe("aichat-free");
    expect(environment.AICHAT_ANDROID_KEYSTORE_PASSWORD).toBe("aichatfree");
    expect(environment.AICHAT_ANDROID_KEY_PASSWORD).toBe("aichatfree");

    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("Release 工作流把四个签名 Secrets 交给构建脚本判定，不在 shell 侧静默降级", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const repoRoot = findRepoRoot();
    const workflow: string = fs.readFileSync(
      path.join(repoRoot, ".github", "workflows", "mobile-release.yml"),
      "utf8",
    );

    for (const secret of [
      "AICHAT_ANDROID_KEYSTORE_BASE64",
      "AICHAT_ANDROID_KEYSTORE_PASSWORD",
      "AICHAT_ANDROID_KEY_ALIAS",
      "AICHAT_ANDROID_KEY_PASSWORD",
    ]) {
      expect(workflow).toContain(secret + ": ");
      expect(workflow).toContain("secrets." + secret);
    }
    expect(workflow).toContain("base64 --decode");
    expect(workflow).not.toContain('if [ -n "$KEYSTORE_B64" ]');
    expect(workflow.match(/AICHAT_REQUIRE_PINNED_CERT=1/g)).toHaveLength(1);
    // 发布步骤以“产物 + 校验”为整体，且不得覆盖已发布资产。
    expect(workflow).not.toContain("--clobber");
    expect(workflow).toContain("sha256sum -c");
    expect(workflow).toContain("gh release download");
    expect(workflow).toContain("checksum matched published");
  });

  it("Release 工作流的签名分支在真实 shell 中按三态执行", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { resolveReleaseSigningMode } = require("../scripts/android-signing");

    if (process.platform === "win32" || !hasBash()) {
      // shell 级回归依赖 POSIX bash 与路径语义，仅在 CI（ubuntu / macOS）执行；Windows 上跳过。
      return;
    }

    const script = readWorkflowStepScript("Build installable Android APK");

    const work = fs.mkdtempSync(path.join(os.tmpdir(), "aichat-release-step-"));
    const binDir = path.join(work, "bin");
    const apkDir = path.join(work, "packages", "mobile", "android", "app", "build", "outputs", "apk", "release");
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(apkDir, { recursive: true });
    fs.writeFileSync(path.join(apkDir, "app-release.apk"), "");
    fs.writeFileSync(path.join(work, "step.sh"), script + "\n");

    const stubPnpm = [
      "#!/usr/bin/env bash",
      "env | grep '^AICHAT_' | sort > \"$AICHAT_ENV_DUMP\"",
      'node -e "const {resolveReleaseSigningMode}=require(process.env.SIGNING_MODULE); try { console.log(resolveReleaseSigningMode(process.env)); } catch (error) { console.error(error.message); process.exit(1); }"',
      "",
    ].join("\n");
    fs.writeFileSync(path.join(binDir, "pnpm"), stubPnpm);
    fs.chmodSync(path.join(binDir, "pnpm"), 0o755);

    const repoRoot = findRepoRoot();
    const { spawnSync } = require("node:child_process");
    const keystore = path.join(work, "fixture.keystore");
    fs.writeFileSync(keystore, "fixture-keystore");
    const keystoreBase64 = fs.readFileSync(keystore).toString("base64");

    const runStep = (secrets: Record<string, string>) => {
      const dumpPath = path.join(work, "env-" + Date.now() + Math.random().toString(36).slice(2) + ".txt");
      const environment: Record<string, string> = {
        ...(process.env as Record<string, string>),
      };
      for (const name of [...SIGNING_ENV, "AICHAT_REQUIRE_PINNED_CERT"]) {
        delete environment[name];
      }
      Object.assign(environment, {
        PATH: binDir + path.delimiter + (process.env.PATH ?? ""),
        AICHAT_ENV_DUMP: dumpPath,
        SIGNING_MODULE: path.join(repoRoot, "packages", "mobile", "scripts", "android-signing.js"),
        VERSION: "1.0.0",
        RUNNER_TEMP: work,
        ...secrets,
      });
      const result = spawnSync("bash", [path.join(work, "step.sh")], { cwd: work, env: environment });
      const dump = fs.existsSync(dumpPath) ? fs.readFileSync(dumpPath, "utf8") : "";
      return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), dump };
    };

    const free = runStep({});
    expect(free.status).toBe(0);
    expect(free.stdout).toContain("free");
    expect(free.dump).not.toContain("AICHAT_ANDROID_KEYSTORE_PATH=");

    const signed = runStep({
      AICHAT_ANDROID_KEYSTORE_BASE64: keystoreBase64,
      AICHAT_ANDROID_KEYSTORE_PASSWORD: "storepass",
      AICHAT_ANDROID_KEY_ALIAS: "aichat-release",
      AICHAT_ANDROID_KEY_PASSWORD: "keypass",
    });
    expect(signed.status).toBe(0);
    expect(signed.stdout).toContain("external");
    expect(signed.dump).toContain("AICHAT_ANDROID_KEYSTORE_PATH=" + path.join(work, "release.keystore"));
    expect(signed.dump).toContain("AICHAT_REQUIRE_PINNED_CERT=1");

    const partial = runStep({ AICHAT_ANDROID_KEYSTORE_PASSWORD: "storepass" });
    expect(partial.status).not.toBe(0);
    expect(partial.stderr).toContain("签名环境变量不完整");

    const base64Only = runStep({ AICHAT_ANDROID_KEYSTORE_BASE64: keystoreBase64 });
    expect(base64Only.status).not.toBe(0);
    expect(base64Only.stderr).toContain("签名环境变量不完整");

    expect(resolveReleaseSigningMode({})).toBe("free");
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("可执行文件路径含空格时 run() 仍能拿到输出", () => {
    const { run } = require("../scripts/android-build-tools");

    const output = run(process.execPath, ["-e", "process.stdout.write('spawn-ok')"], {
      capture: true,
    });
    expect(output).toContain("spawn-ok");
  });

  it("Release 发布步骤以“产物 + 校验”成组维护，绝不交叉覆盖", () => {
    if (!hasBash()) {
      return;
    }
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { spawnSync } = require("node:child_process");

    const script = readWorkflowStepScript("Create or update GitHub Release");
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "aichat-publish-step-"));
    const binDir = path.join(work, "bin");
    const store = path.join(work, "remote");
    const assetsList = path.join(work, "remote-assets.txt");
    const releaseAssets = path.join(work, "release-assets");
    const ghLog = path.join(work, "gh.log");
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(store, { recursive: true });
    fs.mkdirSync(releaseAssets, { recursive: true });
    fs.writeFileSync(path.join(work, "publish.sh"), script + "\n");

    const version = "1.0.0";
    const apk = "aichat-mobile-" + version + "-android.apk";
    const ipa = "aichat-mobile-" + version + "-ios-unsigned.ipa";

    const stubGh = [
      "#!/usr/bin/env bash",
      'echo "gh $*" >> "$GH_LOG"',
      'case "$1 $2" in',
      '  "release view")',
      '    if [ "${REMOTE_EXISTS:-0}" != "1" ]; then exit 1; fi',
      '    case "$*" in *--json*) cat "$REMOTE_ASSETS";; esac',
      "    exit 0 ;;",
      '  "release create") exit 0 ;;',
      '  "release upload")',
      "    shift 3",
      '    for file in "$@"; do',
      '      name="$(basename "$file")"',
      '      cp "$file" "$REMOTE_STORE/$name"',
      '      printf "%s\\n" "$name" >> "$REMOTE_ASSETS"',
      '      echo "uploaded $name" >> "$GH_LOG"',
      "    done",
      "    exit 0 ;;",
      '  "release download")',
      "    shift 3",
      '    while [ $# -gt 0 ]; do',
      '      case "$1" in',
      '        --pattern) pattern="$2"; shift 2 ;;',
      '        --dir) dir="$2"; shift 2 ;;',
      "        *) shift ;;",
      "      esac",
      "    done",
      '    cp "$REMOTE_STORE/$pattern" "$dir/$pattern"',
      "    exit 0 ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(binDir, "gh"), stubGh);
    fs.chmodSync(path.join(binDir, "gh"), 0o755);

    const resetRemote = () => {
      fs.rmSync(store, { recursive: true, force: true });
      fs.mkdirSync(store, { recursive: true });
      fs.writeFileSync(assetsList, "", "utf8");
      fs.writeFileSync(ghLog, "", "utf8");
    };
    const writeLocal = (name: string, content: string) => {
      fs.writeFileSync(path.join(releaseAssets, name), content, "utf8");
      fs.writeFileSync(path.join(releaseAssets, name + ".sha256"), "placeholder", "utf8");
    };
    const digestOf = (content: string) => crypto.createHash("sha256").update(content).digest("hex");
    const publishFile = (name: string, content: string) => {
      fs.writeFileSync(path.join(store, name), content, "utf8");
      fs.appendFileSync(assetsList, name + "\n");
    };
    const publishChecksum = (name: string, content: string) => {
      fs.writeFileSync(
        path.join(store, name + ".sha256"),
        digestOf(content) + "  " + name + "\n",
        "utf8",
      );
      fs.appendFileSync(assetsList, name + ".sha256\n");
    };
    const runPublish = (releaseExists: boolean) => {
      fs.writeFileSync(ghLog, "", "utf8");
      const result = spawnSync("bash", [path.join(work, "publish.sh")], {
        cwd: work,
        env: {
          ...(process.env as Record<string, string>),
          PATH: binDir + path.delimiter + (process.env.PATH ?? ""),
          GH_LOG: ghLog,
          REMOTE_EXISTS: releaseExists ? "1" : "0",
          REMOTE_STORE: store,
          REMOTE_ASSETS: assetsList,
          TAG: "mobile-v" + version,
          VERSION: version,
        },
      });
      const log = fs.readFileSync(ghLog, "utf8");
      return { status: result.status, stdout: String(result.stdout ?? ""), log };
    };
    const uploads = (log: string) =>
      log.split(/\r?\n/).filter((line) => line.startsWith("uploaded "));

    resetRemote();
    writeLocal(apk, "new-apk");
    writeLocal(ipa, "new-ipa");

    const fresh = runPublish(false);
    expect(fresh.status).toBe(0);
    expect(fresh.log).toContain("release create");
    expect(fresh.log).toContain(apk + ".sha256");
    expect(fresh.log).toContain(ipa + ".sha256");

    resetRemote();
    for (const name of [apk, ipa]) {
      fs.copyFileSync(path.join(releaseAssets, name), path.join(store, name));
      fs.copyFileSync(path.join(releaseAssets, name + ".sha256"), path.join(store, name + ".sha256"));
      fs.appendFileSync(assetsList, name + "\n" + name + ".sha256\n");
    }
    const untouched = runPublish(true);
    expect(untouched.status).toBe(0);
    expect(uploads(untouched.log)).toEqual([]);

    // 只有已发布产物：按已发布字节补校验，绝不把新产物绑到旧校验上。
    resetRemote();
    publishFile(apk, "published-apk-bytes");
    const artifactOnly = runPublish(true);
    expect(artifactOnly.status).toBe(0);
    expect(artifactOnly.log).toContain("gh release download");
    expect(fs.readFileSync(path.join(store, apk), "utf8")).toBe("published-apk-bytes");
    expect(fs.readFileSync(path.join(store, apk + ".sha256"), "utf8").split(" ")[0]).toBe(
      digestOf("published-apk-bytes"),
    );
    expect(uploads(artifactOnly.log)).toEqual([
      "uploaded " + apk + ".sha256",
      "uploaded " + ipa,
      "uploaded " + ipa + ".sha256",
    ]);

    // 只有已发布校验：待上传产物必须与历史 checksum 一致。
    resetRemote();
    publishFile(apk, "published-apk-bytes");
    publishChecksum(apk, "published-apk-bytes");
    publishChecksum(ipa, "published-ipa-bytes");
    writeLocal(ipa, "published-ipa-bytes");
    const shaOnlyMatch = runPublish(true);
    expect(shaOnlyMatch.status).toBe(0);
    expect(uploads(shaOnlyMatch.log)).toEqual(["uploaded " + ipa]);
    expect(fs.readFileSync(path.join(store, ipa + ".sha256"), "utf8").split(" ")[0]).toBe(
      digestOf("published-ipa-bytes"),
    );

    // 只有已发布校验且产物不匹配：fail closed，不上传任何不匹配产物。
    resetRemote();
    publishFile(apk, "published-apk-bytes");
    publishChecksum(apk, "published-apk-bytes");
    publishChecksum(ipa, "published-ipa-bytes");
    writeLocal(ipa, "different-ipa-bytes");
    const shaOnlyMismatch = runPublish(true);
    expect(shaOnlyMismatch.status).not.toBe(0);
    expect(shaOnlyMismatch.stdout).toContain("拒绝上传");
    expect(fs.existsSync(path.join(store, ipa))).toBe(false);
    expect(uploads(shaOnlyMismatch.log)).toEqual([]);

    fs.rmSync(work, { recursive: true, force: true });
  });

  it("Android Share Intent 插件幂等注入 ACTION_SEND text/plain", () => {
    const baseManifest = {
      manifest: {
        application: [
          {
            activity: [
              {
                "intent-filter": [
                  {
                    action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const once = applyAndroidShareIntent(baseManifest);
    const twice = applyAndroidShareIntent(once);
    const filters = twice.manifest.application[0].activity[0]["intent-filter"];
    expect(filters).toHaveLength(2);
    expect(filters[1].action[0].$["android:name"]).toBe("android.intent.action.SEND");
    expect(filters[1].data[0].$["android:mimeType"]).toBe("text/plain");
  });

  it("校验 mobile-vX.Y.Z Tag 与 app.json / package.json 版本一致", () => {
    expect(parseMobileReleaseTag("refs/tags/mobile-v1.0.0", "1.0.0")).toEqual({
      tag: "mobile-v1.0.0",
      versionName: "1.0.0",
    });
    expect(() => parseMobileReleaseTag("refs/tags/mobile-v1.0.1", "1.0.0")).toThrow(
      "Tag 版本 1.0.1 与移动端版本 1.0.0 不一致",
    );
    expect(() => parseMobileReleaseTag("refs/tags/v1.0.0", "1.0.0")).toThrow(
      "Tag 必须使用 mobile-v<major.minor.patch> 格式",
    );

    const meta = validateMobileManifestConsistency(
      {
        expo: {
          version: "1.0.0",
          android: { package: "com.aichat.mobile", versionCode: 2 },
          ios: { bundleIdentifier: "com.aichat.mobile", buildNumber: "2" },
        },
      },
      { version: "1.0.0" },
    );
    expect(meta).toEqual({
      version: "1.0.0",
      androidPackage: "com.aichat.mobile",
      androidVersionCode: 2,
      iosBundleIdentifier: "com.aichat.mobile",
      iosBuildNumber: "2",
    });
  });
});
