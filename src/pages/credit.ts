/** The "Developed by" badge shared by every page, plus the small helpers the pages share. */
import type { Author } from "./identity";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
	.replace(/"/g, "&quot;").replace(/'/g, "&#039;");

export const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' "
	+ "stroke='%23007ac2' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='9.5'/%3E%3Cpath d='M2.5 12h19M12 2.5c2.6 2.7 "
	+ "3.9 5.9 3.9 9.5s-1.3 6.8-3.9 9.5c-2.6-2.7-3.9-5.9-3.9-9.5S9.4 5.2 12 2.5z'/%3E%3C/svg%3E";

function initials(name: string): string {
	return name.split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? "").filter(Boolean).slice(0, 2)
		.join("").toUpperCase();
}

/** Styles for the credit; uses --credit-* so each page can theme it. */
export const CREDIT_CSS = `
  .credit { display: flex; justify-content: center; margin: 2rem 0 1rem; }
  .credit .author { display: inline-flex; align-items: center; gap: .85rem; max-width: 100%;
    padding: .55rem 1.15rem .55rem .55rem; border: 1px solid var(--credit-line, #e3e8ef); border-radius: 999px;
    background: var(--credit-bg, #fff); color: var(--credit-text, #1f2933); text-decoration: none;
    transition: border-color .15s, transform .15s; }
  .credit a.author:hover { border-color: var(--credit-brand, #007ac2); transform: translateY(-1px); }
  .credit .avatar { flex: none; width: 2.25rem; height: 2.25rem; border-radius: 50%; display: grid; place-items: center;
    background: linear-gradient(135deg, #007ac2, #35ac46); color: #fff; font-weight: 700; font-size: .78rem;
    letter-spacing: .02em; }
  .credit img.avatar { object-fit: cover; background: #d9dee5;
    box-shadow: 0 0 0 2px var(--credit-bg, #fff), 0 0 0 3px var(--credit-line, #e3e8ef); }
  .credit .who { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; text-align: left; }
  .credit .by { font-size: .68rem; text-transform: uppercase; letter-spacing: .08em; color: var(--credit-muted, #5b6b7b); }
  .credit .who strong { font-size: .98rem; white-space: nowrap; }
  .credit .role { font-size: .8rem; color: var(--credit-muted, #5b6b7b); }
  .credit .go { flex: none; display: inline-flex; align-items: center; gap: .2rem; margin-left: .35rem; font-size: .85rem;
    font-weight: 600; color: var(--credit-brand, #007ac2); }
  @media (max-width: 480px) {
    .credit .author { border-radius: 18px; gap: .7rem; padding-right: .9rem; }
    .credit .who strong { font-size: .9rem; }
    .credit .go .label { display: none; }
  }
`;

const SAFE_PHOTO = /^(data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+|https:\/\/\S+)$/;

// An SVG, not the U+2197 character: Windows renders that one as a color emoji in some font stacks
export const ARROW = `<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l5-5M4.5 3.5h4v4"/></svg>`;

/** The developer's photo (or initials) as an <img>/<span> with the given class. */
export function avatarHtml(author: Author, cls = "avatar", size = 36): string {
	return author.photo && SAFE_PHOTO.test(author.photo)
		? `<img class="${cls}" src="${esc(author.photo)}" alt="" width="${size}" height="${size}">`
		: `<span class="${cls}" aria-hidden="true">${esc(initials(author.name))}</span>`;
}

/** The credit pill (a link when there is a URL); "" when there is no author. */
export function creditHtml(author: Author | null): string {
	if (!author) return "";
	const inner = avatarHtml(author)
		+ `<span class="who"><span class="by">Developed by</span><strong>${esc(author.name)}</strong>`
		+ (author.title ? `<span class="role">${esc(author.title)}</span>` : "") + "</span>"
		+ (author.url ? `<span class="go"><span class="label">Portfolio</span>${ARROW}</span>` : "");
	return author.url
		? `<footer class="credit"><a class="author" href="${esc(author.url)}" target="_blank" rel="noopener noreferrer">${inner}</a></footer>`
		: `<footer class="credit"><span class="author">${inner}</span></footer>`;
}
