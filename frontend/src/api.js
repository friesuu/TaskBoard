const GRAPHQL_URL = 'http://localhost:3000/graphql';
// The backend itself (for file upload and download, which aren't GraphQL): the GraphQL address without /graphql
const API_ORIGIN = GRAPHQL_URL.replace(/\/graphql$/, '');
// checklistDone / checklistTotal = the "2/5" on the card
const TASK_FIELDS =
    'id title description status dueDate checklistDone checklistTotal attachmentCount labels { id name color } '
    // the Claude runner's part of the task (see AiSection)
    + 'refinedPrompt changesRequested promptApprovedAt aiBranch aiError';
const CHAT_FIELDS = 'id role content createdAt responseMs';
const BOARD_FIELDS = 'id name project';
const ITEM_FIELDS = 'id text done position';
const LABEL_FIELDS = 'id name color';
const COMMENT_FIELDS = 'id body createdAt updatedAt author { id email displayName } fromRunner';

// Validation errors keep their real messages in originalError (as an array);
// other errors have a readable message directly.
function getErrorMessage(error)
{
    const details = error.extensions?.originalError?.message;

    if (Array.isArray(details))
    {
        return details.join(', ');
    }
    return error.message || 'Something went wrong';
}

async function graphqlRequest(query, variables) {
  const response = await fetch(GRAPHQL_URL, { // Fetch by default sends GQL requests into the same origin
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    credentials: 'include' // Sends them to localhost3000 too
    // without credentials, the browsers leaves the cookie out
  });

  const body = await response.json();

  // GraphQL often answers 200 even when it fails, so check errors, not response.ok
  if (body.errors)
  {
    const err = new Error(getErrorMessage(body.errors[0]));
    err.code = body.errors[0].extensions?.code; // e.g. 'UNAUTHENTICATED', so callers can tell "not logged in" from other errors
    throw err;
  }
  return body.data;
}

// The tasks of ONE board. filter (optional): { q, labelIds, statuses, due }, see filters.js
export async function getTasks(boardId, filter = null)
{
    const data = await graphqlRequest(
        `query Tasks($boardId: Int!, $filter: TaskFilterInput) {
            tasks(boardId: $boardId, filter: $filter) { ${TASK_FIELDS} }
        }`,
        { boardId, filter },
    );
    return data.tasks;
}

// Your boards, oldest first
export async function getBoards()
{
    const data = await graphqlRequest(`query { boards { ${BOARD_FIELDS} } }`);
    return data.boards;
}

export async function createBoard(name)
{
    const data = await graphqlRequest(
        `mutation CreateBoard($input: BoardNameInput!) {
            createBoard(input: $input) { ${BOARD_FIELDS} }
        }`,
        { input: { name } },
    );
    return data.createBoard;
}

export async function renameBoard(id, name)
{
    const data = await graphqlRequest(
        `mutation RenameBoard($id: Int!, $input: BoardNameInput!) {
            renameBoard(id: $id, input: $input) { ${BOARD_FIELDS} }
        }`,
        { id, input: { name } },
    );
    return data.renameBoard;
}

// Also deletes every task on it. The server refuses to delete your last board.
export async function deleteBoard(id)
{
    await graphqlRequest(
        `mutation DeleteBoard($id: Int!) {
            deleteBoard(id: $id)
        }`,
        { id },
    );
}

export async function createTask(input)
{
    const data = await graphqlRequest(
        `mutation CreateTask($input: CreateTaskInput!) {
            createTask(input: $input) { ${TASK_FIELDS} }
        }`,
        { input },
    );
    return data.createTask;
}

export async function updateTask(id, changes)
{
    const data = await graphqlRequest(
        `mutation UpdateTask($id: Int!, $input: UpdateTaskInput!) {
            updateTask(id: $id, input: $input) { ${TASK_FIELDS} }
        }`,
        { id, input: changes },
    );
    return data.updateTask;
}

export async function moveTask(id, status, position)
{
    const data = await graphqlRequest(
        `mutation MoveTask($id: Int!, $input: MoveTaskInput!) {
            moveTask(id: $id, input: $input) { ${TASK_FIELDS} }
        }`,
        { id, input: { status, position } },
    );
    return data.moveTask;
}

