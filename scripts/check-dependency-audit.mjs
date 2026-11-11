#!/usr/bin/env node
/**
 * 依赖漏洞审计（不依赖 pnpm audit）。
 *
 * 背景：仓库默认 registry 是 npmmirror，它没有实现 /-/npm/v1/security/audits 端点，
 * `pnpm audit` 会直接报 ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS。这里改为读取
 * pnpm-lock.yaml 已解析出的版本集合，直接调用 npm 官方 bulk advisory 接口比对，
 * 输出仍然存在的告警，并按严重级别决定退出码，便于接进 CI。
 *
 * 用法：
 *   node scripts/check-dependency-audit.mjs
 *   node scripts/check-dependency-audit.mjs --fail-on high
 *   node scripts/check-dependency-audit.mjs --registry https://registry.npmjs.org
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const registry = getArg('--registry', 'https://registry.npmjs.org').replace(/\/$/, '');
const failOn = getArg('--fail-on', 'none');
const severityRank = { critical: 4, high: 3, moderate: 2, low: 1, info: 0 };

function parseVersion(value) {
  const cleaned = String(value).trim().replace(/^[v=]+/, '').split('-')[0];
  const parts = cleaned.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function satisfiesComparator(version, comparator) {
  const match = /^(<=|>=|<|>|=)?\s*(.+)$/.exec(comparator.trim());
  if (!match) return null;
  const op = match[1] || '=';
  const target = parseVersion(match[2]);
  if (!target) return null;
  const cmp = compare(version, target);
  switch (op) {
    case '<': return cmp < 0;
    case '<=': return cmp <= 0;
    case '>': return cmp > 0;
    case '>=': return cmp >= 0;
    default: return cmp === 0;
  }
}

/** 只覆盖 advisory 里实际出现的范围写法；无法判断时返回 null（当作未命中并提示）。 */
function satisfies(versionText, rangeText) {
  const version = parseVersion(versionText);
  if (!version) return null;
  const range = String(rangeText || '').trim();
  if (!range || range === '*' || range === '>=0') return true;
  for (const alternative of range.split('||')) {
    const part = alternative.trim();
    if (!part) continue;
    const hyphen = /^(.+?)\s+-\s+(.+)$/.exec(part);
    const comparators = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : part.split(/\s+/);
    let ok = true;
    let known = false;
    for (const comparator of comparators) {
      const result = satisfiesComparator(version, comparator);
      if (result === null) { ok = false; break; }
      known = true;
      if (!result) { ok = false; break; }
    }
    if (ok && known) return true;
  }
  return false;
}

function readLockfile() {
  const lockPath = path.join(process.cwd(), 'pnpm-lock.yaml');
  const raw = fs.readFileSync(lockPath, 'utf8');
  const installed = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^ {2}\/([^\n]+?):$/.exec(line);
    if (!match) continue;
    let spec = match[1];
    const paren = spec.indexOf('(');
    if (paren !== -1) spec = spec.slice(0, paren);
    const at = spec.lastIndexOf('@');
    if (at <= 0) continue;
    const name = spec.slice(0, at);
    const version = spec.slice(at + 1);
    if (!/^\d/.test(version)) continue;
    if (!installed.has(name)) installed.set(name, new Set());
    installed.get(name).add(version);
  }
  return installed;
}

async function fetchAdvisories(names, installed) {
  const advisories = {};
  const batchSize = 120;
  for (let i = 0; i < names.length; i += batchSize) {
    const chunk = names.slice(i, i + batchSize);
    const body = {};
    for (const name of chunk) body[name] = [...installed.get(name)];
    const response = await fetch(`${registry}/-/npm/v1/security/advisories/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`advisory 接口返回 ${response.status}：${(await response.text()).slice(0, 200)}`);
    }
    Object.assign(advisories, await response.json());
  }
  return advisories;
}

const installed = readLockfile();
const advisories = await fetchAdvisories([...installed.keys()], installed);

const findings = [];
for (const [name, entries] of Object.entries(advisories)) {
  for (const advisory of entries) {
    const hits = [...(installed.get(name) || [])].filter(
      (version) => satisfies(version, advisory.vulnerable_versions) === true,
    );
    if (!hits.length) continue;
    findings.push({
      name,
      installed: hits.join(', '),
      severity: advisory.severity,
      range: advisory.vulnerable_versions,
      title: advisory.title,
      url: advisory.url,
    });
  }
}

findings.sort(
  (a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0) || a.name.localeCompare(b.name),
);

if (!findings.length) {
  console.log('[dep-audit] 未发现已知漏洞告警');
} else {
  console.log(`[dep-audit] 仍有 ${findings.length} 条告警，涉及 ${new Set(findings.map((f) => f.name)).size} 个包：`);
  for (const finding of findings) {
    console.log(
      `  ${finding.severity.padEnd(8)} ${finding.name.padEnd(28)} ${finding.installed.padEnd(16)} ${finding.range}`,
    );
    console.log(`           ${finding.title}`);
    if (finding.url) console.log(`           ${finding.url}`);
  }
}

const threshold = severityRank[failOn];
if (threshold === undefined) process.exit(0);
const blocking = findings.filter((f) => (severityRank[f.severity] ?? 0) >= threshold);
if (blocking.length) {
  console.error(`[dep-audit] 失败：${blocking.length} 条告警达到 --fail-on ${failOn}`);
  process.exit(1);
}
