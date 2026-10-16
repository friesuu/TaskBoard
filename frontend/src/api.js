const GRAPHQL_URL = 'http://localhost:3000/graphql';
const TASK_FIELDS = 'id title description status dueDate';
const CHAT_FIELDS = 'id role content createdAt';

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

export async function getTasks()
{
    const data = await graphqlRequest(`query { tasks { ${TASK_FIELDS} }}`);
    return data.tasks;
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

// Sends one message, returns Claude's answer
export async function sendChatMessage(message)
{
    const data = await graphqlRequest(
        `mutation SendChatMessage($input: SendChatMessageInput!) {
            sendChatMessage(input: $input) { ${CHAT_FIELDS} }
        }`,
        { input: { message } },
    );
    return data.sendChatMessage;
}

export async function clearChat()
{
    await graphqlRequest('mutation { clearChat }');
}
