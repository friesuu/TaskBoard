import { LABEL_COLORS, labelColorClass } from '../labelColors';

// Pick one colour from the label palette. Real radio buttons (so arrow keys work), drawn as round swatches.
// name must be unique on the page (it groups the radio buttons).
function ColorPicker({ name, value, onChange })
{
    return(
        <fieldset className="color-picker">
            <legend>Colour</legend>
            <div className="swatches">
                {LABEL_COLORS.map((c) => (
                    <label key={c.value} className="swatch" title={c.name}>
                        <input
                            type="radio"
                            name={name}
                            value={c.value}
                            checked={value === c.value}
                            onChange={() => onChange(c.value)}
                        />
                        <span className={`swatch-dot ${labelColorClass(c.value)}`} aria-hidden="true" />
                        <span className="sr-only">{c.name}</span>
                    </label>
                ))}
            </div>
        </fieldset>
    );
}

export default ColorPicker;
