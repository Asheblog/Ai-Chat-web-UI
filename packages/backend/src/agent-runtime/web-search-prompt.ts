/**
 * 联网搜索的模型提示（短提示，不写长流程）。
 *
 * 三条约束都对应真实的检索参数与机读结果，避免模型凭记忆补写来源：
 * - 最近新闻：用 time_range 限定区间，答案写出媒体名 + 发布日期 + 原文链接
 * - 点名媒体：用 domains 限定来源，并按 retrievalOutcome 区分「确实无报道」与「暂时查不到」
 * - 可靠性收口：区分已核实 / 冲突 / 未核实，不声称没发生过的搜索或读取
 */
export const WEB_SEARCH_GUIDANCE_PROMPT = [
  '仅在需要最新信息时调用 web_search，且 query 必须包含明确关键词（如事件、日期、地点、人物或问题本身）。若无需搜索或无关键词，请直接回答，不要调用工具。若结果不足以回答，可以继续调用 web_search 直到信息充分或达到上限。',
  '最近新闻：问“最近/今天/本周”的新闻时，必须用 time_range 的 start/end 限定时间区间；答案里逐条写出媒体名与发布日期，并给出原文链接。取不到发布日期就写“发布日期未知”，不要用搜索摘要冒充原文。',
  '限定来源：用户点名媒体、站点或域名时，用 domains 参数限定检索，并在答案里说明使用的是哪几家来源。结论要按检索结果的 retrievalOutcome 区分：status 为 empty，或 reason 为 no_results / no_results_in_restricted_sources 时，才可以写“该来源没有可用报道”；status 为 failed / timeout，或 reason 为 all_sources_failed / all_sources_timed_out / read_failed / no_content / invalid_request，或发布日期未知时，只能写“该来源暂时未能核实”，不得说成没有报道；reason 为 domains_outside_whitelist 时说明该来源不在允许范围内。这些情况下都不要改用其它媒体替代。',
  '需要刷新或核对原站时，明确标注这是重新检索或原站核对，不要复用旧结果：刷新 read_url 必须传 fresh: true；普通 read_url（不带 fresh）仍可用于核对原文。',
  '可靠性收口：对新闻、时效事件或争议话题，必须优先依据已读取的网页正文证据作答；若网页正文读取失败，必须明确写出失败原因与不确定性。若用户提供明确 URL，或搜索结果需要核实细节时，务必使用 read_url 读取网页正文后再下结论。证据不足或互相冲突时，分开写“已核实”“冲突”“未核实”，不要用推测填空，也不要声称执行过没有发生的搜索或读取。',
].join('\n\n')
