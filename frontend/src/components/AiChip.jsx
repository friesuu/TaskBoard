import { AI_STATES } from '../aiState';

// The one small chip an AI task gets on its card (and at the top of its AI tab): a status dot and its words,
// so the status never relies on colour alone.
//   state: one of AI_STATES (see aiState.js); nothing is shown for null
//   active: the runner is working on this task right now: the dot pulses (it stays still if you've asked
//           your computer for reduced motion)
function AiChip({ state, active = false })
{
    const info = AI_STATES[state];
    if (!info) return null;

    return(
        <span className={state === 'failed' ? 'pill ai-chip danger' : 'pill ai-chip'}>
            <span className={`dot dot-${info.tone}${info.live && active ? ' pulsing' : ''}`} aria-hidden="true" />
            {info.label}
        </span>
    );
}

export default AiChip;
