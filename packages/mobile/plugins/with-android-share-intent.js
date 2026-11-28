const {
  AndroidConfig,
  withAndroidManifest,
  withStringsXml,
} = require("@expo/config-plugins");

const SHARE_INTO_SCHEME_RESOURCE = "share_into_scheme";

/**
 * 为 Android 主 Activity 注册 ACTION_SEND (text/plain) intent-filter，支持从系统其他 App 分享文本到 AIChat。
 *
 * 同时写入 expo-sharing 原生监听器读取的 share_into_scheme 字符串资源：没有它，
 * 应用在前台收到 SEND intent 时不会发出 JS 事件，只能依赖 AppState 恢复时再读取。
 */
function applyAndroidShareIntent(manifest) {
  const app = manifest?.manifest?.application?.[0];
  if (!app || !Array.isArray(app.activity)) {
    return manifest;
  }

  const mainActivity =
    app.activity.find((act) =>
      Array.isArray(act["intent-filter"]) &&
      act["intent-filter"].some((filter) =>
        (filter.action ?? []).some(
          (a) => a?.$?.["android:name"] === "android.intent.action.MAIN",
        ),
      ),
    ) ?? app.activity[0];

  if (!mainActivity) {
    return manifest;
  }

  const filters = Array.isArray(mainActivity["intent-filter"])
    ? mainActivity["intent-filter"]
    : [];

  const alreadyExists = filters.some((filter) =>
    (filter.action ?? []).some(
      (a) => a?.$?.["android:name"] === "android.intent.action.SEND",
    ),
  );

  if (!alreadyExists) {
    filters.push({
      action: [{ $: { "android:name": "android.intent.action.SEND" } }],
      category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
      data: [{ $: { "android:mimeType": "text/plain" } }],
    });
    mainActivity["intent-filter"] = filters;
  }

  return manifest;
}

function applyShareIntoSchemeResource(strings, scheme) {
  if (!scheme || !strings) {
    return strings;
  }

  return AndroidConfig.Strings.setStringItem(
    [
      AndroidConfig.Resources.buildResourceItem({
        name: SHARE_INTO_SCHEME_RESOURCE,
        value: scheme,
        translatable: false,
      }),
    ],
    strings,
  );
}

function resolveShareIntoScheme(config) {
  const configuredScheme = config?.scheme;
  const scheme = Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme;
  return scheme || config?.android?.package || null;
}

function withAndroidShareIntent(config) {
  const scheme = resolveShareIntoScheme(config);

  config = withAndroidManifest(config, (manifestConfig) => {
    manifestConfig.modResults = applyAndroidShareIntent(manifestConfig.modResults);
    return manifestConfig;
  });

  return withStringsXml(config, (stringsConfig) => {
    stringsConfig.modResults = applyShareIntoSchemeResource(
      stringsConfig.modResults,
      scheme,
    );
    return stringsConfig;
  });
}

module.exports = withAndroidShareIntent;
module.exports.applyAndroidShareIntent = applyAndroidShareIntent;
module.exports.applyShareIntoSchemeResource = applyShareIntoSchemeResource;
module.exports.resolveShareIntoScheme = resolveShareIntoScheme;
module.exports.SHARE_INTO_SCHEME_RESOURCE = SHARE_INTO_SCHEME_RESOURCE;