export async function deleteTask(id)
{
    await graphqlRequest(
        `mutation DeleteTask($id: Int!) {
            deleteTask(id: $id)
        }`,
        { id },
    );
}

// The logged-in user, or null if nobody is logged in. Any other error (server down...) is thrown.
export async function getCurrentUser()
{
    try
    {
        const data = await graphqlRequest('query { me { id email timeZone displayName } }');
        return data.me;
    }
    catch (err)
    {
        if (err.code === 'UNAUTHENTICATED') return null; // simply not logged in
        throw err; // a real problem: let it show
    }
}

// The server sets the httpOnly login cookie; we only get the user back
export async function login(email, password)
{
    const data = await graphqlRequest(
        `mutation Login($input: LoginInput!) {
            login(input: $input) { id email timeZone displayName }
        }`,
        { input: { email, password } },
    );
    return data.login;
}

// Creates the account only. Call login() afterwards to actually log in.
export async function register(email, password)
{
    const data = await graphqlRequest(
        `mutation Register($input: RegisterInput!) {
            register(input: $input) { id email }
        }`,
        { input: { email, password } },
    );
    return data.register;
}

// Needs the current password too. The server sends back a fresh login cookie, so you stay logged in here,
// while every other device is logged out.
export async function changePassword(currentPassword, newPassword)
{
    await graphqlRequest(
        `mutation ChangePassword($input: ChangePasswordInput!) {
            changePassword(input: $input)
        }`,
        { input: { currentPassword, newPassword } },
    );
}

// The server deletes the cookie (JavaScript can't, because it's httpOnly)
export async function logout()
{
    await graphqlRequest('mutation { logout }');
}

// The saved conversation, oldest first
export async function getChatMessages()
{
    const data = await graphqlRequest(`query { chatMessages { ${CHAT_FIELDS} } }`);
    return data.chatMessages;
}

// Sends one message about the tasks on board `boardId`, returns Claude's answer
export async function sendChatMessage(boardId, message)
{
    const data = await graphqlRequest(
        `mutation SendChatMessage($input: SendChatMessageInput!) {
            sendChatMessage(input: $input) { ${CHAT_FIELDS} }
        }`,
        { input: { boardId, message } },
    );
    return data.sendChatMessage;
}

export async function clearChat()
{
    await graphqlRequest('mutation { clearChat }');
}

// ----- Checklist (inside a task) -----

// The task's checklist, top to bottom
export async function getChecklist(taskId)
{
    const data = await graphqlRequest(
        `query Checklist($taskId: Int!) {
            checklistItems(taskId: $taskId) { ${ITEM_FIELDS} }
        }`,
        { taskId },
    );
    return data.checklistItems;
}

// Adds an item at the bottom
export async function addChecklistItem(taskId, text)
{
    const data = await graphqlRequest(
        `mutation AddChecklistItem($taskId: Int!, $input: ChecklistItemInput!) {
            addChecklistItem(taskId: $taskId, input: $input) { ${ITEM_FIELDS} }
        }`,
        { taskId, input: { text } },
    );
    return data.addChecklistItem;
}

// changes = { done: true } to tick, { text: '...' } to rename
export async function updateChecklistItem(id, changes)
{
    const data = await graphqlRequest(
        `mutation UpdateChecklistItem($id: Int!, $input: UpdateChecklistItemInput!) {
            updateChecklistItem(id: $id, input: $input) { ${ITEM_FIELDS} }
        }`,
        { id, input: changes },
    );
    return data.updateChecklistItem;
}

// Returns the whole checklist in its new order
export async function moveChecklistItem(id, position)
{
    const data = await graphqlRequest(
        `mutation MoveChecklistItem($id: Int!, $position: Int!) {
            moveChecklistItem(id: $id, position: $position) { ${ITEM_FIELDS} }
        }`,
        { id, position },
    );
    return data.moveChecklistItem;
}

export async function deleteChecklistItem(id)
{
    await graphqlRequest(
        `mutation DeleteChecklistItem($id: Int!) {
            deleteChecklistItem(id: $id)
        }`,
        { id },
    );
}

// ----- Comments (inside a task) -----

