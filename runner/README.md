# Claude runner

Runs your task board's "AI" tasks through Claude Code, one step at a time:

1. A task with the **AI** label in **To do**, on a board with a project → Claude reads the project and
   writes a prompt → **Prompt Review**.
2. You read the prompt in the task panel: fill in any `[[FILL IN: …]]` blanks, then **Approve** (→ In
   progress) or **Request changes** (Claude revises it on the next run).
3. An approved task → Claude builds it on a new branch `ai/task-<id>-<title>` → the runner runs the
   build and tests itself, scans the changes for secrets, commits on that branch, and posts a summary →
   **AI Review**.
4. You check the branch, merge it yourself if you're happy, and move the task to Done. The runner never
   touches main, never pushes, never deploys.

To have Claude build a task again, move it back to **In progress**: it's built from scratch on a new
branch (`…-2`), with the same approved prompt, so it costs another build. To change the prompt first, move
it to **Prompt Review**, edit it and approve it again. Moving it out before the runner gets to it cancels that.

Every step is in the task's **Run log** (Claude section of the task panel) and in `logs/runs.log`.

## Run it

```bash
cd ~/task-board/runner
pnpm once         # one step for one task, then stop
pnpm watch        # keep doing the next waiting step until you press Ctrl+C
pnpm self-check   # prove the safety locks work (a few cents, cheapest model)
pnpm test         # the runner's own tests (free, no Claude)
```

**Watch mode** checks every 30 seconds and does the next step as soon as one is waiting, so a new task
gets its prompt, and an approved one gets built, almost straight away. It stays quiet while nothing
changes. Press Ctrl+C once to stop after the step that's running (a build is never cut off halfway), or
twice to stop straight away. Waiting costs nothing: Claude only runs when there's a step to do.

It also runs by itself every 15 minutes through Windows Task Scheduler: see `schedule/README.md`.
The two never get in each other's way: only one runner works at a time.

## The safety locks

Each lock works on its own, so one mistake in any of them isn't enough to cause harm.

1. **Your approval**: nothing is built until you approve the exact prompt; the server checks this, not the runner.
2. **Only what each step needs**: writing a prompt can only read and search the project. Building can edit
   files in its own worktree and run only the project's exact build and test commands.
3. **The guard** (`src/guard.js`): checks every single tool call before it runs. Blocks files outside the
   project, secret files (`.env`, keys…), any other command, any other tool. If the guard itself breaks,
   the call is refused. Every decision goes to `logs/guard.log`.
4. **The sandbox** around every command (Claude's, and the runner's own checks of Claude's work): no
   internet, the runner's and the board's `.env` files hidden, only the worktree writable.
5. **No keys in reach**: the API key reaches Claude Code only through `bin/api-key.sh`, and is stripped from
   every command's environment. The runner token never leaves the runner.
6. **The secret scan**: before committing, the changes are searched for anything that looks like a key or
   token. If one is found, nothing is committed and the changes are thrown away.
7. **Spend limits**: each step has a cap, and the whole day has one (`dailyCapUsd`). On the Pro plan, the
   runner pauses until your usage limit resets.

## Files

| File | What it is |
| --- | --- |
| `.env` | Your secrets: `ANTHROPIC_API_KEY` and `RUNNER_TOKEN` (from your profile page). Never commit it. |
| `config.json` | `auth` ("api" or "pro"), the task board's address, models, caps per step and per day |
| `projects.json` | The ONLY folders the runner may work in, by name, with their setup, build and test commands |
| `PROMPT_STYLE.md` | How Claude writes prompts |
| `rules/` | The fixed rules Claude follows in each step (task text can't change them) |
| `logs/` | `runs.log` (one line per step), `guard.log` (every guard decision), `scheduler.log` (scheduled runs) |

## Adding a project

Add it to `projects.json` (its folder must be a git repository with a `main` branch), then type its name
under **Claude project** in that board's settings.

## The Pro plan (branch `runner-pro`)

On the `runner-pro` branch, `config.json` says `"auth": "pro"`: Claude Code runs on your Claude Pro plan
instead of the API key. To use it:

1. Log in once inside Ubuntu: `claude auth login` (choose your Claude subscription, not the Console).
   `claude auth status` shows whether you're logged in.
2. Switch the project folder to the branch: `cd ~/task-board && git switch runner-pro`.
3. Run `pnpm self-check`: on the Pro plan it also proves commands can't read your login.

What changes on the Pro plan:
- The runner refuses to start unless Claude Code is logged in to your subscription.
- The API key in `.env` isn't used (you can leave it there, for switching back).
- Runs count toward your plan's usage limit. When you hit it, the runner pauses until the limit resets
  (`~/.task-runner/paused.json` says until when). The daily dollar cap doesn't apply; each step's cap
  still stops a runaway run.
- Task comments show what a run used, counted toward your plan's limit, instead of a cost.

Anthropic's consumer terms don't allow scripted use of a subscription except where they explicitly
permit it, and their rules for `claude -p` on a subscription changed several times in 2026. Using
Claude Code itself on your own computer is the least contested case, but it's still a risk to your
account. To go back to the API: `git switch main`.
