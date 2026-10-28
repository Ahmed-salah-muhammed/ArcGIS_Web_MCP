/**
 * A custom widget for Experience Builder Developer Edition: the files of a widget folder, laid out and written the way
 * Esri's own widget skill and samples write them (Esri/arcgis-experience-builder-sdk-resources 1.21: skills/
 * arcgis-exb-widget-dev assets/widget-skeleton.md, widgets/feature-layer-function, widgets/map-view): manifest.json,
 * config.json, icon.svg, README.md, src/config.ts, src/runtime/widget.tsx (+ translations), src/setting/setting.tsx
 * (+ translations). Function components; data through DataSourceComponent, maps through JimuMapViewComponent; data
 * sources, fields and the map are chosen in the settings and saved through onSettingChange. Nothing is created in
 * ArcGIS: the files are returned with the steps that put them in client/your-extensions/widgets and run them.
 */
import { ArcGISError } from "../../arcgis";
import type { AppArgs } from "./types";

export const WIDGET_DATA = ["none", "layer", "map", "layer_and_map"] as const;
type Data = (typeof WIDGET_DATA)[number];

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const LICENSE = `/**
  Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
  with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
*/
`;

function runtime(name: string, data: Data): string {
	const usesLayer = data === "layer" || data === "layer_and_map";
	const usesMap = data === "map" || data === "layer_and_map";
	const k = camel(name);
	const core = ["React", "hooks", "type AllWidgetProps", ...(usesLayer ? ["DataSourceComponent", "DataSourceStatus", "type DataSource",
		"type IMDataSourceInfo", "type FeatureLayerQueryParams"] : [])];
	const lines = [LICENSE + `import { ${core.join(", ")} } from 'jimu-core'`,
		`import { Paper, WidgetPlaceholder } from 'jimu-ui'`,
		...(usesMap ? [`import { JimuMapViewComponent, type JimuMapView } from 'jimu-arcgis'`, `import reactiveUtils from 'esri/core/reactiveUtils'`] : []),
		`import type { IMConfig } from '../config'`, `import defaultMessages from './translations/default'`, "",
		`export default function Widget (props: AllWidgetProps<IMConfig>) {`,
		`  const translate = hooks.useTranslation(defaultMessages)`];
	if (usesMap) {
		lines.push(`  const [jimuMapView, setJimuMapView] = React.useState<JimuMapView>()`,
			`  const [scale, setScale] = React.useState<number>()`,
			`  const mapWidgetId = props.useMapWidgetIds?.[0]`, "",
			`  React.useEffect(() => {`,
			`    if (!jimuMapView?.view) return`,
			`    // follow the map: the scale once it stops moving`,
			`    const handle = reactiveUtils.watch(() => jimuMapView.view.stationary, (stationary) => {`,
			`      if (stationary) setScale(Math.round(jimuMapView.view.scale))`,
			`    }, { initial: true })`,
			`    return () => { handle.remove() }`,
			`  }, [jimuMapView])`, "");
	}
	if (usesLayer) {
		lines.push(`  const useDataSource = props.useDataSources?.[0]`,
			`  const fields = React.useMemo(() => Array.from(useDataSource?.fields ?? []), [useDataSource])`,
			`  const query = React.useMemo<FeatureLayerQueryParams>(() => ({`,
			`    where: '1=1',`,
			`    outFields: fields.length ? fields : ['*'],`,
			`    pageSize: 50`,
			`  }), [fields])`, "",
			`  const renderRecords = (ds: DataSource, info: IMDataSourceInfo) => {`,
			`    if (info.status === DataSourceStatus.Loading) return <div>{translate('${k}Loading')}</div>`,
			`    if (info.status === DataSourceStatus.LoadError) return <div role='alert'>{translate('${k}LoadError')}</div>`,
			`    if (info.status !== DataSourceStatus.Loaded) return null`,
			`    const records = ds.getRecords()`,
			`    if (!records.length) return <div>{translate('${k}NoData')}</div>`,
			`    const shown = fields[0]`,
			`    return (`,
			`      <ul className='${name}-records' style={{ listStyle: 'none', margin: 0, padding: 0, overflow: 'auto' }}>`,
			`        {records.map(record => (`,
			`          <li key={record.getId()}>`,
			`            {/* selecting a record selects it everywhere: the map highlights it, other widgets follow */}`,
			`            <button type='button' className='btn btn-link p-0' onClick={() => { ds.selectRecordsByIds([record.getId()]) }}>`,
			`              {String(shown ? record.getData()[shown] ?? '' : record.getId())}`,
			`            </button>`,
			`          </li>`,
			`        ))}`,
			`      </ul>`,
			`    )`,
			`  }`);
	}
	lines.push("");
	if (usesMap) {
		lines.push(`  if (!mapWidgetId) {`, `    return <WidgetPlaceholder widgetId={props.id} message={translate('${k}SelectMap')} />`, `  }`);
	}
	if (usesLayer) {
		lines.push(`  if (!useDataSource) {`, `    return <WidgetPlaceholder widgetId={props.id} message={translate('${k}SelectData')} />`, `  }`);
	}
	lines.push("", `  return (`,
		`    <Paper className='widget-${name} jimu-widget' aria-label={props.label} variant='flat' shape='none' style={{ overflow: 'auto' }}>`,
		`      {props.config?.heading && <h3>{props.config.heading}</h3>}`);
	if (usesMap) {
		lines.push(`      <JimuMapViewComponent useMapWidgetId={mapWidgetId} onActiveViewChange={setJimuMapView} />`,
			`      <div>{scale ? translate('${k}Scale', { scale: scale.toLocaleString() }) : translate('${k}Loading')}</div>`);
	}
	if (usesLayer) {
		lines.push(`      <DataSourceComponent useDataSource={useDataSource} query={query} widgetId={props.id} queryCount>`,
			`        {renderRecords}`, `      </DataSourceComponent>`);
	}
	if (data === "none") lines.push(`      <div>{props.config?.message || translate('${k}Empty')}</div>`);
	lines.push(`    </Paper>`, `  )`, `}`, "");
	return lines.join("\n");
}

