import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  CompletionItemKind,
  InitializeParams,
  InitializeResult,
  TextDocumentPositionParams,
  CompletionItem,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';

import {
  TextDocument
} from 'vscode-languageserver-textdocument';

import { parse as sourceParse } from 'json-source-map';
import { parse } from 'jsonc-parser';

// Create a connection for the server
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager
const documents = new TextDocuments<TextDocument>(TextDocument);


class WorkspaceFileIndex {
  checkId(_id: string, uri: string): string[] {
    const conflicts = new Map(
      [...this.ids.entries()].filter(([key, value]) => key != uri && value == _id)
    );
    return Array.from(conflicts.keys());
  }
  // uri to sink dataset name
  private datasets = new Map<string, any>();
  // uri to system
  private systems = new Map<string, any>();
  // uri to _id
  private ids = new Map<string, any>();

  public async processFile(filename: string): Promise<void> {
    const content = await fs.readFile(filename, 'utf-8');
    let json;
    try {
      json = parse(content);
    } catch (e) {
      // Ignore JSON parsing errors (basic syntax errors)
      return;
    }
    this.processJson(json, 'file://' + filename);
    console.log(`Processed file: ${filename}`);
  }

  public processJson(json: any, uri: string) {
    if (typeof json === 'object') {
      this.ids.set(uri, json._id);
      switch (parseType(uri)) {
        case Type.Pipe:
          const sinkType = json.sink?.type ?? "dataset";
          if (sinkType == "dataset") {
            const sinkDataset = json.sink?.dataset ?? json._id;
            this.datasets.set(uri, sinkDataset);
          }
          break;
        case Type.System:
          this.systems.set(uri, json);
          break;
      }
    }
  }
}
const index = new WorkspaceFileIndex();

connection.onInitialize((params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      completionProvider: {
        resolveProvider: false
      }
    }
  };
});

connection.onInitialized(async () => {
  connection.console.log('Client is initialized. Starting initial workspace scan...');
  try {
    const folders = await connection.workspace.getWorkspaceFolders();
    if (folders) {
      for (const folder of folders) {
        const workspacePath = new URL(folder.uri).pathname;
        await scanDirectory(path.join(workspacePath, "pipes"), index);
        await scanDirectory(path.join(workspacePath, "systems"), index);
      }
    }
    connection.console.log('Initial workspace scan completed.');
  } catch (error) {
    connection.console.error('Initial workspace scan failed: ' + error);
  }
});

enum Type {
  Pipe = "Pipe",
  System = "System",
  Unknown = "Unknown"
}

function parseType(uri: string): Type {
  const basename = path.basename(path.dirname(uri));
  switch (basename) {
    case "pipes": return Type.Pipe;
    case "systems": return Type.System;
    default: return Type.Unknown;
  }
}

async function scanDirectory(currentPath: string, index: WorkspaceFileIndex) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && path.extname(entry.name) == ".json") {
      const entryPath = path.join(currentPath, entry.name);
      await index.processFile(entryPath);
    }
  }
}

import * as fs from 'fs/promises';
import * as path from 'path';

function extractSinkDataset(json: any): string | undefined {
  return json?.sink?.dataset || json?._id;
}

// Custom validation rule: Require a "name" field at root with string value
function validateJson(textDocument: TextDocument): void {
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  let json: any;
  try {
    json = parse(text);
  } catch (e) {
    // Ignore JSON parsing errors (basic syntax errors)
    return;
  }

  index.processJson(json, textDocument.uri);
  const type = parseType(textDocument.uri);
  if (type !== Type.Unknown) {
    if (typeof json !== 'object') {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: textDocument.positionAt(0),
          end: textDocument.positionAt(text.length)
        },
        message: type + ': must be an Object.',
        source: 'json-lsp'
      });
    } else {
      // TODO we might have json with errors as parse is lenient and sourceParse might fail
      const {data, pointers} = sourceParse(text);
      if (!("_id" in json)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
              start: textDocument.positionAt(0),
              end: textDocument.positionAt(text.length)
          },
          message: type + ': missing "_id" field.',
          source: 'json-lsp'
        });
      } else {
        // we have _id
        if (typeof(json._id) !== 'string') {
          const idPointer = pointers['/_id'];
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: textDocument.positionAt(idPointer.value.pos),
              end: textDocument.positionAt(idPointer.valueEnd.pos),
            },
            message: type + ': "_id" field must be type string.',
            source: 'json-lsp'
          });
        } else {
          // _id is a string
          const conflictingUris = index.checkId(json._id, textDocument.uri);
          if (conflictingUris.length > 0) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: {
                start: textDocument.positionAt(pointers['/_id'].value.pos),
                end: textDocument.positionAt(pointers['/_id'].valueEnd.pos),
              },
              message: type + ': must have a unique "_id" field, already defined in: ' + conflictingUris,
              source: 'json-lsp'
            });
          }
        }
        }
    }
  }
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

documents.onDidChangeContent(change => {
  validateJson(change.document);
});

// Autocomplete: Suggest root-level keys
connection.onCompletion(
  (_params: TextDocumentPositionParams): CompletionItem[] => {
    return [
      {
        label: '"name"',
        kind: CompletionItemKind.Property,
        documentation: 'Name of the item',
        insertText: '"name": "$1"',
      },
      {
        label: '"version"',
        kind: CompletionItemKind.Property,
        documentation: 'Version of the item',
        insertText: '"version": "$1"',
      }
    ];
  }
);

// Make the text document manager listen on the connection
documents.listen(connection);

connection.onDidChangeWatchedFiles(_change => {
  // Monitored files have change in VSCode
  connection.console.log('We received a file change event');
});

// Listen on the connection
connection.listen();


// TODO handle filenames with spaces in them (uri encode?)
// TODO handle file deletes in the index
// TODO handle autocompletion (based on json schemas?)