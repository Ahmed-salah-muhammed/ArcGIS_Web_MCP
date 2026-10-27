import { describe, expect, it } from "vitest";
import { inferTheme, layerMetadata, prettify, tokens, webmapDescription } from "../../src/tools/shared/metadata";

describe("item metadata inference", () => {
	it("tokenizes names and matches keyword prefixes, not substrings", () => {
		expect(tokens("RoadNetwork_2024")).toEqual(["road", "network", "2024"]);
		expect(prettify("road_network")).toBe("Road Network");
		expect(inferTheme("roads", ["SPEED_LIMIT", "LANES"]).theme).toBe("transportation");
		expect(inferTheme("plots", ["ACREAGE"]).matched).not.toContain("age");
		expect(inferTheme("x", ["OBJECTID", "Shape__Area"])).toMatchObject({ theme: "general", score: 0 });
	});

	it("writes a summary, description and tags from the layer", () => {
		const m = layerMetadata("city_population", "esriGeometryPolygon", ["OBJECTID", "NAME", "POPULATION", "HOUSEHOLDS"], 1200);
		expect(m.theme).toBe("demographics");
		expect(m.summary).toBe("City Population: demographics and census statistics - Polygon layer (1,200 features)");
		expect(m.description).toContain("This area layer represents demographics and census statistics.");
		expect(m.description).toContain("Key attributes include NAME, POPULATION, HOUSEHOLDS.");
		expect(m.tags).toContain("ArcGIS Web MCP");
		expect(m.tags).toContain("Polygon");
		expect(m.tags.length).toBeLessThanOrEqual(12);
	});

	it("describes a web map from its layers", () => {
		expect(webmapDescription([{ name: "Roads", theme_label: "a transportation network" }, { name: "Rivers" }]))
			.toBe("This web map brings together 2 layers: Roads, Rivers. It covers transportation network. Described by ArcGIS Web MCP.");
	});
});
