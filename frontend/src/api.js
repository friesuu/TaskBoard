const GRAPHQL_URL = 'http://localhost:3000/graphql';
// checklistDone / checklistTotal = the "2/5" on the card
const TASK_FIELDS = 'id title description status dueDate checklistDone checklistTotal';
const CHAT_FIELDS = 'id role content createdAt';
const BOARD_FIELDS = 'id name';
const ITEM_FIELDS = 'id text done position';
const COMMENT_FIELDS = 'id body createdAt updatedAt author { id email }';

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

// The tasks of ONE board
export async function getTasks(boardId)
{
    const data = await graphqlRequest(
        `query Tasks($boardId: Int!) {
            tasks(boardId: $boardId) { ${TASK_FIELDS} }
        }`,
        { boardId },
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
        const data = await graphqlRequest('query { me { id email } }');
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
            login(input: $input) { id email }
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
