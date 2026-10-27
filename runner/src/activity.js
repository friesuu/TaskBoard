// A run's step-by-step log on the board (the task's AI tab, the AI Activity page): what Claude said and did,
// as Claude Code reports it (--output-format stream-json), plus the runner's own steps (setup, checks,
// commit). Secrets are hidden before anything leaves the laptop, and the board hides them again.
// The board being unreachable never stops a step: the log just goes missing.
import { isAbsolute, relative } from 'node:path';
import { redact } from './secrets.js';

const MAX_TEXT = 4000; // the board's limit for one line
const FLUSH_EVERY_MS = 2000;
const FLUSH_AT_LINES = 50;
const OUTPUT_LINES = 6; // how much of a command's output is shown: its last lines

// One short line per tool call: "Read src/App.jsx", "Ran pnpm test"... A file's contents are never logged.
export function describeTool(name, input = {}, folder = '')
{
    const file = (path) => (path && folder && isAbsolute(path) ? relative(folder, path) || '.' : path ?? '');
    switch (name)
    {
        case 'Read': return `Read ${file(input.file_path)}`;
        case 'Edit':
        case 'MultiEdit': return `Edit ${file(input.file_path)}`;
        case 'Write': return `Write ${file(input.file_path)}`;
        case 'Glob': return `Glob ${input.pattern ?? ''}`;
        case 'Grep': return `Grep "${input.pattern ?? ''}"${input.path ? ` in ${file(input.path)}` : ''}`;
        case 'Bash': return `Ran ${input.command ?? ''}`;
        default: return name;
    }
}

// A tool result's text: a string, or a list of { type: 'text', text } parts
function resultText(content)
{
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((part) => (part?.type === 'text' ? part.text : '')).join('\n');
    return '';
}

const lastLines = (text, count) => text.trim().split('\n').slice(-count).join('\n');

// Turns Claude Code's events into log lines ([{ kind, text }]). It remembers which tool each result belongs
// to, so a command's output is shown and a file's contents never are.
//   folder(): the folder Claude works in, so paths can be shown short (src/App.jsx)
export function createActivityParser(folder = () => '')
{
    const toolNames = new Map(); // tool_use id -> tool name
    return (event) => {
        const lines = [];
        if (event?.type === 'system' && event.subtype === 'init')
        {
            lines.push({ kind: 'info', text: `Claude Code started (${event.model ?? 'model unknown'})` });
        }
        else if (event?.type === 'assistant')
        {
            for (const block of event.message?.content ?? [])
            {
                if (block.type === 'text' && block.text?.trim()) lines.push({ kind: 'claude', text: block.text.trim() });
                else if (block.type === 'thinking' && block.thinking?.trim()) lines.push({ kind: 'thinking', text: block.thinking.trim() });
                else if (block.type === 'tool_use')
                {
                    toolNames.set(block.id, block.name);
                    lines.push({ kind: 'tool', text: describeTool(block.name, block.input, folder()) });
                }
            }
        }
        else if (event?.type === 'user')
        {
            for (const block of event.message?.content ?? [])
            {
                if (block.type !== 'tool_result') continue;
                const text = resultText(block.content).trim();
                // Refused by the guard or the sandbox, or a command that failed
                if (block.is_error) lines.push({ kind: 'error', text: `Error: ${lastLines(text, OUTPUT_LINES) || 'no details'}` });
                else if (toolNames.get(block.tool_use_id) === 'Bash' && text) lines.push({ kind: 'tool', text: `→ ${lastLines(text, OUTPUT_LINES)}` });
            }
        }
        else if (event?.type === 'result')
        {
            const turns = event.num_turns ? `, ${event.num_turns} turns` : '';
            lines.push({ kind: 'info', text: `Claude finished (${event.subtype ?? 'done'}${turns})` });
        }
        return lines;
    };
}

// The log of one run. add(kind, text) for the runner's own steps; addEvent(event) for Claude Code's;
// inFolder(path) once the folder Claude works in is known. Lines go to the board every 2 seconds (or every
// 50 lines), in order; close() sends the rest. runId null (the board couldn't open the run): nothing is sent.
export function createRunLog({ api, runId, knownSecrets = [], flushEveryMs = FLUSH_EVERY_MS, say = console.log })
{
    let buffer = [];
    let sending = Promise.resolve();
    let warned = false;
    let folder = '';
    const parse = createActivityParser(() => folder);

    const flush = () => {
        const lines = buffer;
        buffer = [];
        if (runId === null || lines.length === 0) return sending;
        sending = sending
            .then(() => api.appendLog(runId, lines))
            .catch((err) => {
                if (!warned) say(`[runner] (Couldn't send the step log to the board: ${err.message})`);
                warned = true;
            });
        return sending;
    };
    const timer = setInterval(flush, flushEveryMs);
    timer.unref?.(); // never keeps the runner running on its own

    const add = (kind, text) => {
        const clean = redact(String(text ?? ''), knownSecrets).slice(0, MAX_TEXT);
        if (!clean.trim()) return;
        buffer.push({ at: new Date().toISOString(), kind, text: clean });
        if (buffer.length >= FLUSH_AT_LINES) flush();
    };

    return {
        add,
        addEvent: (event) => {
            for (const line of parse(event)) add(line.kind, line.text);
        },
        inFolder: (path) => { folder = path; },
        close: async () => {
            clearInterval(timer);
            await flush();
        },
    };
}
