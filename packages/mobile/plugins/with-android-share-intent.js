const { withAndroidManifest } = require("@expo/config-plugins");

/**
 * 为 Android 主 Activity 注册 ACTION_SEND (text/plain) intent-filter，支持从系统其他 App 分享文本到 AIChat。
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

function withAndroidShareIntent(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    manifestConfig.modResults = applyAndroidShareIntent(manifestConfig.modResults);
    return manifestConfig;
  });
}

module.exports = withAndroidShareIntent;
module.exports.applyAndroidShareIntent = applyAndroidShareIntent;
