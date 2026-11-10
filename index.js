/**
 * Host half of the Claude Code progress panel.
 *
 * It does not implement a subagent provider. It observes the one that is
 * already installed: `@deepseek-ai/dsh-subagent-claude-code` spawns the real
 * Claude Code CLI through `ctx.subprocess.spawn`, and the SDK talks to that
 * process over NDJSON on stdout. Adding a second `data` listener to that
 * stream does not consume it — every listener receives every chunk — so the
 * provider keeps working exactly as before while we translate the same
 * messages into a small, bounded progress model.
 *
 * The model is served to the browser over one same-origin GET route. Nothing
 * here writes to the session log, so the parent Session stays free of the
 * tool traffic the provider deliberately keeps out of it.
 */

import { randomUUID } from 'node:crypto'

/** Route the Client polls while the panel is open. */
const SNAPSHOT_PATH = '/plugins/claude-code-progress/snapshot'
/** Route the Client reads one step's captured input/result from, on demand. */
const STEP_PATH = '/plugins/claude-code-progress/step'
/** Bytes kept per captured field (one tool input or one tool result). */
const DETAIL_FIELD_MAX = 16000
/** Total captured bytes kept per run; the oldest steps lose theirs first. */
const DETAIL_BUDGET = 1200000
/** Steps kept per run; the panel never needs the whole history. */
const MAX_STEPS = 240
/** Finished runs stay readable for this long. */
const RETAIN_MS = 30 * 60 * 1000
/** Hard cap on retained runs across all sessions. */
const MAX_RUNS = 80
/** Longest single text this module keeps. */
const MAX_TEXT = 2000

export const name = 'claude-code-progress'
export const inject = ['subprocess', 'webServer']

function text(value) {
  return typeof value === 'string' ? value : ''
}

function clip(value, max = MAX_TEXT) {
  const source = text(value)
  return source.length > max ? `${source.slice(0, max)}…` : source
}

function oneLine(value, max = 160) {
  return clip(text(value).replace(/\s+/gu, ' ').trim(), max)
}

function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

function basename(path) {
  const parts = text(path).split(/[\\/]/u)
  return parts[parts.length - 1] ?? ''
}

/** Whether a spawn request is the Claude Code CLI the Agent SDK drives. */
function looksLikeClaude(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return false
  if (argv.includes('stream-json')) return true
  const head = basename(argv[0]).toLowerCase()
  if (head === 'claude' || head === 'claude.exe') return true
  return head.includes('claude-agent-sdk')
}

/** The compact one-line summary shown beside a tool name. */
function toolDetail(tool, input) {
  if (!input || typeof input !== 'object') return ''
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return clip(text(input.file_path ?? input.path), 140)
    case 'Bash':
    case 'BashOutput':
      return oneLine(input.description ?? input.command, 140)
    case 'Glob':
    case 'Grep':
      return clip(text(input.pattern), 100)
    case 'WebFetch':
    case 'WebSearch':
      return clip(text(input.url ?? input.query), 120)
    case 'Task':
      return oneLine(input.description ?? input.prompt, 120)
    case 'TodoWrite':
      return Array.isArray(input.todos) ? `${input.todos.length} 项待办` : ''
    default: {
      const first = Object.values(input).find((value) => typeof value === 'string' && value.trim() !== '')
      return first === undefined ? '' : clip(first, 100)
    }
  }
}

/** Paths a tool call touched, for the "files" counter. */
function touchedPath(tool, input) {
  if (!input || typeof input !== 'object') return undefined
  if (tool === 'Read' || tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const path = input.file_path ?? input.path
    return typeof path === 'string' && path !== '' ? path : undefined
  }
  return undefined
}

