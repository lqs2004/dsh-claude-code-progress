/**
 * Client half: one right-Sidebar tab type that renders the progress model the
 * Host half publishes. It polls the same-origin snapshot route once a second
 * while the tab is actually visible; the Host keeps the runs, so closing the
 * tab costs nothing and reopening it resumes from the current state.
 */

window.__ModuleLoader__.load({
  id: '@local/claude-code-progress',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const TAB_ID = '@local/claude-code-progress'
    const TAB_KIND = 'claude-code-progress'
    /** Bumped whenever the panel needs to prove it is running fresh code. */
    const CLIENT_BUILD = 14

    const zh = {
      'tab.title': 'Claude Code',
      'tab.description': '委派任务的实时进度',
      'summary.running': '{count} 个运行中',
      'summary.done': '{count} 个已结束',
      'empty.title': '没有正在运行的 Claude Code',
      'empty.hint': '在这个会话里委派给 Claude Code 的任务会出现在这里：当前步骤、待办进度、时间线和 token 用量。',
      'empty.loading': '正在读取…',
      'phase.starting': '启动中…',
      'phase.thinking': '思考中…',
      'phase.tool': '执行中…',
      'phase.done': '已完成',
      'phase.failed': '失败',
      'step.say': '输出',
      'todo.progress': '待办 {done}/{total}',
      'stats.steps': '{count} 步',
      'stats.files': '{count} 个文件',
      'stats.tokens': '{count} tok',
      'stats.cost': '${cost}',
      'stats.tasks': '{count} 个任务',
      'stats.total': '合计',
      'stats.detail': '明细',
      'status.running': '运行中',
      'detail.more': '展开其余 {count} 步',
      'detail.less': '收起',
      'detail.input': '输入',
      'detail.result': '执行结果',
      'detail.diff': '改动',
      'detail.empty': '（空）',
      'detail.loading': '读取中…',
      'thought.title': 'Thinking',
      'panel.hint': '只显示本会话 · 已结束任务保留 30 分钟',
      'delivery.done': '交付',
      'delivery.failed': '失败',
      'step.hint': '点击查看完整输入与执行结果',
      'error.fetch': '读取进度失败：{message}',
      'error.tap': '进度采集没有挂上：{message}',
      'retry': '重试',
      'duration.seconds': '{seconds}秒',
      'duration.minutes': '{minutes}分{seconds}秒',
      'duration.hours': '{hours}时{minutes}分',
    }

    const en = {
      'tab.title': 'Claude Code',
      'tab.description': 'Live progress for delegated tasks',
      'summary.running': '{count} running',
      'summary.done': '{count} finished',
      'empty.title': 'No Claude Code running',
      'empty.hint': 'Tasks delegated to Claude Code from this session appear here with the current step, todo progress, a timeline and token usage.',
      'empty.loading': 'Loading…',
      'phase.starting': 'Starting…',
      'phase.thinking': 'Thinking…',
      'phase.tool': 'Working…',
      'phase.done': 'Done',
      'phase.failed': 'Failed',
      'step.say': 'said',
      'todo.progress': 'Todos {done}/{total}',
      'stats.steps': '{count} steps',
      'stats.files': '{count} files',
      'stats.tokens': '{count} tok',
      'stats.cost': '${cost}',
      'stats.tasks': '{count} tasks',
      'stats.total': 'Total',
      'stats.detail': 'Details',
      'status.running': 'Running',
      'detail.more': '{count} more steps',
      'detail.less': 'Collapse',
      'detail.input': 'Input',
      'detail.result': 'Result',
      'detail.diff': 'Changes',
      'detail.empty': '(empty)',
      'detail.loading': 'Loading…',
      'thought.title': 'Thinking',
      'panel.hint': 'This session only · finished tasks kept for 30 minutes',
      'delivery.done': 'Delivered',
      'delivery.failed': 'Failed',
      'step.hint': 'Click to see the full input and result',
      'error.fetch': 'Could not read progress: {message}',
      'error.tap': 'Progress capture is not attached: {message}',
      'retry': 'Retry',
      'duration.seconds': '{seconds}s',
      'duration.minutes': '{minutes}m {seconds}s',
      'duration.hours': '{hours}h {minutes}m',
    }

    const dictionaries = { zh, en }
    /** Sessions whose panel was already opened once for a live run. */
    const autoOpened = new Set()

    const css = `
.ccp-root{--ccp-accent:#d97757;--ccp-accent-strong:#c15f3c;--ccp-serif:Georgia,"Iowan Old Style","Palatino Linotype","Times New Roman","Microsoft YaHei",serif;--ccp-sans:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;--ccp-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;height:100%;overflow:hidden;padding:10px 10px 6px;display:flex;flex-direction:column;gap:0;color:var(--dsw-alias-label-primary);font-family:var(--ccp-sans);font-size:12.5px;line-height:1.5;box-sizing:border-box}
.ccp-scroll{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}
.ccp-statusbar{flex:none;display:flex;align-items:center;gap:8px;width:100%;margin-top:8px;padding:7px 2px 2px;border:0;border-top:.5px solid var(--dsw-alias-border-l1);background:none;font:inherit;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;font-variant-numeric:tabular-nums}
.ccp-statusbar:hover{color:var(--dsw-alias-label-primary)}
.ccp-status-main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ccp-status-detail{flex:none;opacity:.8}
.ccp-breakdown{flex:none;max-height:180px;overflow:auto;display:flex;flex-direction:column;gap:4px;padding:4px 2px 6px;border-top:.5px solid var(--dsw-alias-border-l1)}
.ccp-bd-row{display:flex;align-items:baseline;gap:6px;font-size:11px;min-width:0;font-variant-numeric:tabular-nums}
.ccp-bd-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);align-self:center}
.ccp-bd-dot.is-running{background:var(--ccp-accent)}
.ccp-bd-dot.is-done{background:var(--dsw-alias-state-success-primary)}
.ccp-bd-dot.is-failed{background:var(--dsw-alias-state-error-primary)}
.ccp-bd-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.ccp-bd-stats{flex:none;color:var(--dsw-alias-label-secondary)}
.ccp-bd-total{border-top:.5px solid var(--dsw-alias-border-l1);padding-top:5px;margin-top:2px}
.ccp-bd-total .ccp-bd-label{font-weight:600}
.ccp-summary{display:flex;align-items:center;gap:12px;padding:2px 2px 0;color:var(--dsw-alias-label-secondary);font-size:11px}
.ccp-brand{display:inline-flex;align-items:center;gap:6px;font-family:var(--ccp-serif);font-size:12px;color:var(--dsw-alias-label-secondary);letter-spacing:.01em}
.ccp-brand .ccp-spark{color:var(--ccp-accent)}
.ccp-summary-count{display:inline-flex;align-items:center;gap:12px;margin-left:auto}
.ccp-summary-live{display:inline-flex;align-items:center;gap:6px;color:var(--ccp-accent);font-weight:600}
.ccp-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none;display:inline-block}
.ccp-dot.is-running{background:var(--ccp-accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--ccp-accent) 24%, transparent);animation:ccp-pulse 1.4s ease-in-out infinite}
.ccp-dot.is-done{background:var(--dsw-alias-state-success-primary)}
.ccp-dot.is-failed{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, transparent)}
@keyframes ccp-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.ccp-card{display:flex;flex-direction:column;gap:7px;padding:12px 0 14px;background:transparent;border:0;border-top:.5px solid var(--dsw-alias-border-l1);border-radius:0;box-shadow:none}
.ccp-card.is-live{border-top-color:color-mix(in srgb, var(--ccp-accent) 35%, var(--dsw-alias-border-l1))}
.ccp-card.is-done{border-top-color:var(--dsw-alias-border-l1)}
.ccp-card.is-failed{border-top-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, var(--dsw-alias-border-l1))}
.ccp-card-head{display:flex;align-items:flex-start;gap:7px}
.ccp-card-head .ccp-dot{margin-top:7px}
.ccp-label{flex:1;min-width:0;font-family:var(--ccp-serif);font-size:15px;font-weight:500;letter-spacing:-.01em;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}
.ccp-duration{flex:none;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:11px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 7px}
.ccp-current{color:var(--dsw-alias-label-secondary);font-size:12.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.ccp-card.is-live .ccp-current{color:var(--ccp-accent);font-weight:500}
.ccp-card.is-done .ccp-current{color:var(--dsw-alias-label-primary)}
.ccp-current.is-error{color:var(--dsw-alias-state-error-primary)}
.ccp-bar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.ccp-bar>span{display:block;height:100%;background:var(--ccp-accent);border-radius:2px;transition:width .3s ease}
.ccp-todos{display:flex;flex-direction:column;gap:2px}
.ccp-todo{display:flex;gap:6px;align-items:flex-start;color:var(--dsw-alias-label-secondary);font-size:11.5px;min-width:0}
.ccp-todo-mark{flex:none;width:11px;text-align:center;line-height:1.5}
.ccp-todo-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ccp-todo.is-done .ccp-todo-text{text-decoration:line-through;opacity:.6}
.ccp-todo.is-active{color:var(--dsw-alias-label-primary)}
.ccp-todo.is-active .ccp-todo-mark{color:var(--ccp-accent)}
.ccp-thoughts{display:flex;flex-direction:column;gap:4px}
.ccp-thoughts.is-open{padding-left:10px;border-left:2px solid color-mix(in srgb, var(--ccp-accent) 30%, transparent)}
.ccp-thought-title{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.04em;border:0;background:none;padding:0;font-family:inherit;cursor:pointer;align-self:flex-start}
.ccp-thought-title:hover{color:var(--dsw-alias-label-primary)}
.ccp-thought-title.is-live{color:var(--ccp-accent)}
.ccp-thought-dot{width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.9}
.ccp-thought-title.is-live .ccp-thought-dot{animation:ccp-pulse 1.4s ease-in-out infinite}
.ccp-thought-count{font-weight:500;font-size:10.5px;opacity:.7}
.ccp-thought-body{display:flex;flex-direction:column;gap:6px}
.ccp-thought{font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-primary);opacity:.92;white-space:pre-wrap;word-break:break-word}
.ccp-steps{display:flex;flex-direction:column;gap:3px}
.ccp-step{display:flex;flex-direction:column;gap:2px;min-width:0;border-radius:7px}
.ccp-step.is-openable{cursor:pointer}
.ccp-step.is-openable:hover{background:var(--dsw-alias-bg-layer-2)}
.ccp-step-row{display:flex;gap:6px;align-items:baseline;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0;padding:2px 3px}
.ccp-step-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary);align-self:center}
.ccp-step-dot.is-bad{background:var(--dsw-alias-state-error-primary)}
.ccp-step-dot.is-live{background:var(--ccp-accent);animation:ccp-pulse 1.4s ease-in-out infinite}
.ccp-step-name{flex:none;font-family:var(--ccp-mono);font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ccp-step-arg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.ccp-step-time{flex:none;font-size:10.5px;font-variant-numeric:tabular-nums;opacity:.75}
.ccp-say{font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-primary);opacity:.92;padding:1px 3px 1px 13px;white-space:pre-wrap;word-break:break-word}
.ccp-delivery{margin-top:8px;padding:2px 0 2px 10px;border-left:2px solid var(--dsw-alias-state-success-primary)}
.ccp-delivery.is-failed{border-left-color:var(--dsw-alias-state-error-primary)}
.ccp-delivery-label{font-size:10.5px;font-weight:600;letter-spacing:.08em;color:var(--dsw-alias-state-success-primary);margin-bottom:3px}
.ccp-delivery.is-failed .ccp-delivery-label{color:var(--dsw-alias-state-error-primary)}
.ccp-delivery-text{font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}
.ccp-chev{flex:none;opacity:.55;font-size:9px;width:8px}
.ccp-delta{flex:none;font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;padding:0 4px;border-radius:4px;line-height:1.65}
.ccp-delta.is-add{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent)}
.ccp-delta.is-del{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent)}
.ccp-diff{margin:0 0 7px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;overflow:auto;max-height:260px;background:var(--dsw-alias-bg-base)}
.ccp-diff-line{display:flex;gap:6px;font-family:var(--ccp-mono);font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;padding:0 6px}
.ccp-diff-line.is-add{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);color:var(--dsw-alias-state-success-primary)}
.ccp-diff-line.is-del{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);color:var(--dsw-alias-state-error-primary)}
.ccp-diff-line.is-ctx{color:var(--dsw-alias-label-secondary);opacity:.75}
.ccp-diff-sign{flex:none;width:9px;text-align:center;font-weight:700;opacity:.9}
.ccp-diff-text{flex:1;min-width:0}
.ccp-detail{margin:3px 3px 6px 13px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);min-width:0}
.ccp-detail-label{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin:0 0 3px;font-weight:600}
.ccp-detail-label.is-input{color:var(--ccp-accent)}
.ccp-detail-label.is-result{color:var(--dsw-alias-state-success-primary)}
.ccp-detail-muted{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.ccp-pre{margin:0 0 7px;padding:6px 7px;border-radius:8px;background:var(--dsw-alias-bg-base);border:.5px solid var(--dsw-alias-border-l2);font-family:var(--ccp-mono);font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;color:var(--dsw-alias-label-primary)}
.ccp-pre:last-child{margin-bottom:0}
.ccp-empty{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:8px;padding:40px 18px 24px;text-align:center;color:var(--dsw-alias-label-secondary);box-sizing:border-box}
.ccp-empty-title{font-family:var(--ccp-serif);color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500}
.ccp-empty-hint{font-size:12px;line-height:1.65;max-width:280px}
.ccp-empty-art{width:46px;height:46px;color:var(--ccp-accent);opacity:.9;margin-bottom:2px}
.ccp-error{margin:4px 2px;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:11.5px;word-break:break-word}
.ccp-error button{margin-top:6px;border:0;background:none;color:inherit;font:inherit;text-decoration:underline;cursor:pointer;padding:0}
.ccp-chip{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;flex:none}
.ccp-chip-wrap{--ccp-accent:#d97757;--ccp-accent-strong:#c15f3c;display:inline-flex;align-items:center}
.ccp-chip:hover{color:var(--dsw-alias-label-primary)}
.ccp-chip.has-live{color:var(--ccp-accent);background:color-mix(in srgb, var(--ccp-accent) 12%, transparent)}
.ccp-chip-count{position:absolute;top:0;right:-1px;min-width:12px;height:12px;border-radius:6px;background:var(--ccp-accent);color:#fff;font-size:9px;line-height:12px;text-align:center;padding:0 3px;font-variant-numeric:tabular-nums;font-weight:600}
`

    function format(dict, key, params) {
      const template = dict[key] ?? key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match))
    }

    function formatDuration(ms, t) {
      const total = Math.max(0, Math.round((Number(ms) || 0) / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      if (hours > 0) return t('duration.hours', { hours, minutes: String(minutes).padStart(2, '0') })
      if (minutes > 0) return t('duration.minutes', { minutes, seconds: String(seconds).padStart(2, '0') })
      return t('duration.seconds', { seconds })
    }

    function formatOffset(at, startedAt) {
      const seconds = Math.max(0, Math.round((Number(at) - Number(startedAt)) / 1000))
      return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    }

    function apiPath(sessionId, source) {
      const relative = 'plugins/claude-code-progress/snapshot'
      let path = `/${relative}`
      try {
        path = typeof document === 'undefined' ? `/${relative}` : new URL(relative, document.baseURI).pathname
      } catch {
        path = `/${relative}`
      }
      const base = sessionId === undefined || sessionId === null || sessionId === ''
        ? `${path}?all=1`
        : `${path}?sessionId=${encodeURIComponent(sessionId)}`
      const withSource = source === undefined ? base : `${base}&source=${encodeURIComponent(source)}`
      return `${withSource}&build=${CLIENT_BUILD}`
    }

    function Spark() {
      return h('svg', {
        className: 'ccp-spark',
        viewBox: '0 0 24 24',
        width: 12,
        height: 12,
        fill: 'none',
        'aria-hidden': true,
      },
        h('path', {
          d: 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
        }),
      )
    }

    function GuideIcon(props) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: 26,
        height: 26,
        fill: 'none',
        'aria-hidden': true,
        className: props?.className,
      },
        h('rect', { x: 2.5, y: 3.5, width: 19, height: 17, rx: 4, stroke: 'currentColor', strokeWidth: 1.4, opacity: 0.55 }),
        h('circle', { cx: 7, cy: 9, r: 1.6, fill: 'currentColor' }),
        h('rect', { x: 10.5, y: 7.6, width: 7, height: 2.2, rx: 1.1, fill: 'currentColor', opacity: 0.8 }),
        h('circle', { cx: 7, cy: 13.6, r: 1.6, fill: 'currentColor', opacity: 0.6 }),
        h('rect', { x: 10.5, y: 12.2, width: 5, height: 2.2, rx: 1.1, fill: 'currentColor', opacity: 0.45 }),
        h('rect', { x: 6, y: 17.2, width: 12, height: 1.8, rx: 0.9, fill: 'currentColor', opacity: 0.3 }),
      )
    }

    function useTranslate(ctx) {
      const [locale, setLocale] = useState(() => {
        const snapshot = ctx.locale.getSnapshot()
        return String(snapshot.active ?? snapshot.id ?? 'en')
      })
      useEffect(() => ctx.locale.subscribe(() => {
        const snapshot = ctx.locale.getSnapshot()
        setLocale(String(snapshot.active ?? snapshot.id ?? 'en'))
      }), [])
      const dict = String(locale).toLowerCase().startsWith('zh') ? dictionaries.zh : dictionaries.en
      return (key, params) => format(dict, key, params)
    }

    function useNow(active) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        if (!active) return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active])
      return now
    }

    function useRuns(sessionId, visible, intervalMs = 1000, source) {
      const [state, setState] = useState({ loading: true, runs: [], meta: null, error: '', failedReads: 0 })
      useEffect(() => {
        if (!visible) return undefined
        let cancelled = false
        const read = async () => {
          try {
            const response = await fetch(apiPath(sessionId, source), { cache: 'no-store' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (cancelled) return
            setState({ loading: false, runs: Array.isArray(body.runs) ? body.runs : [], meta: body.meta ?? null, error: '', failedReads: 0 })
          } catch (error) {
            if (cancelled) return
            setState((previous) => ({
              ...previous,
              loading: false,
              error: error instanceof Error ? error.message : String(error),
              failedReads: previous.failedReads + 1,
            }))
          }
        }
        read()
        const timer = setInterval(read, intervalMs)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [sessionId, visible, intervalMs, source])
      return state
    }

    function TodoList({ run, t }) {
      const todos = Array.isArray(run.todos) ? run.todos : []
      if (todos.length === 0) return null
      const done = todos.filter((todo) => todo.status === 'completed').length
      const percent = todos.length === 0 ? 0 : Math.round((done / todos.length) * 100)
      const shown = todos.slice(0, 5)
      return h('div', { className: 'ccp-todos' },
        h('div', { className: 'ccp-bar', title: t('todo.progress', { done, total: todos.length }) }, h('span', { style: { width: `${percent}%` } })),
        ...shown.map((todo, index) => h('div', {
          key: `${index}-${todo.content}`,
          className: `ccp-todo${todo.status === 'completed' ? ' is-done' : todo.status === 'in_progress' ? ' is-active' : ''}`,
        },
          h('span', { className: 'ccp-todo-mark' }, todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '▸' : '○'),
          h('span', { className: 'ccp-todo-text', title: todo.content }, todo.content),
        )),
      )
    }

    function stepPath(runId, seq) {
      const relative = 'plugins/claude-code-progress/step'
      let path = `/${relative}`
      try {
        path = typeof document === 'undefined' ? `/${relative}` : new URL(relative, document.baseURI).pathname
      } catch {
        path = `/${relative}`
      }
      return `${path}?runId=${encodeURIComponent(runId)}&seq=${encodeURIComponent(seq)}`
    }

    /** Read one step's captured input/result once and keep it for the page. */
    const stepCache = new Map()

    function useStepDetail(runId, seq, enabled) {
      const key = `${runId}:${seq}`
      const [state, setState] = useState(() => (stepCache.has(key)
        ? { loading: false, data: stepCache.get(key), error: '' }
        : { loading: false, data: null, error: '' }))
      useEffect(() => {
        if (!enabled) return undefined
        const cached = stepCache.get(key)
        if (cached !== undefined) {
          setState({ loading: false, data: cached, error: '' })
          return undefined
        }
        let cancelled = false
        setState({ loading: true, data: null, error: '' })
        fetch(stepPath(runId, seq), { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((body) => {
            stepCache.set(key, body)
            if (!cancelled) setState({ loading: false, data: body, error: '' })
          })
          .catch((error) => {
            if (!cancelled) setState({ loading: false, data: null, error: error instanceof Error ? error.message : String(error) })
          })
        return () => {
          cancelled = true
        }
      }, [enabled, key, runId, seq])
      return state
    }

    function DiffView({ diff }) {
      return h('div', { className: 'ccp-diff' }, ...diff.lines.map((line, index) => h('div', {
        key: `${index}-${line.t}`,
        className: `ccp-diff-line is-${line.t}`,
      },
        h('span', { className: 'ccp-diff-sign' }, line.t === 'add' ? '+' : line.t === 'del' ? '−' : ' '),
        h('span', { className: 'ccp-diff-text' }, line.text === '' ? ' ' : line.text),
      )))
    }

    function StepDetail({ detail, t }) {
      if (detail.loading) return h('div', { className: 'ccp-detail' }, h('div', { className: 'ccp-detail-muted' }, t('detail.loading')))
      if (detail.error !== '') {
        return h('div', { className: 'ccp-detail' }, h('div', { className: 'ccp-detail-muted' }, t('error.fetch', { message: detail.error })))
      }
      const data = detail.data ?? {}
      const input = String(data.input ?? '')
      const result = String(data.result ?? '')
      const diff = data.diff
      if (diff !== null && diff !== undefined && Array.isArray(diff.lines) && diff.lines.length > 0) {
        return h('div', { className: 'ccp-detail' },
          h('div', { className: 'ccp-detail-label is-input' }, t('detail.diff')),
          h(DiffView, { diff }),
          h('div', { className: 'ccp-detail-label is-result' }, t('detail.result')),
          h('pre', { className: 'ccp-pre' }, result === '' ? t('detail.empty') : result),
        )
      }
      return h('div', { className: 'ccp-detail' },
        h('div', { className: 'ccp-detail-label is-input' }, t('detail.input')),
        h('pre', { className: 'ccp-pre' }, input === '' ? t('detail.empty') : input),
        h('div', { className: 'ccp-detail-label is-result' }, t('detail.result')),
        h('pre', { className: 'ccp-pre' }, result === '' ? t('detail.empty') : result),
      )
    }

    function Step({ run, step, startedAt, t }) {
      const [open, setOpen] = useState(false)
      if (step.kind === 'say') {
        return h('div', { className: 'ccp-say' }, String(step.text ?? ''))
      }
      const canOpen = step.kind === 'tool'
      const detail = useStepDetail(run.id, step.seq, open && canOpen)
      const label = String(step.tool ?? '')
      const arg = String(step.detail ?? '')
      const status = step.status === 'error' ? 'bad' : step.status === 'running' ? 'live' : 'ok'
      const toggle = () => {
        if (canOpen) setOpen((value) => !value)
      }
      return h('div', { className: `ccp-step${canOpen ? ' is-openable' : ''}` },
        h('div', {
          className: 'ccp-step-row',
          role: canOpen ? 'button' : undefined,
          tabIndex: canOpen ? 0 : undefined,
          title: canOpen ? t('step.hint') : arg,
          onClick: toggle,
          onKeyDown: canOpen
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggle()
                }
              }
            : undefined,
        },
          h('span', { className: `ccp-step-dot is-${status}` }),
          h('span', { className: 'ccp-step-name', title: label }, label),
          arg === '' ? h('span', { className: 'ccp-step-arg' }) : h('span', { className: 'ccp-step-arg', title: arg }, `(${arg})`),
          (step.added ?? 0) > 0 ? h('span', { className: 'ccp-delta is-add' }, `+${step.added}`) : null,
          (step.removed ?? 0) > 0 ? h('span', { className: 'ccp-delta is-del' }, `−${step.removed}`) : null,
          h('span', { className: 'ccp-step-time' }, formatOffset(step.at, startedAt)),
          canOpen ? h('span', { className: 'ccp-chev' }, open ? '▾' : '▸') : null,
        ),
        open ? h(StepDetail, { detail, t }) : null,
      )
    }

    function Thoughts({ run, t }) {
      const thoughts = Array.isArray(run.thoughts) ? run.thoughts : []
      const [expanded, setExpanded] = useState(false)
      if (thoughts.length === 0) return null
      const live = run.status === 'running' && run.phase === 'thinking'
      const label = live ? `${t('thought.title')}…` : t('thought.title')
      return h('div', { className: `ccp-thoughts${expanded ? ' is-open' : ''}` },
        h('button', {
          type: 'button',
          className: `ccp-thought-title${live ? ' is-live' : ''}`,
          'aria-expanded': expanded,
          onClick: () => setExpanded((value) => !value),
        },
          h('span', { className: 'ccp-thought-dot' }),
          label,
          h('span', { className: 'ccp-thought-count' }, `· ${thoughts.length}`),
          h('span', { className: 'ccp-chev' }, expanded ? '▾' : '▸'),
        ),
        expanded
          ? h('div', { className: 'ccp-thought-body' }, ...thoughts.map((thought, index) => h('div', {
              key: `${thought.at}-${index}`,
              className: 'ccp-thought',
            }, thought.text)))
          : null,
      )
    }

    function Delivery({ run, t }) {
      const failed = run.status === 'failed'
      const text = failed ? String(run.error ?? '') : String(run.resultText ?? '')
      if (text === '') return null
      return h('div', { className: `ccp-delivery${failed ? ' is-failed' : ''}` },
        h('div', { className: 'ccp-delivery-label' }, failed ? t('delivery.failed') : t('delivery.done')),
        h('div', { className: 'ccp-delivery-text' }, text),
      )
    }

    function RunCard({ run, now, t }) {
      const live = run.status === 'running' || run.status === 'starting'
      const steps = Array.isArray(run.steps) ? run.steps : []
      const duration = live ? Math.max(0, now - run.startedAt) : run.durationMs
      const phaseText = run.status === 'starting' ? t('phase.starting') : run.phase === 'thinking' ? t('phase.thinking') : run.phase === 'tool' ? t('phase.tool') : ''
      const current = live ? (run.lastAction !== '' ? run.lastAction : phaseText) : ''

      return h('div', { className: `ccp-card${live ? ' is-live' : run.status === 'failed' ? ' is-failed' : ' is-done'}` },
        h('div', { className: 'ccp-card-head' },
          h('span', { className: `ccp-dot ${run.status === 'failed' ? 'is-failed' : run.status === 'done' ? 'is-done' : 'is-running'}` }),
          h('span', { className: 'ccp-label', title: run.label }, run.label),
          h('span', { className: 'ccp-duration' }, formatDuration(duration, t)),
        ),
        current === '' ? null : h('div', {
          className: `ccp-current${run.status === 'failed' ? ' is-error' : run.status === 'done' ? ' is-done' : ''}`,
          title: current,
        }, current),
        h(Thoughts, { run, t }),
        h(TodoList, { run, t }),
        steps.length === 0 ? null : h('div', { className: 'ccp-steps' }, ...steps.map((step, index) => h(Step, {
          key: `${index}-${step.seq ?? step.at}`,
          run,
          step,
          startedAt: run.startedAt,
          t,
        }))),
        live ? null : h(Delivery, { run, t }),
      )
    }

    function EmptyState({ t }) {
      return h('div', { className: 'ccp-empty' },
        h(GuideIcon, { className: 'ccp-empty-art' }),
        h('div', { className: 'ccp-empty-title' }, t('empty.title')),
        h('div', { className: 'ccp-empty-hint' }, t('empty.hint')),
      )
    }

    function makeHeaderChip(ctx) {
      return function HeaderChip({ sessionId }) {
        const translate = useTranslate(ctx)
        const { runs } = useRuns(sessionId, true, 2500, 'chip')
        const active = runs.filter((run) => run.status === 'running' || run.status === 'starting')
        const live = active.length > 0
        const action = live ? String(active[0].lastAction ?? '') : ''
        const summary = live
          ? `${translate('tab.title')} · ${translate('summary.running', { count: active.length })}${action === '' ? '' : ` · ${action}`}`
          : translate('tab.title')
        useEffect(() => {
          if (!live) return
          const key = String(sessionId ?? '')
          if (autoOpened.has(key)) return
          autoOpened.add(key)
          try {
            ctx.sidebarRight.openTab(TAB_KIND)
          } catch (error) {
            console.error('[claude-code-progress] auto-open failed', error)
          }
        }, [live, sessionId])
        const open = () => {
          try {
            ctx.sidebarRight.openTab(TAB_KIND)
          } catch (error) {
            console.error('[claude-code-progress] opening the tab failed', error)
          }
        }
        return h('span', { className: 'ccp-chip-wrap' },
          h('style', null, css),
          h('button', {
            type: 'button',
            className: `ccp-chip${live ? ' has-live' : ''}`,
            title: summary,
            'aria-label': summary,
            onClick: open,
          },
            h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', 'aria-hidden': true },
              h('rect', { x: 2.6, y: 4.2, width: 18.8, height: 15.6, rx: 3.6, stroke: 'currentColor', strokeWidth: 1.5, opacity: 0.6 }),
              h('path', { d: 'M6.6 9.4l2.6 2.5-2.6 2.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
              h('path', { d: 'M11.8 14.4h5.2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', opacity: 0.75 }),
            ),
            live ? h('span', { className: 'ccp-chip-count' }, active.length) : null,
          ),
        )
      }
    }

    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        console.error('[claude-code-progress] panel render failed', error)
      }

      render() {
        if (this.state.error !== null) {
          const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error)
          return h('div', { className: 'ccp-error' }, `进度面板渲染失败 / Progress panel failed: ${message}`)
        }
        return this.props.children
      }
    }

    function apply(ctx) {
      const HeaderChip = makeHeaderChip(ctx)
      const t = (key, params) => {
        const snapshot = ctx.locale.getSnapshot()
        const id = String(snapshot.active ?? snapshot.id ?? 'en').toLowerCase()
        return format(id.startsWith('zh') ? dictionaries.zh : dictionaries.en, key, params)
      }

      function Monitor(props) {
        const { sessionId } = props
        const translate = useTranslate(ctx)
        const [showBreakdown, setShowBreakdown] = useState(false)
        let visible = true
        if (typeof props.useTabInfo === 'function') {
          try {
            visible = props.useTabInfo().tab.visible
          } catch {
            visible = true
          }
        }
        const { runs, loading, error, meta } = useRuns(sessionId, visible, 1000, 'panel')
        const activeRun = runs.find((run) => run.status === 'running' || run.status === 'starting')
        const live = activeRun !== undefined
        const now = useNow(live)
        const activeCount = runs.filter((run) => run.status === 'running' || run.status === 'starting').length
        const finished = runs.length - activeCount
        const tapProblem = meta !== null && typeof meta.tapError === 'string' && meta.tapError !== ''

        const totals = runs.reduce((acc, run) => {
          acc.steps += Number(run.stepCount) || 0
          acc.files += Number(run.fileCount) || 0
          acc.cost += Number(run.costUsd) || 0
          return acc
        }, { steps: 0, files: 0, cost: 0 })
        const activeSteps = activeRun !== undefined ? (activeRun.stepCount ?? (activeRun.steps?.length ?? 0)) : totals.steps
        const activeFiles = activeRun !== undefined ? (Number(activeRun.fileCount) || 0) : totals.files
        const activeCost = activeRun !== undefined ? (Number(activeRun.costUsd) || 0) : totals.cost
        const barText = activeRun !== undefined
          ? [
              translate('status.running'),
              translate('stats.steps', { count: activeSteps }),
              activeFiles > 0 ? translate('stats.files', { count: activeFiles }) : null,
              activeCost > 0 ? `$${activeCost.toFixed(2)}` : null,
            ].filter(Boolean).join(' · ')
          : [
              translate('stats.tasks', { count: runs.length }),
              translate('stats.steps', { count: totals.steps }),
              totals.files > 0 ? translate('stats.files', { count: totals.files }) : null,
              totals.cost > 0 ? `$${totals.cost.toFixed(2)}` : null,
            ].filter(Boolean).join(' · ')

        return h('div', { className: 'ccp-root' },
          h('style', null, css),
          h('div', { className: 'ccp-scroll' },
            runs.length === 0 ? (error === '' ? h(EmptyState, { t: translate }) : null) : h('div', { className: 'ccp-summary' },
              h('span', { className: 'ccp-brand' }, h(Spark, null), 'Claude Code'),
              h('span', { className: 'ccp-summary-count' },
                activeCount > 0
                  ? h('span', { className: 'ccp-summary-live' },
                      h('span', { className: 'ccp-dot is-running' }),
                      translate('summary.running', { count: activeCount }))
                  : null,
                finished > 0 ? h('span', null, translate('summary.done', { count: finished })) : null,
              ),
            ),
            tapProblem ? h('div', { className: 'ccp-error' }, translate('error.tap', { message: meta.tapError })) : null,
            error === ''
              ? null
              : h('div', { className: 'ccp-error' },
                  translate('error.fetch', { message: error }),
                  h('div', null, h('button', { type: 'button', onClick: () => window.location.reload() }, translate('retry'))),
                ),
            ...runs.map((run) => h(RunCard, { key: run.id, run, now, t: translate })),
            loading && runs.length === 0 ? h('div', { className: 'ccp-empty-hint' }, translate('empty.loading')) : null,
          ),
          showBreakdown && runs.length > 0 ? h('div', { className: 'ccp-breakdown' },
            ...runs.map((run) => {
              const steps = Number(run.stepCount) || (run.steps?.length ?? 0)
              const files = Number(run.fileCount) || 0
              const cost = Number(run.costUsd) || 0
              return h('div', { className: 'ccp-bd-row', key: run.id },
                h('span', { className: `ccp-bd-dot ${run.status === 'failed' ? 'is-failed' : run.status === 'done' ? 'is-done' : 'is-running'}` }),
                h('span', { className: 'ccp-bd-label', title: run.label }, run.label),
                h('span', { className: 'ccp-bd-stats' }, [
                  translate('stats.steps', { count: steps }),
                  files > 0 ? translate('stats.files', { count: files }) : null,
                  cost > 0 ? `$${cost.toFixed(2)}` : null,
                ].filter(Boolean).join(' · ')),
              )
            }),
            h('div', { className: 'ccp-bd-row ccp-bd-total' },
              h('span', { className: 'ccp-bd-label' }, translate('stats.total')),
              h('span', { className: 'ccp-bd-stats' }, [
                translate('stats.steps', { count: totals.steps }),
                totals.files > 0 ? translate('stats.files', { count: totals.files }) : null,
                totals.cost > 0 ? `$${totals.cost.toFixed(2)}` : null,
              ].filter(Boolean).join(' · ')),
            ),
          ) : null,
          runs.length > 0 ? h('button', {
            type: 'button',
            className: 'ccp-statusbar',
            'aria-expanded': showBreakdown,
            onClick: () => setShowBreakdown((value) => !value),
          },
            h('span', { className: 'ccp-status-main' }, barText),
            h('span', { className: 'ccp-status-detail' }, translate('stats.detail')),
            h('span', { className: 'ccp-chev' }, showBreakdown ? '▾' : '▸'),
          ) : null,
        )
      }

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        title: () => t('tab.title'),
        guide: [{
          id: 'progress',
          order: 30,
          title: () => t('tab.title'),
          description: () => t('tab.description'),
          icon: GuideIcon,
        }],
      }), 'claude-code-progress: tab type')

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
      }, (props) => h(Boundary, null, h(Monitor, props)))), 'claude-code-progress: tab body')

      ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'claude-code-progress',
        order: 20,
      }, HeaderChip)), 'claude-code-progress: header chip')
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'locale'],
      apply,
    }
  },
})