function setting(name: string, data: Data): string {
	const usesLayer = data === "layer" || data === "layer_and_map";
	const usesMap = data === "map" || data === "layer_and_map";
	const k = camel(name);
	const core = ["React", "hooks", ...(usesLayer ? ["Immutable", "DataSourceTypes", "type UseDataSource", "type IMFieldSchema"] : [])];
	const lines = [LICENSE + `import { ${core.join(", ")} } from 'jimu-core'`,
		`import { TextInput } from 'jimu-ui'`,
		`import type { AllWidgetSettingProps } from 'jimu-for-builder'`,
		`import { SettingSection, SettingRow${usesMap ? ", MapWidgetSelector" : ""} } from 'jimu-ui/advanced/setting-components'`,
		...(usesLayer ? [`import { DataSourceSelector, FieldSelector } from 'jimu-ui/advanced/data-source-selector'`] : []),
		`import type { IMConfig } from '../config'`, `import defaultMessages from './translations/default'`, "",
		`export default function Setting (props: AllWidgetSettingProps<IMConfig>) {`,
		`  const translate = hooks.useTranslation(defaultMessages)`, ""];
	if (usesMap) {
		lines.push(`  // the map is framework-managed: saved through onSettingChange, with the widget's id`,
			`  const onMapChange = (useMapWidgetIds: string[]) => {`, `    props.onSettingChange({ id: props.id, useMapWidgetIds })`, `  }`, "");
	}
	if (usesLayer) {
		lines.push(`  const onDataSourceChange = (useDataSources: UseDataSource[]) => {`,
			`    props.onSettingChange({ id: props.id, useDataSources })`, `  }`, "",
			`  const onToggleUseDataEnabled = (useDataSourcesEnabled: boolean) => {`,
			`    props.onSettingChange({ id: props.id, useDataSourcesEnabled })`, `  }`, "",
			`  // the fields are saved on the data source, so it loads them`,
			`  const onFieldChange = (selected: IMFieldSchema[]) => {`,
			`    props.onSettingChange({`, `      id: props.id,`,
			`      useDataSources: [{ ...props.useDataSources[0], fields: selected.map(f => f.jimuName) }]`, `    })`, `  }`, "");
	}
	lines.push(`  const onTextChange = (key: 'heading'${data === "none" ? " | 'message'" : ""}) => (evt: React.ChangeEvent<HTMLInputElement>) => {`,
		`    props.onSettingChange({ id: props.id, config: props.config.set(key, evt.target.value) })`, `  }`, "",
		`  return (`, `    <div className='widget-setting-${name}'>`,
		`      <SettingSection title={translate('${k}Settings')}>`);
	if (usesMap) {
		lines.push(`        <SettingRow label={translate('${k}Map')}>`,
			`          <MapWidgetSelector useMapWidgetIds={props.useMapWidgetIds} onSelect={onMapChange} />`, `        </SettingRow>`);
	}
	if (usesLayer) {
		lines.push(`        <SettingRow label={translate('${k}Data')} flow='wrap'>`,
			`          <DataSourceSelector`, `            types={Immutable([DataSourceTypes.FeatureLayer])}`,
			`            useDataSources={props.useDataSources}`, `            useDataSourcesEnabled={props.useDataSourcesEnabled}`,
			`            onToggleUseDataEnabled={onToggleUseDataEnabled}`, `            onChange={onDataSourceChange}`,
			`            widgetId={props.id}`, `          />`, `        </SettingRow>`,
			`        {props.useDataSources?.length > 0 && (`, `          <SettingRow label={translate('${k}Fields')} flow='wrap'>`,
			`            <FieldSelector`, `              useDataSources={props.useDataSources}`, `              onChange={onFieldChange}`,
			`              selectedFields={props.useDataSources[0].fields || Immutable([])}`, `            />`, `          </SettingRow>`, `        )}`);
	}
	lines.push(`        <SettingRow label={translate('${k}Heading')}>`,
		`          <TextInput value={props.config.heading ?? ''} onChange={onTextChange('heading')} />`, `        </SettingRow>`);
	if (data === "none") {
		lines.push(`        <SettingRow label={translate('${k}Message')}>`,
			`          <TextInput value={props.config.message ?? ''} onChange={onTextChange('message')} />`, `        </SettingRow>`);
	}
	lines.push(`      </SettingSection>`, `    </div>`, `  )`, `}`, "");
	return lines.join("\n");
}

