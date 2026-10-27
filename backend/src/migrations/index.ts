import { InitialSchema1792122576483 } from './1792122576483-InitialSchema';
import { AddBoards1792125187609 } from './1792125187609-AddBoards';
import { AddTaskDetails1792139766723 } from './1792139766723-AddTaskDetails';
import { AddLabels1792323520653 } from './1792323520653-AddLabels';
import { AddUserTimeZone1792329867365 } from './1792329867365-AddUserTimeZone';
import { AddAttachments1792336190154 } from './1792336190154-AddAttachments';
import { AddChatResponseTime1792464610909 } from './1792464610909-AddChatResponseTime';
import { AddProfileSettings1792938232098 } from './1792938232098-AddProfileSettings';
import { AddClaudeRunner1793065936801 } from './1793065936801-AddClaudeRunner';
import { AddAgentRuns1793067333467 } from './1793067333467-AddAgentRuns';
import { AddAiBuiltAt1793073308265 } from './1793073308265-AddAiBuiltAt';
import { AddAiActivity1793083340862 } from './1793083340862-AddAiActivity';

// Every migration, oldest first. Both the app (app.module.ts) and the command line (data-source.ts) read this list.
// After `npm run migration:generate`, import the new class here and add it to the END of the list.
export const migrations = [
    InitialSchema1792122576483, 
    AddBoards1792125187609, 
    AddTaskDetails1792139766723, 
    AddLabels1792323520653, 
    AddUserTimeZone1792329867365, 
    AddAttachments1792336190154,
    AddChatResponseTime1792464610909,
    AddProfileSettings1792938232098,
    AddClaudeRunner1793065936801,
    AddAgentRuns1793067333467,
    AddAiBuiltAt1793073308265,
    AddAiActivity1793083340862,
];
