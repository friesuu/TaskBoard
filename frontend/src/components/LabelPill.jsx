import { labelColorClass } from '../labelColors';

// One label as a pill: a dot and an outline in the label's colour, and its name
function LabelPill({ label })
{
    return(
        <span className={`pill label-pill ${labelColorClass(label.color)}`}>
            <span className="dot label-dot" aria-hidden="true" />
            {label.name}
        </span>
    );
}

export default LabelPill;
