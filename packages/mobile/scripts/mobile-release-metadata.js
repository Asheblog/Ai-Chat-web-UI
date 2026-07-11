function parseMobileReleaseTag(ref, versionName) {
  const tag = ref.replace(/^refs\/tags\//, "");
  const match = /^mobile-v(.+)$/.exec(tag);
  if (!match) {
    throw new Error("Tag 必须使用 mobile-v<versionName> 格式");
  }
  if (match[1] !== versionName) {
    throw new Error(`Tag 版本 ${match[1]} 与移动端版本 ${versionName} 不一致`);
  }
  return { tag, versionName };
}

module.exports = { parseMobileReleaseTag };
