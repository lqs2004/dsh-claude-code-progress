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
    const CLIENT_BUILD = 6

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
      'detail.more': '展开其余 {count} 步',
      'detail.less': '收起',
      'detail.input': '输入',
      'detail.result': '执行结果',
      'detail.diff': '改动',
      'detail.empty': '（空）',
      'detail.loading': '读取中…',
      'thought.title': '思考',
      'thought.expand': '查看全部',
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
      'detail.more': '{count} more steps',
      'detail.less': 'Collapse',
      'detail.input': 'Input',
      'detail.result': 'Result',
      'detail.diff': 'Changes',
      'detail.empty': '(empty)',
      'detail.loading': 'Loading…',
      'thought.title': 'Thinking',
      'thought.expand': 'Show all',
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
.ccp-root{--ccp-accent:#d97757;--ccp-accent-strong:#c15f3c;--ccp-serif:Georgia,"Iowan Old Style","Palatino Linotype","Times New Roman","Microsoft YaHei",serif;--ccp-sans:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;--ccp-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;height:100%;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px;color:var(--dsw-alias-label-primary);font-family:var(--ccp-sans);font-size:12px;line-height:1.5;box-sizing:border-box}
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
.ccp-card{background:var(--dsw-alias-bg-layer-1);background:color-mix(in srgb, var(--ccp-accent) 3%, var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);border-color:color-mix(in srgb, var(--ccp-accent) 10%, var(--dsw-alias-border-l1));border-left:3px solid var(--dsw-alias-state-idle-primary);border-radius:14px;padding:11px 12px 10px;display:flex;flex-direction:column;gap:7px;box-shadow:0 2px 6px rgba(60,40,30,.06)}
.ccp-card.is-live{border-left-color:var(--ccp-accent);background:color-mix(in srgb, var(--ccp-accent) 6%, var(--dsw-alias-bg-layer-1))}
.ccp-card.is-done{border-left-color:var(--dsw-alias-state-success-primary)}
.ccp-card.is-failed{border-left-color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 5%, var(--dsw-alias-bg-layer-1))}
.ccp-card-head{display:flex;align-items:flex-start;gap:7px}
.ccp-card-head .ccp-dot{margin-top:7px}
.ccp-label{flex:1;min-width:0;font-family:var(--ccp-serif);font-size:14px;font-weight:500;letter-spacing:-.01em;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}
.ccp-duration{flex:none;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:10.5px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 7px}
.ccp-current{color:var(--dsw-alias-label-secondary);font-size:11.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.ccp-card.is-live .ccp-current{color:var(--ccp-accent);font-weight:500}
.ccp-card.is-done .ccp-current{color:var(--dsw-alias-label-primary)}
.ccp-current.is-error{color:var(--dsw-alias-state-error-primary)}
.ccp-bar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.ccp-bar>span{display:block;height:100%;background:var(--ccp-accent);border-radius:2px;transition:width .3s ease}
.ccp-todos{display:flex;flex-direction:column;gap:2px}
.ccp-todo{display:flex;gap:6px;align-items:flex-start;color:var(--dsw-alias-label-secondary);font-size:11px;min-width:0}
.ccp-todo-mark{flex:none;width:11px;text-align:center;line-height:1.5}
.ccp-todo-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ccp-todo.is-done .ccp-todo-text{text-decoration:line-through;opacity:.6}
.ccp-todo.is-active{color:var(--dsw-alias-label-primary)}
.ccp-todo.is-active .ccp-todo-mark{color:var(--ccp-accent)}
.ccp-thoughts{display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1)}
.ccp-thought-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ccp-thought-title{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.04em}
.ccp-thought-title.is-live{color:var(--ccp-accent)}
.ccp-thought-dot{width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.9}
.ccp-thought-title.is-live .ccp-thought-dot{animation:ccp-pulse 1.4s ease-in-out infinite}
.ccp-thought{font-size:10.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.ccp-thought.is-clamped{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.ccp-steps{display:flex;flex-direction:column;gap:2px}
.ccp-step{display:flex;flex-direction:column;gap:2px;min-width:0;border-radius:7px}
.ccp-step.is-openable{cursor:pointer}
.ccp-step.is-openable:hover{background:var(--dsw-alias-bg-layer-2)}
.ccp-step-row{display:flex;gap:6px;align-items:baseline;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:0;padding:1px 3px}
.ccp-step-time{flex:none;font-variant-numeric:tabular-nums;opacity:.7;width:32px}
.ccp-step-name{flex:none;font-family:var(--ccp-mono);font-size:10px;font-weight:600;line-height:1.6;padding:0 5px;border-radius:5px;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ccp-tool-bash{background:color-mix(in srgb, var(--ccp-accent) 16%, transparent);color:var(--ccp-accent)}
.ccp-tool-edit{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 20%, transparent);color:var(--dsw-alias-state-warn-primary)}
.ccp-tool-read{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);color:var(--dsw-alias-state-success-primary)}
.ccp-step-detail{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ccp-step-ok{flex:none;color:var(--dsw-alias-state-success-primary)}
.ccp-step-bad{flex:none;color:var(--dsw-alias-state-error-primary)}
.ccp-step-live{flex:none;color:var(--ccp-accent);animation:ccp-pulse 1.4s ease-in-out infinite}
.ccp-chev{flex:none;opacity:.55;font-size:9px;width:8px}
.ccp-step-preview{margin:0 3px 2px 41px;padding:2px 7px;border-radius:0 6px 6px 0;border-left:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);font-size:10.5px;line-height:1.45;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;white-space:pre-wrap}
.ccp-step-preview.is-ok{border-left-color:var(--dsw-alias-state-success-primary)}
.ccp-step-preview.is-bad{border-left-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.ccp-delta{flex:none;font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums;padding:0 4px;border-radius:4px;line-height:1.6}
.ccp-delta.is-add{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent)}
.ccp-delta.is-del{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent)}
.ccp-diff{margin:0 0 7px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;overflow:auto;max-height:260px;background:var(--dsw-alias-bg-base)}
.ccp-diff-line{display:flex;gap:6px;font-family:var(--ccp-mono);font-size:10.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;padding:0 6px}
.ccp-diff-line.is-add{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);color:var(--dsw-alias-state-success-primary)}
.ccp-diff-line.is-del{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);color:var(--dsw-alias-state-error-primary)}
.ccp-diff-line.is-ctx{color:var(--dsw-alias-label-secondary);opacity:.75}
.ccp-diff-sign{flex:none;width:9px;text-align:center;font-weight:700;opacity:.9}
.ccp-diff-text{flex:1;min-width:0}
.ccp-detail{margin:2px 3px 6px 41px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);min-width:0}
.ccp-detail-label{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin:0 0 3px;font-weight:600}
.ccp-detail-label.is-input{color:var(--ccp-accent)}
.ccp-detail-label.is-result{color:var(--dsw-alias-state-success-primary)}
.ccp-detail-muted{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.ccp-pre{margin:0 0 7px;padding:6px 7px;border-radius:8px;background:var(--dsw-alias-bg-base);border:.5px solid var(--dsw-alias-border-l2);font-family:var(--ccp-mono);font-size:10.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;color:var(--dsw-alias-label-primary)}
.ccp-pre:last-child{margin-bottom:0}
.ccp-more{border:0;background:none;color:var(--ccp-accent-strong);font:inherit;font-size:11px;padding:0;cursor:pointer;text-align:left}
.ccp-more:hover{text-decoration:underline}
.ccp-foot{display:flex;flex-wrap:wrap;gap:4px 6px;color:var(--dsw-alias-label-secondary);font-size:10.5px;border-top:.5px solid var(--dsw-alias-border-l1);padding-top:7px}
.ccp-stat{background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 7px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.ccp-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px 18px;text-align:center;color:var(--dsw-alias-label-secondary);box-sizing:border-box}
.ccp-empty-title{font-family:var(--ccp-serif);color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500}
.ccp-empty-hint{font-size:11.5px;line-height:1.65;max-width:270px}
.ccp-empty-art{width:46px;height:46px;color:var(--ccp-accent);opacity:.9;margin-bottom:2px}
.ccp-error{margin:4px 2px;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:11px;word-break:break-word}
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

    function formatTokens(value) {
      const count = Number(value) || 0
      if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
      if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
      return String(count)
    }

    /** Colour family of a tool name, for the step pill. */
    function toolKind(tool) {
      const name = String(tool ?? '')
      if (name === 'Bash' || name === 'BashOutput') return 'bash'
      if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') return 'edit'
      if (name === 'Read' || name === 'Glob' || name === 'Grep') return 'read'
      return 'other'
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
      const canOpen = step.kind === 'tool'
      const detail = useStepDetail(run.id, step.seq, open && canOpen)
      const isSay = step.kind === 'say'
      const label = isSay ? t('step.say') : String(step.tool ?? '')
      const text = isSay ? String(step.text ?? '') : String(step.detail ?? '')
      const status = step.status === 'error' ? 'bad' : step.status === 'running' ? 'live' : 'ok'
      const toggle = () => {
        if (canOpen) setOpen((value) => !value)
      }
      return h('div', { className: `ccp-step${canOpen ? ' is-openable' : ''}` },
        h('div', {
          className: 'ccp-step-row',
          role: canOpen ? 'button' : undefined,
          tabIndex: canOpen ? 0 : undefined,
          title: canOpen ? t('step.hint') : text,
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
          h('span', { className: 'ccp-step-time' }, formatOffset(step.at, startedAt)),
          h('span', { className: `ccp-step-name ccp-tool-${toolKind(step.tool)}`, title: label }, label),
          h('span', { className: 'ccp-step-detail', title: text }, text),
          (step.added ?? 0) > 0 ? h('span', { className: 'ccp-delta is-add' }, `+${step.added}`) : null,
          (step.removed ?? 0) > 0 ? h('span', { className: 'ccp-delta is-del' }, `−${step.removed}`) : null,
          status === 'bad' ? h('span', { className: 'ccp-step-bad' }, '✕') : status === 'live' ? h('span', { className: 'ccp-step-live' }, '·') : h('span', { className: 'ccp-step-ok' }, '✓'),
          canOpen ? h('span', { className: 'ccp-chev' }, open ? '▾' : '▸') : null,
        ),
        !open && step.inputPreview ? h('div', { className: 'ccp-step-preview' }, step.inputPreview) : null,
        !open && step.resultPreview ? h('div', {
          className: `ccp-step-preview${step.status === 'error' ? ' is-bad' : ' is-ok'}`,
        }, step.resultPreview) : null,
        open ? h(StepDetail, { detail, t }) : null,
      )
    }

    function Thoughts({ run, t }) {
      const thoughts = Array.isArray(run.thoughts) ? run.thoughts : []
      const [expanded, setExpanded] = useState(false)
      if (thoughts.length === 0) return null
      const live = run.status === 'running' && run.phase === 'thinking'
      const shown = expanded ? thoughts : thoughts.slice(-1)
      return h('div', { className: 'ccp-thoughts' },
        h('div', { className: 'ccp-thought-head' },
          h('span', { className: `ccp-thought-title${live ? ' is-live' : ''}` },
            h('span', { className: 'ccp-thought-dot' }),
            `${t('thought.title')} · ${thoughts.length}`),
          thoughts.length > 1
            ? h('button', {
                type: 'button',
                className: 'ccp-more',
                onClick: () => setExpanded((value) => !value),
              }, expanded ? t('detail.less') : t('thought.expand'))
            : null,
        ),
        ...shown.map((thought, index) => h('div', {
          key: `${thought.at}-${index}`,
          className: `ccp-thought${expanded ? '' : ' is-clamped'}`,
        }, thought.text)),
      )
    }

    function RunCard({ run, now, t }) {
      const [expanded, setExpanded] = useState(false)
      const live = run.status === 'running' || run.status === 'starting'
      const steps = Array.isArray(run.steps) ? run.steps : []
      const visibleCount = expanded ? steps.length : 3
      const shown = steps.slice(-visibleCount)
      const hiddenCount = steps.length - shown.length
      const duration = live ? Math.max(0, now - run.startedAt) : run.durationMs
      const usage = run.usage
      const tokens = usage === null || usage === undefined ? 0 : (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0)
      const phaseText = run.status === 'starting' ? t('phase.starting') : run.phase === 'thinking' ? t('phase.thinking') : run.phase === 'tool' ? t('phase.tool') : ''
      const current = live
        ? (run.lastAction !== '' ? run.lastAction : phaseText)
        : (run.status === 'failed' ? (run.error !== '' ? run.error : t('phase.failed')) : (run.resultText !== '' ? run.resultText : t('phase.done')))
      const chips = []
      chips.push(t('stats.steps', { count: run.stepCount ?? steps.length }))
      if ((run.fileCount ?? 0) > 0) chips.push(t('stats.files', { count: run.fileCount }))
      if (tokens > 0) chips.push(t('stats.tokens', { count: formatTokens(tokens) }))
      if (typeof run.costUsd === 'number' && run.costUsd > 0) chips.push(t('stats.cost', { cost: run.costUsd.toFixed(2) }))

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
        shown.length === 0 ? null : h('div', { className: 'ccp-steps' }, ...shown.map((step, index) => h(Step, {
          key: `${index}-${step.seq ?? step.at}`,
          run,
          step,
          startedAt: run.startedAt,
          t,
        }))),
        hiddenCount > 0 || expanded ? h('button', {
          type: 'button',
          className: 'ccp-more',
          onClick: () => setExpanded((value) => !value),
        }, expanded ? t('detail.less') : t('detail.more', { count: hiddenCount })) : null,
        h('div', { className: 'ccp-foot' }, ...chips.map((chip) => h('span', { key: chip, className: 'ccp-stat' }, chip))),
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
        let visible = true
        if (typeof props.useTabInfo === 'function') {
          try {
            visible = props.useTabInfo().tab.visible
          } catch {
            visible = true
          }
        }
        const { runs, loading, error, meta } = useRuns(sessionId, visible, 1000, 'panel')
        const live = runs.some((run) => run.status === 'running' || run.status === 'starting')
        const now = useNow(live)
        const activeCount = runs.filter((run) => run.status === 'running' || run.status === 'starting').length
        const finished = runs.length - activeCount
        const tapProblem = meta !== null && typeof meta.tapError === 'string' && meta.tapError !== ''

        return h('div', { className: 'ccp-root' },
          h('style', null, css),
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
