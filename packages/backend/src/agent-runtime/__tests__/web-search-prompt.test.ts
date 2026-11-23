import { WEB_SEARCH_GUIDANCE_PROMPT } from '../web-search-prompt'

describe('web search guidance prompt', () => {
  it('limits recent-news searches to a real time window and demands provenance', () => {
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('time_range')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('媒体名与发布日期')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('发布日期未知')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('原文链接')
  })

  it('keeps named-media requests on the requested domains instead of substituting other outlets', () => {
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('domains')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('该来源没有可用报道')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('不要改用其它媒体替代')
  })

  it('separates a real no-hit from a source that could not be reached', () => {
    // 只有 empty / no_results / no_results_in_restricted_sources 才允许说没有报道
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('empty')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('no_results')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('no_results_in_restricted_sources')
    // 读取失败/无内容/请求非法 归入「暂时未能核实」，不是没有报道
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('read_failed')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('no_content')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('invalid_request')
    // 失败、超时、日期未知只能说暂时未能核实
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('all_sources_timed_out')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('该来源暂时未能核实')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('不得说成没有报道')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('domains_outside_whitelist')
  })

  it('asks for an explicit refresh with fresh: true instead of reusing stale results', () => {
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('重新检索')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('原站核对')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('不要复用旧结果')
    // 刷新必须用检索侧定名的复用绕过参数
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('fresh: true')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('普通 read_url')
  })

  it('closes on verified / conflicting / unverified evidence without inventing work', () => {
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('已核实')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('冲突')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('未核实')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('不要声称执行过没有发生的搜索或读取')
  })

  it('keeps the read_url escalation for first-party verification', () => {
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('read_url')
    expect(WEB_SEARCH_GUIDANCE_PROMPT).toContain('网页正文证据')
  })
})
