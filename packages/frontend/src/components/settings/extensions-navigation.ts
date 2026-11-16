import { routeForCard, type ExtensionSection } from "./pages/extensions/extensions-sections"

const leafBySection: Record<ExtensionSection, string> = {
  overview: "extensions",
  mcp: "extensions-mcp",
  skills: "extensions-skills",
  tools: "extensions-tools",
  extra: "extensions-extra",
}
const sectionByLeaf = new Map<string, ExtensionSection>(
  (Object.entries(leafBySection) as [ExtensionSection, string][]).map(([section, leaf]) => [leaf, section]),
)

export function getExtensionSection(leafKey: string): ExtensionSection | undefined {
  return sectionByLeaf.get(leafKey)
}

export function extensionLeafForSection(section: ExtensionSection): string {
  return leafBySection[section]
}

/** 旧扩展入口附带卡片时，与新侧栏落到同一个子页。 */
export function resolveExtensionLeaf(leafKey: string, cardKey?: string): string {
  if (!getExtensionSection(leafKey) || !cardKey) return leafKey
  const route = routeForCard(cardKey)
  return route ? extensionLeafForSection(route.section) : leafKey
}
