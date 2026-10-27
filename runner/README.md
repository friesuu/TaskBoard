# Claude runner

Runs your task board's "AI" tasks through Claude Code, one step at a time:

1. A task with the **AI** label in **To do**, on a board with a project → Claude reads the project and
   writes a prompt → **Prompt Review**.
2. You read the prompt in the task panel: fill in any `[[FILL IN: …]]` blanks, then **Approve** (→ In
   progress) or **Request changes** (Claude revises it on the next run).
3. An approved task → Claude builds it on a new branch `ai/task-<id>-<title>` → the runner runs the
   build and tests itself, commits on that branch, and posts a summary → **AI Review**.
4. You check the branch and move the task to Done yourself. The runner never touches main, never
   pushes, never deploys.

## Run it

```bash
cd ~/task-board/runner
pnpm once
```

Each run does one step for one task, then stops. Run it again for the next step.

## Files

| File | What it is |
| --- | --- |
| `.env` | Your secrets: `ANTHROPIC_API_KEY` and `RUNNER_TOKEN` (from your profile page). Never commit it. |
| `config.json` | `auth` ("api" or "pro"), the task board's address, models, spend caps per step |
| `projects.json` | The ONLY folders the runner may work in, by name, with their build and test commands |
| `PROMPT_STYLE.md` | How Claude writes prompts |
| `rules/` | The fixed rules Claude follows in each step (task text can't change them) |
| `logs/runs.log` | One line per run: task, step, branch, result, cost |

## Switching to the Pro plan later

Set `"auth": "pro"` in `config.json`, log in once with `claude` inside Ubuntu, and remove
`ANTHROPIC_API_KEY` from `.env`. The runner then stops cleanly when you hit your usage limit.
