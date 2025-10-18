declare module "json-source-map" {
	type Location = { line: number, column: number, pos: number}
	type MappingObject = { key: Location; keyEnd: Location, value: Location, valueEnd: Location }
	type Pointers = {
  		[key: string]: MappingObject;
	};
	export function parse(text: string): {data: any, pointers: Pointers}
}