/** Human-readable rendering of a tool call's input for the step detail block. */
function formatToolInput(tool, input) {
  if (!input || typeof input !== 'object') return ''
  try {
    switch (tool) {
      case 'Write':
        return `file_path: ${text(input.file_path)}\n\n${text(input.content)}`
      case 'Edit':
        return `file_path: ${text(input.file_path)}\n\n--- old ---\n${text(input.old_string)}\n\n--- new ---\n${text(input.new_string)}`
      case 'MultiEdit':
        return `file_path: ${text(input.file_path)}\n\n${JSON.stringify(input.edits ?? [], null, 2)}`
      case 'Bash':
        return input.description ? `${text(input.description)}\n\n$ ${text(input.command)}` : `$ ${text(input.command)}`
      case 'Read': {
        const offset = typeof input.offset === 'number' ? `  (offset ${input.offset}` : ''
        const limit = typeof input.limit === 'number' ? `${offset === '' ? '  (' : ', '}limit ${input.limit}` : ''
        const suffix = offset === '' ? '' : `${limit === '' ? '' : limit})`
        return `${text(input.file_path)}${offset}${limit}${suffix}`
      }
      case 'TodoWrite':
        return JSON.stringify(input.todos ?? [], null, 2)
      default:
        return JSON.stringify(input, null, 2)
    }
  } catch {
    return ''
  }
}

/** Join the text blocks of a tool result, or accept its plain string form. */
function blocksText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'image') parts.push('[image]')
  }
  return parts.join('\n')
}

const DIFF_MAX_LINES = 300
const DIFF_MAX_LINE_CHARS = 300
const DIFF_CONTEXT = 3

function splitLines(value) {
  return text(value).replace(/\r\n?/gu, '\n').split('\n')
}

function diffLine(kind, value) {
  return { t: kind, text: clip(value, DIFF_MAX_LINE_CHARS) }
}

/** Line diff for one old/new replacement: common head and tail stay as context. */
function buildDiff(oldText, newText) {
  const before = splitLines(oldText)
  const after = splitLines(newText)
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
  }

  const lines = []
  const contextStart = Math.max(0, start - DIFF_CONTEXT)
  for (let index = contextStart; index < start; index += 1) lines.push(diffLine('ctx', before[index]))
  for (let index = start; index < endBefore; index += 1) lines.push(diffLine('del', before[index]))
  for (let index = start; index < endAfter; index += 1) lines.push(diffLine('add', after[index]))
  const contextEnd = Math.min(before.length, endBefore + DIFF_CONTEXT)
  for (let index = endBefore; index < contextEnd; index += 1) lines.push(diffLine('ctx', before[index]))

  let added = endAfter - start
  let removed = endBefore - start
  if (lines.length > DIFF_MAX_LINES) {
    const kept = lines.slice(0, DIFF_MAX_LINES - 1)
    kept.push({ t: 'ctx', text: `… (${lines.length - DIFF_MAX_LINES + 1} more lines)` })
    return { lines: kept, added, removed, truncated: true }
  }
  return { lines, added, removed }
}

/** A diff view for tool calls that change file content, or null for others. */
function toolDiff(tool, input) {
  try {
    if (tool === 'Edit') return buildDiff(input.old_string, input.new_string)
    if (tool === 'Write') {
      const lines = splitLines(input.content)
      const added = lines.length
      const kept = lines.slice(0, DIFF_MAX_LINES).map((line) => diffLine('add', line))
      if (lines.length > DIFF_MAX_LINES) {
        kept.push({ t: 'ctx', text: `… (${lines.length - DIFF_MAX_LINES} more lines)` })
      }
      return { lines: kept, added, removed: 0 }
    }
    if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
      const lines = []
      let added = 0
      let removed = 0
      input.edits.forEach((edit, index) => {
        if (index > 0) lines.push({ t: 'ctx', text: `— edit ${index + 1} —` })
        const one = buildDiff(edit?.old_string, edit?.new_string)
        lines.push(...one.lines)
        added += one.added
        removed += one.removed
      })
      return { lines: lines.slice(0, DIFF_MAX_LINES), added, removed }
    }
  } catch {
    return null
  }
  return null
}

