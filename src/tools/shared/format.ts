/** How results are shaped: ISO dates, truncated text, compact item cards. */

export function iso(ms: unknown): string | null {
	if (ms === null || ms === undefined || ms === "" || ms === -1 || ms === 0) return null;
	const n = Number(ms);
	if (!Number.isFinite(n)) return null;
	try {
		return new Date(n).toISOString().replace(/\.\d{3}Z$/, "Z");
	} catch {
		return null;
	}
}

export function truncate(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit)}... [${text.length - limit} more chars]` : text;
}

function itemUrl(portal: string, id: string): string {
	return `${portal.replace(/\/+$/, "")}/home/item.html?id=${id}`;
}

export function itemCard(it: any, portal: string, full = false): Record<string, unknown> {
	const out: Record<string, unknown> = {
		id: it.id, title: it.title, type: it.type, owner: it.owner, access: it.access, url: it.url ?? null,
		modified: iso(it.modified), item_url: it.id ? itemUrl(portal, it.id) : null,
	};
	if (full) {
		const kw: string[] = it.typeKeywords ?? [];
		Object.assign(out, {
			snippet: it.snippet ?? null,
			description: it.description ? truncate(String(it.description), 1500) : null,
			tags: it.tags ?? [], typeKeywords: kw, created: iso(it.created), size_bytes: it.size ?? null,
			numViews: it.numViews ?? null, extent: it.extent ?? null,
			is_hosted: kw.includes("Hosted Service"), is_view: kw.includes("View Service"),
		});
	}
	return out;
}
