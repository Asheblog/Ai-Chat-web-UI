/**
 * Markdown 流式 vs 刷新 渲染差异诊断脚本
 *
 * 用法：
 * 1. 粘贴执行 → 触发任务输出 → 流式结束后输入 __mdd_save()
 * 2. 刷新页面 → 重新粘贴执行 → 输入 __mdd_compare()
 */
;(function () {
  'use strict'
  const KEY = '__mdd_snapshot'
  const log = (...args) => console.log('%c[MD-DIFF]', 'color:#f0a030;font-weight:bold', ...args)

  function getLastBubbleHTML() {
    const panels = document.querySelectorAll('[class*="v2-panel"]')
    for (let i = panels.length - 1; i >= 0; i--) {
      const md = panels[i].querySelector('.markdown-body')
      if (md) return md.innerHTML
    }
    return null
  }

  function getAllBubbles() {
    const result = []
    document.querySelectorAll('.markdown-body').forEach((el) => {
      result.push({
        html: el.innerHTML,
        len: el.innerHTML.length,
        pending: el.classList.contains('markdown-body--pending'),
        classes: el.className,
        $$count: (el.innerHTML.match(/\$\$/g) || []).length,
        codeMarkers: (el.innerHTML.match(/AICHAT_CODE_BLOCK/g) || []).length,
        preTags: el.querySelectorAll('pre').length,
        tables: el.querySelectorAll('table').length,
      })
    })
    return result
  }

  // ── 保存当前状态到 localStorage ──
  window.__mdd_save = () => {
    const bubbles = getAllBubbles()
    if (bubbles.length === 0) { log('未找到 .markdown-body 元素'); return }
    const data = { time: Date.now(), url: location.href, bubbles }
    localStorage.setItem(KEY, JSON.stringify(data))
    log(`已保存 ${bubbles.length} 个 Markdown 元素到 localStorage`)
    bubbles.forEach((b, i) => {
      console.log(`  #${i}: len=${b.len} $$=${b.$$count} pending=${b.pending} pre=${b.preTags} tables=${b.tables}`)
    })
    log('现在刷新页面，重新粘贴脚本后输入 __mdd_compare()')
  }

  // ── 加载并对比 ──
  window.__mdd_compare = () => {
    const raw = localStorage.getItem(KEY)
    if (!raw) { log('未找到已保存的快照，请先执行 __mdd_save()'); return }

    let prev
    try { prev = JSON.parse(raw) } catch (e) { log('快照解析失败'); return }

    const curr = getAllBubbles()
    console.group('%c[MD-DIFF] 流式 vs 刷新 对比', 'font-size:15px;font-weight:bold;color:#f0a030')
    console.log(`保存时间: ${new Date(prev.time).toLocaleTimeString()}`)
    console.log(`当前时间: ${new Date().toLocaleTimeString()}`)

    // 找最后一个(最有可能是助手回复的)
    const prevLast = prev.bubbles[prev.bubbles.length - 1]
    const currLast = curr[curr.length - 1]

    if (!prevLast || !currLast) {
      log('数据不足，无法对比')
      console.groupEnd()
      return
    }

    console.log('\n--- 最后一个 Markdown 元素对比 ---')
    console.table({
      '流式-html长度': prevLast.len,
      '刷新-html长度': currLast.len,
      '流式-$$次数': prevLast.$$count,
      '刷新-$$次数': currLast.$$count,
      '流式-pending': prevLast.pending,
      '刷新-pending': currLast.pending,
      '流式-codeMarkers': prevLast.codeMarkers,
      '刷新-codeMarkers': currLast.codeMarkers,
      '流式-pre标签': prevLast.preTags,
      '刷新-pre标签': currLast.preTags,
      '流式-tables': prevLast.tables,
      '刷新-tables': currLast.tables,
    })

    if (prevLast.html === currLast.html) {
      console.log('\n✅ HTML 完全一致')
    } else {
      console.log(`\n❌ HTML 不同！长度差: ${currLast.len - prevLast.len}`)
      const minLen = Math.min(prevLast.html.length, currLast.html.length)
      let diffPos = 0
      for (; diffPos < minLen; diffPos++) {
        if (prevLast.html[diffPos] !== currLast.html[diffPos]) break
      }
      console.log(`第一个差异位置: ${diffPos} / ${minLen}`)
      console.log(`流式 @${diffPos}: ${JSON.stringify(prevLast.html.substring(diffPos, diffPos + 150))}`)
      console.log(`刷新 @${diffPos}: ${JSON.stringify(currLast.html.substring(diffPos, diffPos + 150))}`)

      // 尾部对比
      const tailLen = 300
      console.log('\n--- HTML 尾部对比 ---')
      console.log(`流式尾部: ${JSON.stringify(prevLast.html.substring(Math.max(0, prevLast.len - tailLen)))}`)
      console.log(`刷新尾部: ${JSON.stringify(currLast.html.substring(Math.max(0, currLast.len - tailLen)))}`)

      // 头部对比
      console.log('\n--- HTML 头部对比 ---')
      console.log(`流式头部: ${JSON.stringify(prevLast.html.substring(0, 200))}`)
      console.log(`刷新头部: ${JSON.stringify(currLast.html.substring(0, 200))}`)
    }

    // 所有 bubble 概览
    console.log('\n--- 全部元素概览 ---')
    console.log(`流式: ${prev.bubbles.length} 个元素`)
    console.log(`刷新: ${curr.length} 个元素`)

    console.groupEnd()
    // 清理
    localStorage.removeItem(KEY)
  }

  // 快捷：刷新前一键保存
  window.__mdd_all = () => {
    const bubbles = getAllBubbles()
    console.group('%c[MD-DIFF] 当前全部元素', 'font-weight:bold')
    console.table(bubbles.map((b, i) => ({ i, len: b.len, $$: b.$$count, pending: b.pending, pre: b.preTags, table: b.tables, classList: b.classes.substring(0, 60) })))
    bubbles.forEach((b, i) => {
      console.log(`\n#${i} (len=${b.len}) HTML头部:`, b.html.substring(0, 180))
      console.log(`#${i} HTML尾部:`, b.html.substring(Math.max(0, b.len - 180)))
    })
    console.groupEnd()
    return bubbles
  }

  // 查看渲染管线日志
  window.__mdd_render = () => {
    const log = window.__mdd_render_log || []
    if (log.length === 0) { log('无渲染记录'); return }
    console.group('%c[MD-DIFF] 渲染管线调用记录', 'font-weight:bold')
    console.table(log.map((r, i) => ({
      i,
      isStreaming: r.isStreaming,
      hasKatex: r.hasKatex,
      inputLen: r.inputLen,
      trimmedLen: r.trimmedLen,
      contentChanged: r.changed,
      tableInMarkdown: r.tableCount,
      htmlLen: r.htmlLen,
      tableInHTML: r.tableTagCount,
    })))
    // 找出 isStreaming:true 和 isStreaming:false 的差异
    const streamingCalls = log.filter(r => r.isStreaming)
    const normalCalls = log.filter(r => !r.isStreaming)
    console.log(`\n流式渲染: ${streamingCalls.length} 次, 非流式: ${normalCalls.length} 次`)
    if (streamingCalls.length > 0 && normalCalls.length > 0) {
      const lastStreaming = streamingCalls[streamingCalls.length - 1]
      const lastNormal = normalCalls[normalCalls.length - 1]
      console.log('\n最后一次流式 vs 非流式对比:')
      console.table({
        '流式-inputLen': lastStreaming.inputLen,
        '非流式-inputLen': lastNormal.inputLen,
        '流式-trimmedSame': !lastStreaming.changed,
        '非流式-trimmedSame': !lastNormal.changed,
        '流式-tableMD': lastStreaming.tableCount,
        '非流式-tableMD': lastNormal.tableCount,
        '流式-htmlLen': lastStreaming.htmlLen,
        '非流式-htmlLen': lastNormal.htmlLen,
        '流式-tableHTML': lastStreaming.tableTagCount,
        '非流式-tableHTML': lastNormal.tableTagCount,
      })
    }
    console.groupEnd()
    return log
  }

  log('就绪。流式结束后 → __mdd_save() → 刷新 → 重新粘贴脚本 → __mdd_compare()')
  log('输入 __mdd_render() 查看渲染管线调用日志')
  log('输入 __mdd_all() 查看当前所有 Markdown 元素详情')
})()
