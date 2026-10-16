import { InitialSchema1792122576483 } from './1792122576483-InitialSchema';
import { AddBoards1792125187609 } from './1792125187609-AddBoards';
import { AddTaskDetails1792139766723 } from './1792139766723-AddTaskDetails';

// Every migration, oldest first. Both the app (app.module.ts) and the command line (data-source.ts) read this list.
// After `npm run migration:generate`, import the new class here and add it to the END of the list.
export const migrations = [InitialSchema1792122576483, AddBoards1792125187609, AddTaskDetails1792139766723];
