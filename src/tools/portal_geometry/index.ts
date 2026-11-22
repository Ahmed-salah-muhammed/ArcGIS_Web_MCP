import { z } from "zod";
import { defineTool, READ_ONLY } from "../shared/mcp";
import { AREA_UNITS, geometry, LENGTH_UNITS, MAX_GEOMETRIES } from "./handler";

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const tool = defineTool({
	name: "portal_geometry",
	title: "Geometry: project, buffer, measure",
	description: 'Geometry work that needs no layer, on your organization\'s geometry service (no credits): project (geometries from in_sr to out_sr) | buffer (distance + units around each geometry, geodesic; union merges them; the polygons work as geometry in portal_layer_query) | measure (polygons or boxes: area + perimeter; lines: length; geodesic) | distance (between exactly two geometries). A geometry is a [lon, lat] point, a [xmin, ymin, xmax, ymax] box or Esri geometry JSON (rings, paths, points); longitude/latitude unless in_sr says otherwise.',
	schema: z.object({
		action: z.enum(["project", "buffer", "measure", "distance"]),
		geometries: z.array(z.union([z.array(z.number()).min(2).max(4), z.record(z.string(), z.unknown())])).min(1).max(MAX_GEOMETRIES)
			.describe("One type per call: [x, y] points, [xmin, ymin, xmax, ymax] boxes, or Esri geometry JSON"),
		in_sr: z.number().int().optional().describe("WKID of the geometries; default 4326 (longitude/latitude)"),
		out_sr: z.number().int().optional().describe("project: the WKID to project to (required). buffer: default in_sr"),
		distance: z.number().positive().optional().describe("buffer: how far"),
		units: z.enum(keys(LENGTH_UNITS)).optional().describe("buffer / measure / distance; default meters"),
		area_units: z.enum(keys(AREA_UNITS)).optional().describe("measure: default square_meters"),
		union: z.boolean().optional().describe("buffer: merge the buffers into one geometry"),
	}),
	annotations: READ_ONLY,
	handle: (ctx, args) => geometry(ctx, args),
});
