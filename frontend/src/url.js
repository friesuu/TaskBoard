// The address bar as app state (?board=3 now; filters later), so a refresh or a bookmark opens the same thing.

export function getUrlParam(name)
{
    return new URLSearchParams(window.location.search).get(name);
}

// null removes it. replaceState changes the address without reloading the page or adding a Back-button step.
export function setUrlParam(name, value)
{
    const params = new URLSearchParams(window.location.search);
    if (value === null || value === undefined || value === '') params.delete(name);
    else params.set(name, String(value));

    const query = params.toString();
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
}