// Oldest first, each with its author
export async function getComments(taskId)
{
    const data = await graphqlRequest(
        `query Comments($taskId: Int!) {
            comments(taskId: $taskId) { ${COMMENT_FIELDS} }
        }`,
        { taskId },
    );
    return data.comments;
}

export async function addComment(taskId, body)
{
    const data = await graphqlRequest(
        `mutation AddComment($taskId: Int!, $input: CommentInput!) {
            addComment(taskId: $taskId, input: $input) { ${COMMENT_FIELDS} }
        }`,
        { taskId, input: { body } },
    );
    return data.addComment;
}

// Only works on your own comments
export async function updateComment(id, body)
{
    const data = await graphqlRequest(
        `mutation UpdateComment($id: Int!, $input: CommentInput!) {
            updateComment(id: $id, input: $input) { ${COMMENT_FIELDS} }
        }`,
        { id, input: { body } },
    );
    return data.updateComment;
}

export async function deleteComment(id)
{
    await graphqlRequest(
        `mutation DeleteComment($id: Int!) {
            deleteComment(id: $id)
        }`,
        { id },
    );
}

// ----- Labels (belong to a board; a task can have several) -----

// The board's labels, A to Z
export async function getLabels(boardId)
{
    const data = await graphqlRequest(
        `query Labels($boardId: Int!) {
            labels(boardId: $boardId) { ${LABEL_FIELDS} }
        }`,
        { boardId },
    );
    return data.labels;
}

// color: one of the LABEL_COLORS values, e.g. 'BLUE'
export async function createLabel(boardId, name, color)
{
    const data = await graphqlRequest(
        `mutation CreateLabel($boardId: Int!, $input: LabelInput!) {
            createLabel(boardId: $boardId, input: $input) { ${LABEL_FIELDS} }
        }`,
        { boardId, input: { name, color } },
    );
    return data.createLabel;
}

// changes = { name } and/or { color }
export async function updateLabel(id, changes)
{
    const data = await graphqlRequest(
        `mutation UpdateLabel($id: Int!, $input: UpdateLabelInput!) {
            updateLabel(id: $id, input: $input) { ${LABEL_FIELDS} }
        }`,
        { id, input: changes },
    );
    return data.updateLabel;
}

// Also takes the label off every task that has it
export async function deleteLabel(id)
{
    await graphqlRequest(
        `mutation DeleteLabel($id: Int!) {
            deleteLabel(id: $id)
        }`,
        { id },
    );
}

// Replaces the task's labels with exactly these; returns the updated task
export async function setTaskLabels(taskId, labelIds)
{
    const data = await graphqlRequest(
        `mutation SetTaskLabels($taskId: Int!, $input: SetTaskLabelsInput!) {
            setTaskLabels(taskId: $taskId, input: $input) { ${TASK_FIELDS} }
        }`,
        { taskId, input: { labelIds } },
    );
    return data.setTaskLabels;
}

// Tells the server this browser's time zone (e.g. 'Asia/Kuala_Lumpur'), so "today" and "this week" are right
export async function setTimeZone(timeZone)
{
    await graphqlRequest(
        `mutation SetTimeZone($input: TimeZoneInput!) {
            setTimeZone(input: $input) { id }
        }`,
        { input: { timeZone } },
    );
}

// ----- Profile -----

// The profile's numbers, across all your boards:
// { total, todo, inProgress, done, overdue, dueThisWeek, doneThisWeek }
export async function getTaskStats()
{
    const data = await graphqlRequest(
        'query { taskStats { total todo promptReview inProgress aiReview done overdue dueThisWeek doneThisWeek } }',
    );
    return data.taskStats;
}

// The name shown instead of your email. An empty one removes it. Returns the saved name (trimmed) or null.
export async function setDisplayName(displayName)
{
    const data = await graphqlRequest(
        `mutation SetDisplayName($input: DisplayNameInput!) {
            setDisplayName(input: $input) { id displayName }
        }`,
        { input: { displayName } },
    );
    return data.setDisplayName.displayName;
}

// Deletes your account and everything in it. Needs your password; the server then removes the login cookie.
export async function deleteAccount(password)
{
    await graphqlRequest(
        `mutation DeleteAccount($input: DeleteAccountInput!) {
            deleteAccount(input: $input)
        }`,
        { input: { password } },
    );
}

// ----- Attachments (files on a task) -----

