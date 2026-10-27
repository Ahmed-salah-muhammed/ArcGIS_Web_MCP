import { describe, expect, it } from "vitest";
import {
	ArcGISError,
	arcgisRequest,
	authorizeUrl,
	base64url,
	challengeFor,
	exchangeCode,
	grantUserId,
	hostAllowed,
	randomVerifier,
	refreshAccessToken,
	scrub,
} from "../src/arcgis";

type Call = { url: string; body: URLSearchParams };

function fakeFetch(response: unknown, status = 200, calls: Call[] = []) {
	return (async (url: string, init: RequestInit) => {
		calls.push({ url: String(url), body: new URLSearchParams(String(init.body)) });
		const text = typeof response === "string" ? response : JSON.stringify(response);
		return new Response(text, { status });
	}) as unknown as typeof fetch;
}

describe("PKCE", () => {
	it("matches the RFC 7636 appendix B test vector", async () => {
		expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		);
	});

	it("makes 43-character URL-safe verifiers", () => {
		const v = randomVerifier();
		expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(randomVerifier()).not.toBe(v);
		expect(base64url(new Uint8Array([251, 255]))).toBe("-_8");
	});
});

describe("OAuth endpoints", () => {
	it("builds the ArcGIS authorize URL with code + S256", () => {
		const url = new URL(authorizeUrl({
			portal: "https://www.arcgis.com/", clientId: "abc", redirectUri: "https://w.example.dev/callback",
			state: "st", codeChallenge: "ch",
		}));
		expect(url.origin + url.pathname).toBe("https://www.arcgis.com/sharing/rest/oauth2/authorize");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: "abc", response_type: "code", redirect_uri: "https://w.example.dev/callback", state: "st",
			code_challenge: "ch", code_challenge_method: "S256", expiration: "20160",
		});
	});

	it("exchanges a code with the verifier and no client secret", async () => {
		const calls: Call[] = [];
		const t = await exchangeCode({ portal: "https://gis.example.com/portal", clientId: "abc",
			redirectUri: "https://w/cb", code: "c0de", verifier: "v" },
		fakeFetch({ access_token: "AT", expires_in: 1800, refresh_token: "RT", username: "u" }, 200, calls));
		expect(t.access_token).toBe("AT");
		expect(calls[0].url).toBe("https://gis.example.com/portal/sharing/rest/oauth2/token");
		expect(Object.fromEntries(calls[0].body)).toEqual({ grant_type: "authorization_code", client_id: "abc",
			redirect_uri: "https://w/cb", code: "c0de", code_verifier: "v", f: "json" });
	});

	it("maps an invalid refresh token to invalid_grant", async () => {
		const bad = fakeFetch({ error: { code: 400, error: "invalid_request", error_description: "Invalid refresh_token",
			message: "Invalid refresh_token" } });
		await expect(refreshAccessToken({ portal: "https://www.arcgis.com", clientId: "a", refreshToken: "r" }, bad))
			.rejects.toMatchObject({ code: "invalid_grant" });
		const down = fakeFetch("<html>bad gateway</html>", 502);
		await expect(refreshAccessToken({ portal: "https://www.arcgis.com", clientId: "a", refreshToken: "r" }, down))
			.rejects.toMatchObject({ code: "token_error" });
	});
});

describe("arcgisRequest", () => {
	it("posts f=json, JSON-encodes objects, and keeps the token out of the URL", async () => {
		const calls: Call[] = [];
		await arcgisRequest("https://services.arcgis.com/x/FeatureServer/0/query",
			{ where: "1=1", outStatistics: [{ statisticType: "sum" }], skip: undefined, empty: "" }, "SECRET-TOKEN-123",
			fakeFetch({ features: [] }, 200, calls));
		expect(calls[0].url).not.toContain("SECRET");
		expect(calls[0].body.get("token")).toBe("SECRET-TOKEN-123");
		expect(calls[0].body.get("f")).toBe("json");
		expect(calls[0].body.get("outStatistics")).toBe('[{"statisticType":"sum"}]');
		expect(calls[0].body.has("skip") || calls[0].body.has("empty")).toBe(false);
	});

	it("treats a 200 response with an error body as a failure, 498 as token_expired", async () => {
		const expired = fakeFetch({ error: { code: 498, message: "Invalid token.", details: [] } });
		const e = await arcgisRequest("https://www.arcgis.com/sharing/rest/search", {}, "t", expired).catch((x) => x);
		expect(e).toBeInstanceOf(ArcGISError);
		expect(e.code).toBe("token_expired");
		expect(e.message).toContain("Sign in again");
		const forbidden = fakeFetch({ error: { code: 403, message: "You do not have permissions", details: ["x"] } });
		await expect(arcgisRequest("https://www.arcgis.com/a", {}, "t", forbidden)).rejects.toMatchObject({ code: "forbidden" });
		await expect(arcgisRequest("https://www.arcgis.com/a", {}, "t", fakeFetch("<html/>", 500)))
			.rejects.toMatchObject({ code: "http_error" });
	});
});

describe("hostAllowed", () => {
	it("sends the token only to the portal and its services", () => {
		const online = "https://www.arcgis.com";
		expect(hostAllowed("https://services3.arcgis.com/abc/arcgis/rest/services/x/FeatureServer/0", online)).toBe(true);
		expect(hostAllowed("https://www.arcgis.com/sharing/rest/search", online)).toBe(true);
		expect(hostAllowed("https://evil.example.com/FeatureServer/0", online)).toBe(false);
		expect(hostAllowed("http://services3.arcgis.com/x", online)).toBe(false); // https only
		expect(hostAllowed("https://arcgis.com.evil.io/x", online)).toBe(false);
		const enterprise = "https://gis.example.com/portal";
		expect(hostAllowed("https://gis.example.com/server/rest/services/a/FeatureServer/0", enterprise)).toBe(true);
		expect(hostAllowed("https://services3.arcgis.com/x", enterprise)).toBe(false);
		expect(hostAllowed("https://maps.example.com/server/x", enterprise, ["maps.example.com"])).toBe(true);
		expect(hostAllowed("not a url", online)).toBe(false);
	});
});

describe("grantUserId", () => {
	it("never contains ':' (the provider splits authorization codes on ':')", () => {
		expect(grantUserId("https://www.arcgis.com", "jdoe_gis")).toBe("jdoe_gis@www.arcgis.com");
		expect(grantUserId("https://gis.example.com:7443/portal", "a:b")).not.toContain(":");
	});
});

describe("scrub", () => {
	it("masks token values and token= parameters", () => {
		expect(scrub("failed for abcdefgh12345 at https://x?token=zzz&f=json", "abcdefgh12345"))
			.toBe("failed for *** at https://x?token=***&f=json");
	});
});
