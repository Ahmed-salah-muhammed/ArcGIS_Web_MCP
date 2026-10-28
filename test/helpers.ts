/** Shared test fixtures: a signed-in user's props and a fake ArcGIS behind the tool context. */
import { vi } from "vitest";
import type { ArcGISProps } from "../src/arcgis";
import type { Ctx } from "../src/tools/shared/context";

export const ID = "a".repeat(32);
export const ID2 = "b".repeat(32);
export const SVC = "https://services1.arcgis.com/ORG/arcgis/rest/services/pts/FeatureServer";
export const ADMIN = "https://services1.arcgis.com/ORG/arcgis/rest/admin/services/pts/FeatureServer";
export const USER = "/sharing/rest/content/users/jdoe_gis";

export const props: ArcGISProps = {
	username: "jdoe_gis", fullName: "Jane Doe", role: "org_publisher", orgId: "ORG", orgName: "Example Org",
	isPortal: false, portal: "https://www.arcgis.com", accessToken: "ACCESS-TOKEN-XYZ", refreshToken: "REFRESH-TOKEN-XYZ",
	expiresAt: Date.now() + 1_800_000,
};

export type Route = (params: Record<string, unknown>) => unknown;
export type Call = { via: "request" | "get" | "upload" | "public"; url: string; params: Record<string, unknown>; file?: unknown };

/** Routes match by URL suffix (longest wins); every call is recorded so tests can prove what was NOT sent. */
export function fakeCtx(routes: Record<string, Route>, p: ArcGISProps = props) {
	const calls: Call[] = [];
	const answer = (via: Call["via"], url: string, params: Record<string, unknown> = {}, file?: unknown) => {
		calls.push({ via, url, params, file });
		const key = Object.keys(routes).filter((k) => url.endsWith(k)).sort((a, b) => b.length - a.length)[0];
		if (!key) throw new Error(`unexpected ${via} ${url}`);
		return routes[key](params);
	};
	const ctx: Ctx = {
		props: p,
		request: async (url, params) => answer("request", url, params),
		get: async (url, params) => answer("get", url, params),
		upload: async (url, params, file) => answer("upload", url, params, file),
		publicGet: async (url, params) => answer("public", url, params),
		publicUpload: async (url, params, file) => answer("public", url, params, file),
		publicPost: async (url, params) => answer("public", url, params),
		wait: async () => {},
	};
	const urls = () => calls.map((c) => c.url);
	return { ctx, calls, urls };
}

/** Keeps the audit lines that writes print out of the test output. */
export const silence = () => vi.spyOn(console, "log").mockImplementation(() => {});
