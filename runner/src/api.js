// The runner's connection to the task board: its own GraphQL operations, sent with the runner token.
// The runner is a separate program, so it talks to the board through the API like the browser does.

const TASK_FIELDS = 'id title description status refinedPrompt labels { name }';

export function createApi(url, token)
{
    async function request(query, variables)
    {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ query, variables }),
        });
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The task board answered ${response.status} without a GraphQL reply`);
        if (body.errors?.length)
        {
            const error = body.errors[0];
            const details = error.extensions?.originalError?.message; // validation messages
            const err = new Error(Array.isArray(details) ? details.join(', ') : error.message);
            err.code = error.extensions?.code;
            throw err;
        }
        return body.data;
    }

    return {
        // "Is my token valid?"
        ping: () => request('query { runnerPing }'),

        // The next job, or null: { kind: 'REFINE' | 'BUILD', project, approvedPrompt, task, comments, checklist }
        nextJob: async () => (await request(`query {
            runnerNextJob {
                kind project approvedPrompt
                task { ${TASK_FIELDS} }
                comments { body fromRunner kind createdAt }
                checklist { text done }
            }
        }`)).runnerNextJob,

        savePrompt: (taskId, prompt) => request(
            `mutation ($taskId: Int!, $input: RunnerPromptInput!) { runnerSavePrompt(taskId: $taskId, input: $input) { id } }`,
            { taskId, input: { prompt } },
        ),

        startBuild: (taskId, branch) => request(
            `mutation ($taskId: Int!, $input: RunnerBuildStartInput!) { runnerStartBuild(taskId: $taskId, input: $input) { id } }`,
            { taskId, input: { branch } },
        ),

        // checksPassed: false = it needs a look (the checks failed, or Claude stopped early)
        finishBuild: (taskId, checksPassed) => request(
            `mutation ($taskId: Int!, $input: RunnerBuildResultInput!) { runnerFinishBuild(taskId: $taskId, input: $input) { id } }`,
            { taskId, input: { checksPassed } },
        ),

        // A step starts: the board opens a run (shown as running) and returns its id
        startRun: async (taskId, step, branch = null) => (await request(
            `mutation ($taskId: Int!, $input: RunnerRunStartInput!) { runnerStartRun(taskId: $taskId, input: $input) }`,
            { taskId, input: { step, branch } },
        )).runnerStartRun,

        // A few lines of the run's step-by-step log: [{ at, kind, text }]
        appendLog: (runId, lines) => request(
            `mutation ($runId: Int!, $input: RunnerLogInput!) { runnerAppendLog(runId: $runId, input: $input) }`,
            { runId, input: { lines } },
        ),

        // The step ended: { status: 'succeeded' | 'failed', result, checksPassed, costUsd, error, summary }
        finishRun: (runId, run) => request(
            `mutation ($runId: Int!, $input: RunnerRunFinishInput!) { runnerFinishRun(runId: $runId, input: $input) }`,
            { runId, input: run },
        ),

        // What the runner is doing now: { state, taskId, step, pausedUntil }
        reportStatus: (status) => request(
            `mutation ($input: RunnerStatusInput!) { runnerReportStatus(input: $input) }`,
            { input: status },
        ),

        reportError: (taskId, message) => request(
            `mutation ($taskId: Int!, $input: RunnerErrorInput!) { runnerReportError(taskId: $taskId, input: $input) { id } }`,
            { taskId, input: { message: message.slice(0, 2000) } },
        ),
    };
}
