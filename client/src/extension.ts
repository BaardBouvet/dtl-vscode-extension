/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import { TextDocument, TextEdit, languages, workspace, ExtensionContext, Range } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
    // formatter implemented using API
	// TODO how to support formatting selections?
	// TODO how about syntax highlighting, would be nice to highlight dtl function names with separate color
    languages.registerDocumentFormattingEditProvider({ scheme: 'file', language: 'json' }, {
        provideDocumentFormattingEdits(document: TextDocument): TextEdit[] {
			const firstLine = document.lineAt(0);
			const lastLine = document.lineAt(document.lineCount - 1);
			const fullRange = new Range(firstLine.range.start, lastLine.range.end);

			const value = JSON.parse(document.getText());
			
			function sortObjectKeysRecursively(obj: any): object {
				// If the input is not an object or is null, return it as is.
				if (typeof obj !== 'object' || obj === null) {
					return obj;
				}

				// If the input is an array, map over its elements and recursively sort each element.
				if (Array.isArray(obj)) {
					return obj.map(item => sortObjectKeysRecursively(item));
				}

				// For a plain object, get its keys, sort them, and create a new object.
				// TODO sort by convention
				const sortedKeys = Object.keys(obj).sort();
				const sortedObject: Record<string, object> = {};

				for (const key of sortedKeys) {
					sortedObject[key] = sortObjectKeysRecursively(obj[key]);
				}

				return sortedObject;
			}

			// TODO sort value recursively
			const formatted = JSON.stringify(sortObjectKeysRecursively(value), null, 0);
			let output = "";
			enum Context {
				Root,
				String,
				Array,
				Object,
				Escape
			}
			let indent = 0;
			const indentation = "  ";
			const stack: Context[] = [Context.Object];
			let prev = '';
			for (let i = 0; i < formatted.length; i++) {
				const c = formatted[i];
				function peek(): string | undefined {
					if (i < formatted.length - 1) {
						return formatted[i+1];
					}
					return undefined;
				}
				function peekStack(): Context {
					return stack[stack.length - 1];
				}
				// capture context on stack
				if (peekStack() == Context.Escape) {
					// end escape (and ignore whatever the character was)
					stack.pop();
				}
				if (peekStack() == Context.String) {
					// end string
					if (c == '"') {
						stack.pop();
					}
					// enter escape mode
					if (c == '\\') {
						stack.push(Context.Escape);
					}
				} else {
					if (c == '"') {
						// enter string
						stack.push(Context.String);
					} 
					if (c == '{') {
						// only indent objects inside object
						if (peekStack() == Context.Object) {
							indent += 1;
						}
						// enter object
						stack.push(Context.Object);
					} 
					if (c == '}') {
						// end object
						stack.pop();
						// only indent objects inside object
						if (peekStack() == Context.Object) {
							indent -= 1;
						}
					} 
					if (c == '[') {
						// enter array
						stack.push(Context.Array);
						indent += 1;
					} 
					if (c == ']') {
						// end array
						stack.pop();
						indent -= 1;
					}
				}

				const currentContext = peekStack();
				if (currentContext != Context.String && currentContext != Context.Escape) { 
					// newline before '}' unless end of empty object
					if (c == '}' && prev != '{') {
						output += '\n';
						// object end should align with array opening
						if (currentContext == Context.Array) {
							output += indentation.repeat(indent-1);
						} else {
							output += indentation.repeat(indent);
						}
					}
					// newline before array inside array
					if (c == '[' && stack.length > 1 && stack[stack.length - 2] == Context.Array) {
						output += '\n';
						output += indentation.repeat(indent - 1);
					}
					// newline before end of nested array
					if (c == ']' && prev == ']') {
						output += '\n';
						output += indentation.repeat(indent);
					}
				}

				output += c;

				if (currentContext != Context.String && currentContext != Context.Escape) { 
					// newline after '{' unless empty object
					if (c == '{' && peek() != '}') {
						output += '\n';
						output += indentation.repeat(indent);
					}
					if (c == ',') {
						if (currentContext == Context.Object) {
							output += '\n';
							output += indentation.repeat(indent);
						}
						if (currentContext == Context.Array) {
							output += ' ';
						}
					}
					if (c == ':') {
						output += ' ';
					}
				}
				prev = c;
			}
			return [TextEdit.replace(fullRange, output)];
        }
    });

	// The server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
		}
	};

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: 'file', language: 'json' }],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'languageServerExample',
		'Language Server Example',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
