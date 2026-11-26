export interface BookIds {
    isbn13: string | null;
    isbn10: string | null;
    asin: string | null;
}

function isbn10CheckDigit(first9: string): string {
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += (10 - i) * Number(first9[i]);
    const check = (11 - (sum % 11)) % 11;
    return check === 10 ? "X" : String(check);
}

function isbn13CheckDigit(first12: string): string {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += (i % 2 === 0 ? 1 : 3) * Number(first12[i]);
    return String((10 - (sum % 10)) % 10);
}

export function isbn10To13(isbn10: string): string {
    const first12 = `978${isbn10.slice(0, 9)}`;
    return first12 + isbn13CheckDigit(first12);
}

export function isbn13To10(isbn13: string): string | null {
    if (!isbn13.startsWith("978")) return null;
    const first9 = isbn13.slice(3, 12);
    return first9 + isbn10CheckDigit(first9);
}

/** Sorts an "ISBN/UID" cell into ISBN-13, ISBN-10, or Amazon ASIN. Anything else is dropped. */
export function parseBookId(value: string): BookIds {
    const cleaned = value.replace(/^="?|"$/g, "").replace(/[\s-]/g, "").toUpperCase();
    if (/^97[89]\d{10}$/.test(cleaned)) {
        return { isbn13: cleaned, isbn10: isbn13To10(cleaned), asin: null };
    }
    if (/^\d{9}[\dX]$/.test(cleaned)) {
        return { isbn13: isbn10To13(cleaned), isbn10: cleaned, asin: null };
    }
    if (/^B0[A-Z0-9]{8}$/.test(cleaned)) return { isbn13: null, isbn10: null, asin: cleaned };
    return { isbn13: null, isbn10: null, asin: null };
}
