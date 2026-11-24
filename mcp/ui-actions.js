export function readScreenText(maxChars) {
    return document.body.innerText.slice(0, maxChars);
}

export function clickByText(text) {
    const clickable = "button, [role=button], a, li";
    const candidates = [...document.querySelectorAll(`${clickable}, p, span`)];
    const visible = candidates.filter(node => node.offsetParent !== null && node.innerText.trim() === text);
    if (visible.length === 0) throw new Error(`No visible element with the text "${text}"`);

    const target = visible[0].closest(clickable) ?? visible[0];
    target.click();

    return { clicked: target.tagName, matches: visible.length };
}

export async function runTerminalCommand(command) {
    const input = document.getElementById("terminal-input");
    if (input === null) throw new Error('The Terminal is not open. Call ui_click with "Terminal" first.');

    const propsKey = Object.keys(input).find(key => key.startsWith("__reactProps"));
    if (propsKey === undefined) throw new Error("Terminal input has no React props; the game UI changed");

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setValue.call(input, command);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input[propsKey].onKeyDown({ key: "Enter", code: "Enter", keyCode: 13, preventDefault() {}, stopPropagation() {} });
    await new Promise(resolve => setTimeout(resolve, 500));

    return [...document.querySelectorAll("#terminal li")].slice(-30).map(line => line.innerText);
}
