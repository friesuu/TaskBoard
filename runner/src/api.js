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
                comments { body fromRunner createdAt }
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

        finishBuild: (taskId, summary) => request(
            `mutation ($taskId: Int!, $input: RunnerBuildResultInput!) { runnerFinishBuild(taskId: $taskId, input: $input) { id } }`,
            { taskId, input: { summary } },
        ),

        // One finished step for the task's run log: { step, result, branch, checksPassed, costUsd, error, startedAt }
        logRun: (taskId, run) => request(
            `mutation ($taskId: Int!, $input: RunnerRunLogInput!) { runnerLogRun(taskId: $taskId, input: $input) }`,
            { taskId, input: run },
        ),

        reportError: (taskId, message) => request(
            `mutation ($taskId: Int!, $input: RunnerErrorInput!) { runnerReportError(taskId: $taskId, input: $input) { id } }`,
            { taskId, input: { message: message.slice(0, 2000) } },
        ),
    };
}