/** The task text the SDK writes to the CLI's stdin, when it is recognizable. */
function extractPrompt(buffered) {
  const lines = buffered.split('\n')
  for (const line of lines) {
    if (!line.includes('"user"')) continue
    try {
      const value = JSON.parse(line)
      const content = value?.message?.content
      if (typeof content === 'string') return oneLine(content, 200)
      if (Array.isArray(content)) {
        const part = content.find((block) => block?.type === 'text' && typeof block.text === 'string')
        if (part !== undefined) return oneLine(part.text, 200)
      }
    } catch {
      // A partial line is normal while stdin is still being written.
    }
  }
  return ''
}

function todosOf(input) {
  if (!Array.isArray(input?.todos)) return undefined
  return input.todos
    .filter((todo) => todo && typeof todo === 'object')
    .slice(0, 60)
    .map((todo) => ({
      content: oneLine(todo.content, 160),
      status: todo.status === 'completed' ? 'completed' : todo.status === 'in_progress' ? 'in_progress' : 'pending',
    }))
}

export function apply(ctx) {
  const state = {
    tapInstalled: false,
    tapError: '',
    patchCalls: 0,
    spawnsSeen: 0,
    claudeSpawns: 0,
    errors: [],
    startKeys: null,
    endKeys: null,
    reads: { panel: 0, chip: 0, other: 0, build: 0 },
    runs: new Map(),
  }

  const recordError = (value) => {
    state.errors.push(oneLine(value, 200))
    if (state.errors.length > 8) state.errors.shift()
    try {
      ctx.logger?.warn?.(`[claude-code-progress] ${messageOf(value)}`)
    } catch {
      // Logging must never break the observed process.
    }
  }

  /** Drop finished runs once their retention window is over. */
  function prune() {
    const now = Date.now()
    for (const [id, run] of state.runs) {
      if (run.endedAt !== null && now - run.endedAt > RETAIN_MS) state.runs.delete(id)
    }
    while (state.runs.size > MAX_RUNS) {
      const oldest = state.runs.values().next().value
      if (oldest === undefined || oldest.endedAt === null) break
      state.runs.delete(oldest.id)
    }
  }

  function createRun({ sessionId, cwd }) {
    return {
      id: `ccp-${randomUUID().slice(0, 8)}`,
      sessionId: sessionId ?? null,
      cwd: text(cwd),
      label: '',
      model: '',
      permissionMode: '',
      startedAt: Date.now(),
      endedAt: null,
      status: 'starting',
      phase: 'starting',
      steps: [],
      toolUse: new Map(),
      toolCounts: new Map(),
      files: new Set(),
      todos: [],
      thoughts: [],
      lastThought: '',
      liveThought: '',
      usage: null,
      costUsd: null,
      resultText: '',
      error: '',
      lastText: '',
      lastAction: '',
      stepCount: 0,
      inputBuffer: '',
      nextSeq: 0,
      details: new Map(),
      detailSeqs: [],
      detailBytes: 0,
    }
  }

  function dropDetail(run, seq) {
    const entry = run.details.get(seq)
    if (entry === undefined) return
    run.detailBytes -= detailSize(entry.input) + detailSize(entry.result) + detailSize(entry.diff)
    run.details.delete(seq)
    const at = run.detailSeqs.indexOf(seq)
    if (at >= 0) run.detailSeqs.splice(at, 1)
  }

  function detailSize(value) {
    if (typeof value === 'string') return value.length
    if (value === null || value === undefined) return 0
    try {
      return JSON.stringify(value).length
    } catch {
      return 0
    }
  }

  function addDetail(run, seq, field, value) {
    const stored = field === 'diff' ? value : clip(value, DETAIL_FIELD_MAX)
    const current = run.details.get(seq) ?? { input: '', result: '', diff: null }
    const before = detailSize(current[field])
    current[field] = stored
    run.details.set(seq, current)
    run.detailBytes += detailSize(stored) - before
    if (!run.detailSeqs.includes(seq)) run.detailSeqs.push(seq)
    while (run.detailBytes > DETAIL_BUDGET && run.detailSeqs.length > 0) {
      dropDetail(run, run.detailSeqs[0])
    }
  }

  function pushStep(run, step) {
    if (run.steps.length >= MAX_STEPS) {
      const dropped = run.steps.shift()
      if (dropped !== undefined) dropDetail(run, dropped.seq)
    }
    const stored = { ...step, seq: run.nextSeq }
    run.nextSeq += 1
    run.steps.push(stored)
    return stored
  }

  function handleToolUse(run, block) {
    const tool = text(block.name)
    const input = block.input && typeof block.input === 'object' ? block.input : {}
    const detail = toolDetail(tool, input)
    const step = pushStep(run, {
      at: Date.now(),
      kind: 'tool',
      tool,
      detail,
      status: 'running',
    })
    addDetail(run, step.seq, 'input', formatToolInput(tool, input))
    if (tool === 'Write') step.inputPreview = oneLine(text(input.content), 120)
    const diff = toolDiff(tool, input)
    if (diff !== null && diff.lines.length > 0) {
      step.added = diff.added
      step.removed = diff.removed
      addDetail(run, step.seq, 'diff', diff)
    }
    run.stepCount += 1
    run.toolCounts.set(tool, (run.toolCounts.get(tool) ?? 0) + 1)
    const path = touchedPath(tool, input)
    if (path !== undefined && run.files.size < 200) run.files.add(path)
    if (tool === 'TodoWrite') {
      const todos = todosOf(input)
      if (todos !== undefined) run.todos = todos
    }
    if (typeof block.id === 'string') run.toolUse.set(block.id, step)
    run.phase = 'tool'
    run.lastAction = detail === '' ? tool : `${tool} · ${detail}`
    run.status = 'running'
  }

  function pushThought(run, value) {
    const content = text(value)
    if (content.trim() === '') return
    run.thoughts.push({ at: Date.now(), text: clip(content, 4000) })
    if (run.thoughts.length > 12) run.thoughts.shift()
    run.lastThought = oneLine(content, 200)
    run.phase = 'thinking'
    if (run.status === 'starting') run.status = 'running'
  }

  function handleAssistant(run, message) {
    if (run.liveThought !== '') {
      pushThought(run, run.liveThought)
      run.liveThought = ''
    }
    const content = message?.message?.content
    const blocks = Array.isArray(content) ? content : []
    let said = ''
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        said = block.text
        if (run.steps.filter((step) => step.kind === 'say').length < 30) {
          pushStep(run, { at: Date.now(), kind: 'say', text: clip(block.text, 320), status: 'ok' })
        }
      } else if (block.type === 'tool_use') {
        handleToolUse(run, block)
      } else if (block.type === 'thinking') {
        pushThought(run, block.thinking ?? block.text ?? '')
      }
    }
    if (said !== '') run.lastText = oneLine(said, 240)
    if (run.status === 'starting') {
      run.status = 'running'
      run.phase = run.phase === 'starting' ? 'thinking' : run.phase
    }
  }

  /** Partial frames only arrive when the provider enables them; keep the path ready. */
  function handleStreamEvent(run, message) {
    const event = message.event
    if (!event || typeof event !== 'object') return
    if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
      const delta = text(event.delta.thinking)
      if (delta !== '') {
        run.liveThought = clip(run.liveThought + delta, 4000)
        run.phase = 'thinking'
        if (run.status === 'starting') run.status = 'running'
      }
      return
    }
    if (event.type === 'message_stop' && run.liveThought !== '') {
      pushThought(run, run.liveThought)
      run.liveThought = ''
    }
  }

  function handleUser(run, message) {
    const content = message?.message?.content
    const blocks = Array.isArray(content) ? content : []
    for (const block of blocks) {
      if (!block || block.type !== 'tool_result') continue
      const step = run.toolUse.get(text(block.tool_use_id))
      if (step === undefined) continue
      step.status = block.is_error === true ? 'error' : 'ok'
      if (typeof step.at === 'number') step.durationMs = Math.max(0, Date.now() - step.at)
      const resultText = blocksText(block.content)
      if (resultText !== '') {
        step.resultPreview = oneLine(resultText, 160)
        addDetail(run, step.seq, 'result', resultText)
      }
    }
  }

  function handleResult(run, message) {
    if (typeof message.num_turns === 'number') run.stepCount = message.num_turns
    if (message.usage && typeof message.usage === 'object') {
      run.usage = {
        inputTokens: Number(message.usage.input_tokens) || 0,
        outputTokens: Number(message.usage.output_tokens) || 0,
        cacheReadTokens: Number(message.usage.cache_read_input_tokens) || 0,
        cacheWriteTokens: Number(message.usage.cache_creation_input_tokens) || 0,
      }
    }
    if (typeof message.total_cost_usd === 'number') run.costUsd = message.total_cost_usd
    if (typeof message.duration_ms === 'number') run.durationMs = message.duration_ms
    run.endedAt = Date.now()
    if (message.subtype === 'success' && message.is_error !== true && typeof message.result === 'string') {
      run.status = 'done'
      run.phase = 'done'
      run.resultText = clip(message.result, 24000)
      // The closing assistant message is also the delivered result; keep one copy.
      const delivered = run.resultText.trim()
      const lastStep = run.steps[run.steps.length - 1]
      if (lastStep !== undefined && lastStep.kind === 'say') {
        const said = String(lastStep.text ?? '').trim()
        if (said !== '' && (delivered.startsWith(said.slice(0, 80)) || said.startsWith(delivered.slice(0, 80)))) {
          run.steps.pop()
        }
      }
      if (run.label === '') run.label = oneLine(message.result, 120)
    } else {
      run.status = 'failed'
      run.phase = 'failed'
      const errors = Array.isArray(message.errors) ? message.errors.filter((entry) => typeof entry === 'string') : []
      run.error = errors.length > 0 ? clip(errors.join('; '), 4000) : `Claude Code 返回 ${text(message.subtype) || '未知结果'}`
    }
  }

  function handleMessage(run, raw) {
    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return
    switch (message.type) {
      case 'system': {
        if (message.subtype === 'init') {
          run.model = text(message.model)
          run.permissionMode = text(message.permissionMode)
          if (text(run.cwd) === '' && typeof message.cwd === 'string') run.cwd = message.cwd
          if (run.status === 'starting') run.status = 'running'
          run.phase = run.phase === 'starting' ? 'thinking' : run.phase
        }
        return
      }
      case 'assistant':
        handleAssistant(run, message)
        return
      case 'user':
        handleUser(run, message)
        return
      case 'result':
        handleResult(run, message)
        return
      case 'stream_event':
        handleStreamEvent(run, message)
        return
      default:
        return
    }
  }

  function attachStdout(run, stream) {
    if (stream === undefined || stream === null || typeof stream.on !== 'function') {
      recordError('Claude Code stdout is not a readable stream')
      return
    }
    let buffer = ''
    stream.on('data', (chunk) => {
      try {
        buffer += chunk.toString('utf8')
        let index = buffer.indexOf('\n')
        while (index >= 0) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          if (line.trim() !== '') handleMessage(run, line)
          index = buffer.indexOf('\n')
        }
        // A protocol line is small; anything this large is not ours to hold.
        if (buffer.length > 1024 * 1024) buffer = ''
      } catch (error) {
        recordError(`stdout parse: ${messageOf(error)}`)
      }
    })
    stream.on?.('error', (error) => recordError(`stdout stream: ${messageOf(error)}`))
  }

  function attachStdin(run, stream) {
    if (stream === undefined || stream === null || typeof stream.write !== 'function') return
    const original = stream.write
    try {
      stream.write = function write(chunk, ...rest) {
        try {
          if (run.inputBuffer.length < 64 * 1024) {
            run.inputBuffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
            if (run.label === '') run.label = extractPrompt(run.inputBuffer)
          }
        } catch {
          // A partial write is not a reason to fail the write itself.
        }
        return original.call(this, chunk, ...rest)
      }
    } catch (error) {
      recordError(`stdin capture: ${messageOf(error)}`)
    }
  }

  function observeSpawn(spec, handle) {
    state.spawnsSeen += 1
    const argv = Array.isArray(spec?.argv) ? spec.argv : []
    if (!looksLikeClaude(argv)) return
    state.claudeSpawns += 1

    let sessionId
    try {
      const agent = ctx.get('agents')?.currentInitiator?.()
      sessionId = agent?.id
    } catch (error) {
      recordError(`initiator: ${messageOf(error)}`)
    }

    const run = createRun({ sessionId, cwd: spec?.cwd })
    state.runs.set(run.id, run)
    attachStdin(run, handle?.stdin)
    attachStdout(run, handle?.stdout)

    const done = handle?.done
    if (done !== undefined && typeof done.then === 'function') {
      done.then(
        (outcome) => {
          if (run.endedAt !== null) return
          run.endedAt = Date.now()
          run.status = 'failed'
          run.phase = 'failed'
          const code = outcome?.exitCode
          run.error = code === 0 || code === null || code === undefined
            ? 'Claude Code 进程结束但没有返回结果'
            : `Claude Code 进程退出（code ${code}）但没有返回结果`
        },
        (error) => {
          if (run.endedAt !== null) return
          run.endedAt = Date.now()
          run.status = 'failed'
          run.phase = 'failed'
          run.error = `Claude Code 进程失败：${messageOf(error)}`
        },
      )
    }
  }

  /** Per-file totals of every edit step, for the delivery summary. */
  function changesOf(run) {
    const map = new Map()
    for (const step of run.steps) {
      const added = Number(step.added) || 0
      const removed = Number(step.removed) || 0
      if (added === 0 && removed === 0) continue
      const path = text(step.detail)
      if (path === '') continue
      const entry = map.get(path) ?? { path, added: 0, removed: 0, seqs: [] }
      entry.added += added
      entry.removed += removed
      entry.seqs.push(step.seq)
      map.set(path, entry)
    }
    return [...map.values()]
  }

  function toView(run) {
    const endedAt = run.endedAt
    return {
      id: run.id,
      sessionId: run.sessionId,
      label: run.label === '' ? (run.cwd === '' ? 'Claude Code 任务' : basename(run.cwd)) : run.label,
      cwd: run.cwd,
      model: run.model,
      permissionMode: run.permissionMode,
      status: run.status,
      phase: run.phase,
      startedAt: run.startedAt,
      endedAt,
      durationMs: endedAt === null ? Date.now() - run.startedAt : Math.max(0, endedAt - run.startedAt),
      lastAction: run.lastAction,
      lastText: run.lastText,
      lastThought: run.lastThought,
      thoughts: run.thoughts.slice(-4),
      stepCount: run.stepCount,
      toolCounts: [...run.toolCounts.entries()].map(([tool, count]) => ({ tool, count })),
      files: [...run.files].slice(-40),
      fileCount: run.files.size,
      changes: changesOf(run),
      todos: run.todos,
      usage: run.usage,
      costUsd: run.costUsd,
      resultText: run.resultText,
      error: run.error,
      steps: run.steps.slice(-120),
    }
  }

  function snapshot(sessionId, all) {
    prune()
    const runs = []
    for (const run of state.runs.values()) {
      if (!all && (sessionId === null || run.sessionId !== sessionId)) continue
      runs.push(toView(run))
    }
    runs.sort((left, right) => right.startedAt - left.startedAt)
    return runs
  }

  ctx.effect(() => {
    const service = ctx.subprocess
    if (service === undefined || typeof service.spawn !== 'function') {
      state.tapError = 'subprocess.spawn is unavailable'
      return undefined
    }
    const original = service.spawn
    const patched = function patchedSpawn(spec) {
      state.patchCalls += 1
      const handle = original.call(this, spec)
      try {
        observeSpawn(spec, handle)
      } catch (error) {
        recordError(`spawn observe: ${messageOf(error)}`)
      }
      return handle
    }
    try {
      // The service accessor may hand back a bound wrapper rather than the
      // function we stored, so identity is not evidence. The patch having run
      // (patchCalls) is.
      service.spawn = patched
      state.tapInstalled = true
      state.tapError = ''
    } catch (error) {
      state.tapError = `assigning subprocess.spawn failed: ${messageOf(error)}`
      recordError(state.tapError)
    }
    return () => {
      try {
        if (service.spawn === patched) service.spawn = original
      } catch {
        // The service is being disposed; nothing left to restore.
      }
    }
  }, 'claude-code-progress: subprocess tap')

  // Shape diagnostics only: they tell the next version which fields an
  // activation event actually carries, without depending on them.
  ctx.effect(() => ctx.on('subagent/start', (info) => {
    state.startKeys = Object.keys(info ?? {})
  }), 'claude-code-progress: activation start probe')

  ctx.effect(() => ctx.on('subagent/end', (info) => {
    state.endKeys = Object.keys(info ?? {})
  }), 'claude-code-progress: activation end probe')

  const sendJson = (response, status, payload) => {
    response.writeHead(status, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    response.end(JSON.stringify(payload))
  }

  const refuse = (request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET' })
      response.end()
      return true
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      sendJson(response, 403, { ok: false, error: 'cross-site request refused' })
      return true
    }
    return false
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SNAPSHOT_PATH,
    handler: (request, response) => {
      try {
        if (refuse(request, response)) return
        const url = new URL(request.url ?? SNAPSHOT_PATH, 'http://127.0.0.1')
        const sessionId = url.searchParams.get('sessionId')
        const source = url.searchParams.get('source')
        const build = Number(url.searchParams.get('build'))
        if (Number.isFinite(build) && build > 0) state.reads.build = build
        if (source === 'panel' || source === 'chip') state.reads[source] += 1
        else state.reads.other += 1
        const all = url.searchParams.get('all') === '1' || sessionId === null || sessionId === ''
        sendJson(response, 200, {
          ok: true,
          now: Date.now(),
          runs: snapshot(sessionId, all),
          meta: {
            tapInstalled: state.tapInstalled,
            tapError: state.tapError,
            patchCalls: state.patchCalls,
            reads: { ...state.reads },
            spawnsSeen: state.spawnsSeen,
            claudeSpawns: state.claudeSpawns,
            errors: state.errors,
            startKeys: state.startKeys,
            endKeys: state.endKeys,
          },
        })
      } catch (error) {
        try {
          sendJson(response, 500, { ok: false, error: messageOf(error) })
        } catch {
          // The response is already gone.
        }
      }
    },
  }), 'claude-code-progress: snapshot route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STEP_PATH,
    handler: (request, response) => {
      try {
        if (refuse(request, response)) return
        const url = new URL(request.url ?? STEP_PATH, 'http://127.0.0.1')
        const runId = url.searchParams.get('runId') ?? ''
        const seq = Number(url.searchParams.get('seq'))
        const run = state.runs.get(runId)
        const step = run === undefined ? undefined : run.steps.find((candidate) => candidate.seq === seq)
        if (run === undefined || step === undefined) {
          sendJson(response, 404, { ok: false, error: 'unknown step' })
          return
        }
        const detail = run.details.get(step.seq) ?? { input: '', result: '', diff: null }
        sendJson(response, 200, {
          ok: true,
          tool: step.tool ?? '',
          detail: step.detail ?? '',
          status: step.status ?? '',
          durationMs: step.durationMs ?? null,
          input: detail.input ?? '',
          result: detail.result ?? '',
          diff: detail.diff ?? null,
        })
      } catch (error) {
        try {
          sendJson(response, 500, { ok: false, error: messageOf(error) })
        } catch {
          // The response is already gone.
        }
      }
    },
  }), 'claude-code-progress: step route')
}
