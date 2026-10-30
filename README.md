# Task Board
A simple task board. You can add tasks, drag them between TO DO, IN PROGRESS and DONE, put them in any order, edit, delete, and see which ones are overdue.

- Frontend: React
- Backend: Rust (axum, async-graphql), in `backend-rs`. It replaced the first backend, written in NestJS (still in `backend`), with the same API.
- API: GraphQL
- Database: PostgreSQL

## What it does
- Add a task (title, description, due date)
- Drag and drop a task to another column, or to a different place in the same column
- Change a task's status with the dropdown (it goes to the bottom of the new column)
- Edit a task, or delete it with the bin icon
- Late tasks are shown in red with an "Overdue" label
- Tasks and their order are saved, so they're still there after a restart

## How to run it
You need **Rust** (from https://rustup.rs), **Node.js** and **PostgreSQL** installed.

**1. Create the databases**

In pgAdmin, open the Query Tool and run these SQL Queries one at a time:

CREATE DATABASE taskboard;

CREATE DATABASE taskboard_test;

**2. Start the backend**

In the `backend` folder, copy `.env.example` to a new file called `.env`, and put your PostgreSQL password in it. (The Rust backend reads its settings from there.)

- Then in the terminal:
cd backend-rs
cargo run

The first time, it downloads and builds everything, which takes a few minutes. When it starts, it creates the tables in the database (or brings them up to date).

**3. Start the frontend** (in a new terminal)

cd frontend
npm install
npm run dev

Open http://localhost:5173 in your browser.

- If **npm** doesn't work, use **npm.cmd** instead

## Running the tests
The tests are in `backend/test/graphql.e2e-spec.ts`. They send real GraphQL requests to the API and check the answers. They use the `taskboard_test` database, so they don't touch your real tasks.

They only reach the backend over HTTP, and check what it saved with SQL, so they can test any backend with the same API. The assistant's chat goes to a fake Claude (`test/fake-claude.ts`): no real API calls, no cost. Test settings are in `test/e2e.env`.

To test the Rust backend (Linux/WSL), run this once in the `backend` folder:

npm install

and then, from the `backend-rs` folder:

scripts/e2e.sh

It starts two copies of the backend, one with the rate limits on, so every test runs. `cargo test` runs the Rust backend's own tests. See `backend-rs/README.md`.

The old NestJS backend can still be tested from the `backend` folder: `npm run test:e2e` starts it inside the test run, and `npm run test:e2e:external` (Linux/WSL) starts a production build of it as its own program.

To measure speed and memory, see `bench/README.md`.

## The API
Everything goes to one URL: `POST http://localhost:3000/graphql`. You can try it in the browser by opening that URL (it opens GraphiQL).

| Operation | Type | What it does |
|-----------|------|--------------|
| `tasks` | Query | Get all tasks, in board order |
| `createTask(input)` | Mutation | Add a task (it goes to the bottom of its column) |
| `updateTask(id, input)` | Mutation | Change a task's title, description, due date or status |
| `moveTask(id, input)` | Mutation | Put a task at a position in a column (used by drag and drop) |
| `deleteTask(id)` | Mutation | Delete a task |

Example:
```graphql
mutation {
  createTask(input: { title: "Buy milk", dueDate: "2026-10-20" }) { id title status }
}
```

Status values are `TODO`, `IN_PROGRESS` and `DONE`. The full schema is in `backend/src/schema.gql` (NestJS made it from its code; the Rust backend's schema is the same).

If something is wrong, the answer has an `errors` list instead of `data`. Unlike REST, this often still comes with **HTTP 200**:
- A wrong status, an unknown field or a wrong type (like `id: "abc"`) is rejected by GraphQL itself, with **HTTP 400**
- An empty title, a title over 100 characters or a date that doesn't exist is rejected by the validation, with the reason in `errors[0].extensions.originalError.message`
- A task that doesn't exist gives `Task <id> not found` in `errors[0].message`

I didn't add a status filter to the `tasks` query, because the page gets all tasks once and puts them into columns itself.

## Decisions I made
- **I used the company's tools** (React, NestJS, PostgreSQL) even though they were new to me, so it took longer.
- **The database table is made automatically** when the app starts. This is easy for a small project, but a real app should use migrations.
- **The API checks all input** (title not empty, max 100 characters, valid status, real date). The form checks some things too, but the API is the real safety net.
- **"Overdue" is worked out in the browser**, because "today" depends on where the user is. A task due today is not overdue yet.
- **Adding, editing and deleting only update the page after the save works.** If it fails, an error is shown and nothing changes.
- **Moving a card updates the page straight away**, then saves. Drag and drop has to feel instant, otherwise the card jumps back and forth. If the save fails, the board goes back to the real order from the server and an error is shown.
- **The order is stored as a `position` number** for each task in its column. Moving a card renumbers its column inside a database transaction, so the order can never be half-saved.
- **I switched the API from REST to GraphQL** because my supervisor asked me to learn it. For an app this small REST would have been enough, but it was a good way to learn GraphQL on code I already understood. I built GraphQL next to REST first, wrote tests for it, switched the frontend, and only then removed REST.

## The Rust backend
The backend was moved from NestJS to Rust, for speed and memory, one part at a time and without changing the API: the app and the Claude runner didn't notice. While it went on, the Rust backend answered what had already moved and passed everything else on to NestJS. Each part was checked by sending the same requests to both and comparing the answers. How it was done, and the few places where the answers still differ, are in `backend-rs/README.md`.

## What I'd do with more time
- Search and filter tasks
- Login, so each person only sees their own tasks (in progress)

## AI tools I used
- **Claude:** helped me learn React and NestJS, gave me hints if what I wrote doesn't work, explained errors, reviewed my code so I could fix my bugs, helped with git commands, changed my CSS colours into variables, and helped me write this README. For drag and drop and GraphQL, Claude guided me step by step while I wrote the code, and wrote some parts for me: finishing drag and drop, the GraphQL tests, the rest of `api.js`, reordering inside a column, and the delete icon. It also updated this README for the GraphQL changes.
- **Google Search AI:** is used mostly to know what't the syntax for specific functions and how it is written in javascript. I also used this to generate the color theme codes for vscode's tokyo night

## Time spent
About 1 week learning and building at the same time

## Notes
- I restarted the git history at the start because I accidentally uploaded `node_modules`.
- The `deadline-submission` tag shows what I had at the deadline.
