// tone = the status colour from the design system, shown as a dot next to the status
// (info = periwinkle "later", warning = peach "in progress", success = mint "done";
//  prompt = purple and ai = teal: the Claude runner's two review columns)
export const STATUSES = [
    {value: 'TODO', label: 'To do', tone: 'info'},
    {value: 'PROMPT_REVIEW', label: 'Prompt Review', tone: 'prompt'},
    {value: 'IN_PROGRESS', label: 'In Progress', tone: 'warning'},
    {value: 'AI_REVIEW', label: 'AI Review', tone: 'ai'},
    {value: 'DONE', label: 'Done', tone: 'success'}
]