const ATTACHMENT_FIELDS = 'id fileName mimeType size createdAt taskId';

// The task's files, oldest first
export async function getAttachments(taskId)
{
    const data = await graphqlRequest(
        `query Attachments($taskId: Int!) {
            attachments(taskId: $taskId) { ${ATTACHMENT_FIELDS} }
        }`,
        { taskId },
    );
    return data.attachments;
}

// Uploads one file. Not GraphQL: a normal form post (multipart), which is how browsers send files.
export async function uploadAttachment(taskId, file)
{
    const form = new FormData();
    form.append('file', file); // the server reads the field called "file"

    const response = await fetch(`${API_ORIGIN}/api/tasks/${taskId}/attachments`, {
        method: 'POST',
        body: form, // no Content-Type header: the browser sets it, with the multipart boundary
        credentials: 'include', // the login cookie
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok)
    {
        const message = response.status === 413
            ? 'The file is too big (10 MB at most)'
            : [].concat(body.message ?? 'The upload failed').join(', ');
        const err = new Error(message);
        if (response.status === 401) err.code = 'UNAUTHENTICATED'; // same code as GraphQL uses, so App logs you out
        throw err;
    }
    return body;
}

// Where a file downloads from. A normal link: the browser sends the login cookie and saves the file.
export function attachmentDownloadUrl(id)
{
    return `${API_ORIGIN}/api/attachments/${id}/download`;
}

export async function deleteAttachment(id)
{
    await graphqlRequest(
        `mutation DeleteAttachment($id: Int!) {
            deleteAttachment(id: $id)
        }`,
        { id },
    );
}

// ----- The Claude runner -----

// Which project folder the runner works in for this board ('' = none). Returns the board.
export async function setBoardProject(id, project)
{
    const data = await graphqlRequest(
        `mutation SetBoardProject($id: Int!, $input: BoardProjectInput!) {
            setBoardProject(id: $id, input: $input) { ${BOARD_FIELDS} }
        }`,
        { id, input: { project } },
    );
    return data.setBoardProject;
}

// Your edits to Claude's prompt (e.g. blanks filled in). Returns the task.
export async function updateRefinedPrompt(taskId, prompt)
{
    const data = await graphqlRequest(
        `mutation UpdateRefinedPrompt($taskId: Int!, $input: RefinedPromptInput!) {
            updateRefinedPrompt(taskId: $taskId, input: $input) { ${TASK_FIELDS} }
        }`,
        { taskId, input: { prompt } },
    );
    return data.updateRefinedPrompt;
}

// Approve the prompt: the task moves to In progress and Claude builds it on its next run
export async function approvePrompt(taskId)
{
    const data = await graphqlRequest(
        `mutation ApprovePrompt($taskId: Int!) { approvePrompt(taskId: $taskId) { ${TASK_FIELDS} } }`,
        { taskId },
    );
    return data.approvePrompt;
}

// Ask Claude to change the prompt: your comment goes on the task
export async function requestPromptChanges(taskId, comment)
{
    const data = await graphqlRequest(
        `mutation RequestPromptChanges($taskId: Int!, $input: PromptChangesInput!) {
            requestPromptChanges(taskId: $taskId, input: $input) { ${TASK_FIELDS} }
        }`,
        { taskId, input: { comment } },
    );
    return data.requestPromptChanges;
}

// "Try again" after the runner stopped on a task
export async function retryAiTask(taskId)
{
    const data = await graphqlRequest(
        `mutation RetryAiTask($taskId: Int!) { retryAiTask(taskId: $taskId) { ${TASK_FIELDS} } }`,
        { taskId },
    );
    return data.retryAiTask;
}

// Your runner token's details ({ createdAt, lastUsedAt }), or null if you haven't made one
export async function getRunnerToken()
{
    const data = await graphqlRequest('query { runnerToken { createdAt lastUsedAt } }');
    return data.runnerToken;
}

// A new runner token (replacing any old one). This is the only time it's ever shown.
export async function createRunnerToken()
{
    const data = await graphqlRequest('mutation { createRunnerToken }');
    return data.createRunnerToken;
}

export async function revokeRunnerToken()
{
    await graphqlRequest('mutation { revokeRunnerToken }');
}
