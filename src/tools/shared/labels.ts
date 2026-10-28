/** One label class from an Arcade expression, placed the usual way for the layer's geometry. */
export function labelClass(geometryType: string | undefined, expression: string) {
	return {
		labelExpressionInfo: { expression },
		symbol: { type: "esriTS", color: [0, 0, 0, 255], haloColor: [255, 255, 255, 255], haloSize: 1, font: { size: 10, family: "Arial" } },
		labelPlacement: geometryType === "esriGeometryPolyline" ? "esriServerLinePlacementAboveAlong"
			: geometryType === "esriGeometryPolygon" ? "esriServerPolygonPlacementAlwaysHorizontal"
				: "esriServerPointLabelPlacementAboveRight",
	};
}
