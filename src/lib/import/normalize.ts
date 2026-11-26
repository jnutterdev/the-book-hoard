/** Lowercase, accents and punctuation stripped, leading article dropped: for comparing titles and names. */
export function normalizeText(value: string): string {
    return value
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/^(the|a|an) /, "");
}

/** The title without a subtitle or series note: "Dune: Book One" → "dune". */
export function mainTitle(title: string): string {
    return normalizeText(title.split(/[:(]/)[0] ?? title);
}

export function lastName(name: string): string {
    const parts = normalizeText(name).split(" ");
    return parts[parts.length - 1] ?? "";
}

/** Key for spotting the same book across imports when there's no ISBN. */
export function titleAuthorKey(title: string, authors: string[]): string {
    return `${mainTitle(title)}|${authors[0] ? lastName(authors[0]) : ""}`;
}
