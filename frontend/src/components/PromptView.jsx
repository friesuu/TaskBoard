// Claude's prompt, shown the way it's meant to be read: its Markdown headings, lists, **bold**, `code`
// and code blocks, with each [[FILL IN: …]] blank highlighted. A small renderer for only what prompts use
// (runner/PROMPT_STYLE.md). It builds React elements, so nothing in a prompt is ever run as HTML.
//   text: the prompt
//   onBlankClick(n): optional; the nth blank (0 = first) was clicked, e.g. to start filling it in

const INLINE = /(\[\[\s*FILL IN[^\]]*\]\]|`[^`\n]+`|\*\*[^*\n]+\*\*)/gi;
const IS_BLANK = /^\[\[\s*FILL IN/i;

function PromptView({ text, onBlankClick })
{
    let blankCount = 0; // numbers the blanks in reading order, to match the nth blank in the text

    const blank = (raw, key) => {
        const n = blankCount++;
        return onBlankClick
            ? <button key={key} type="button" className="prompt-blank" onClick={() => onBlankClick(n)}>{raw}</button>
            : <mark key={key} className="prompt-blank">{raw}</mark>;
    };

    // One line's text: plain words, `code`, **bold** and blanks (a blank written as `code` is still a blank)
    const inline = (line) => line.split(INLINE).filter(Boolean).map((part, i) => {
        if (IS_BLANK.test(part)) return blank(part, i);
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
        {
            const inner = part.slice(1, -1);
            return IS_BLANK.test(inner) ? blank(inner, i) : <code key={i}>{inner}</code>;
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{inline(part.slice(2, -2))}</strong>;
        return part;
    });

    // Lines become blocks: headings, paragraphs, lists (one level deeper per 2 spaces) and code blocks
    const blocks = [];
    let paragraph = [];
    let list = [];
    let code = null; // the lines of an open ``` block

    const endParagraph = () => {
        if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>);
        paragraph = [];
    };
    const endList = () => {
        if (list.length)
        {
            blocks.push(
                <ul key={blocks.length}>
                    {list.map((item, i) => <li key={i} className={`depth-${item.depth}`}>{inline(item.text)}</li>)}
                </ul>,
            );
        }
        list = [];
    };

    for (const line of (text ?? '').split('\n'))
    {
        if (code !== null)
        {
            if (line.trimStart().startsWith('```'))
            {
                blocks.push(<pre key={blocks.length}>{code.join('\n')}</pre>);
                code = null;
            }
            else code.push(line);
            continue;
        }

        const heading = line.match(/^#{1,6}\s+(.*)$/);
        const item = line.match(/^(\s*)(?:[-*]|\d+\.)\s+(.*)$/);
        if (line.trimStart().startsWith('```'))
        {
            endParagraph();
            endList();
            code = [];
        }
        else if (heading)
        {
            endParagraph();
            endList();
            blocks.push(<h4 key={blocks.length}>{inline(heading[1])}</h4>);
        }
        else if (item)
        {
            endParagraph();
            list.push({ depth: Math.min(Math.floor(item[1].length / 2), 3), text: item[2] });
        }
        else if (!line.trim())
        {
            endParagraph();
            endList();
        }
        else if (list.length && /^\s+/.test(line)) list[list.length - 1].text += ` ${line.trim()}`; // a list item's next line
        else
        {
            endList();
            paragraph.push(line.trim());
        }
    }
    if (code !== null) blocks.push(<pre key={blocks.length}>{code.join('\n')}</pre>);
    endParagraph();
    endList();

    return <div className="prompt-view">{blocks}</div>;
}

export default PromptView;