/** A widget name as Experience Builder takes it: lower-case words with hyphens (the folder has the same name). */
export function widgetName(label: string): string {
	const name = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	if (!/^[a-z][a-z0-9-]{1,49}$/.test(name)) throw new ArcGISError("custom_widget.name: letters, digits and hyphens, starting with a letter.", "bad_argument");
	return name;
}

/** The widget's files, by path inside its folder. */
export function widgetFiles(spec: { name: string; label?: string; description?: string; data?: Data; author?: string }, exbVersion: string) {
	const name = widgetName(spec.name);
	const data: Data = spec.data ?? "layer";
	if (!WIDGET_DATA.includes(data)) throw new ArcGISError(`custom_widget.data must be ${WIDGET_DATA.join(" | ")}.`, "bad_argument");
	if (!/^\d+\.\d+\.\d+$/.test(exbVersion)) throw new ArcGISError("exb_version must look like 1.21.0 (client/package.json's exb-client version).", "bad_argument");
	const label = String(spec.label ?? name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())).replace(/[<>"]/g, "");
	const description = String(spec.description ?? `${label} widget.`).replace(/[<>]/g, "");
	const usesMap = data === "map" || data === "layer_and_map";
	const usesLayer = data === "layer" || data === "layer_and_map";
	const k = camel(name);
	const manifest = { name, label, type: "widget", version: "1.0.0", exbVersion, author: String(spec.author ?? ""), description, copyright: "",
		license: "http://www.apache.org/licenses/LICENSE-2.0", ...(usesMap ? { dependency: "jimu-arcgis" } : {}),
		properties: { supportAutoSize: true }, translatedLocales: ["en"], defaultSize: { width: 400, height: 400 } };
	const runtimeMessages: Record<string, string> = { _widgetLabel: label, [`${k}Loading`]: "Loading...",
		...(usesLayer ? { [`${k}LoadError`]: "The data could not be loaded.", [`${k}NoData`]: "No records.", [`${k}SelectData`]: "Select data in the settings." } : {}),
		...(usesMap ? { [`${k}SelectMap`]: "Select a map widget in the settings.", [`${k}Scale`]: "Map scale 1:{scale}" } : {}),
		...(data === "none" ? { [`${k}Empty`]: "Write a message in the settings." } : {}) };
	const settingMessages: Record<string, string> = { [`${k}Settings`]: "Settings", [`${k}Heading`]: "Heading",
		...(usesMap ? { [`${k}Map`]: "Map" } : {}), ...(usesLayer ? { [`${k}Data`]: "Data", [`${k}Fields`]: "Fields" } : {}),
		...(data === "none" ? { [`${k}Message`]: "Message" } : {}) };
	const ts = (o: Record<string, string>) => `export default ${JSON.stringify(o, null, 2).replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, "$1:").replace(/"/g, "'")}\n`;
	const needs = [usesMap ? "a Map widget in the app (chosen in the settings)" : null, usesLayer ? "a feature layer data source and its fields (chosen in the settings)" : null]
		.filter(Boolean);
	return { name, files: {
		"manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
		"config.json": `${JSON.stringify(data === "none" ? { heading: "", message: "" } : { heading: "" }, null, 2)}\n`,
		"icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" d="M2 2h5v5H2zm7 0h5v5H9zM2 9h5v5H2zm7 0h5v5H9z"/></svg>\n',
		"README.md": [`# ${label}`, "", description, "", "## Needs", "", ...(needs.length ? needs.map((n) => `- ${n}`) : ["- Nothing: it shows the message set in its settings."]),
			"", "## Settings", "", `- Heading: text above the content.${data === "none" ? "\n- Message: the text the widget shows." : ""}`,
			...(usesLayer ? ["- Data and fields: the layer it lists (the first field is shown), 50 records per page."] : []),
			...(usesMap ? ["- Map: the map widget it follows (it shows the map's scale)."] : []), "",
			"## Behaviour", "", usesLayer ? "Choosing a record selects it in its data source, so the map and other widgets of that data show the selection." : "Runtime only shows what is configured.",
			"", "Made with ArcGIS Web MCP, following Esri's widget skeleton (arcgis-experience-builder-sdk-resources).", ""].join("\n"),
		"src/config.ts": [`import type { ImmutableObject } from 'jimu-core'`, "", `export interface Config {`, `  heading?: string`,
			...(data === "none" ? [`  message?: string`] : []), `}`, "", `export type IMConfig = ImmutableObject<Config>`, ""].join("\n"),
		"src/runtime/widget.tsx": runtime(name, data),
		"src/runtime/translations/default.ts": ts(runtimeMessages),
		"src/setting/setting.tsx": setting(name, data),
		"src/setting/translations/default.ts": ts(settingMessages),
	} };
}

/** The steps from these files to a widget in the builder, and out of it (Developer Edition guide, Esri's widget skill). */
export function widgetSteps(name: string) {
	return [
		"Experience Builder Developer Edition runs locally: in server/ `npm ci` then `npm start` (https://localhost:3001); in client/ "
			+ "`npm ci` then `npm start` (it builds the widgets). It signs in with a client ID: portal_app kind=exb_developer registers one.",
		`Create the folder client/your-extensions/widgets/${name}/ and write every file below into it, keeping the paths.`,
		"Stop and start the client (`npm start` in client/): a new widget folder, renamed files or a changed manifest.json need a restart.",
		`Open https://localhost:3001, create or open an experience, Insert widget: '${name}' is in the Custom group. Drag it onto the page and choose its map / data / fields in its settings.`,
		"From client/, run `npm run tscheck` to type-check your-extensions (Esri's finish check for widget work).",
		"Change the code in src/runtime/widget.tsx (what users see) and src/setting/setting.tsx (the settings panel); keep user strings in translations/default.ts.",
		"To share the app: in the builder, Publish, then Download it and host the folder on your web server; the widget travels inside the app.",
	];
}

export function customWidget(args: AppArgs) {
	if (!args.custom_widget?.name) throw new ArcGISError("custom_widget.name is required (e.g. 'site-list').", "bad_argument");
	const exb = args.exb_version ?? "1.21.0";
	const { name, files } = widgetFiles(args.custom_widget, exb);
	return { widget: name, folder: `client/your-extensions/widgets/${name}`, exb_version: exb, data: args.custom_widget.data ?? "layer",
		files, steps: widgetSteps(name),
		guide: "Esri's widget skill (skills/arcgis-exb-widget-dev in github.com/Esri/arcgis-experience-builder-sdk-resources) covers "
			+ "message actions, data actions, map tools and tests; an assistant with that skill installed can grow this widget further.",
		note: "Nothing was created in ArcGIS: write these files into your Developer Edition folder." };
}
