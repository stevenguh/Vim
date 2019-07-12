import * as vscode from 'vscode';
import * as path from 'path';
import untildify = require('untildify');

/**
 * Given relative path, calculate absolute path.
 */
export function GetAbsolutePath(partialPath: string): vscode.Uri {
  const editorFileUri = vscode.window.activeTextEditor!.document.uri;
  const editorFilePath = editorFileUri.path;
  let basePath: string;

  if (partialPath.startsWith('/')) {
    basePath = '/';
  } else if (partialPath.startsWith('~/')) {
    basePath = <string>untildify(partialPath);
    partialPath = '';
  } else if (partialPath.startsWith('./')) {
    basePath = path.dirname(editorFilePath);
    partialPath = partialPath.replace('./', '');
  } else if (partialPath.startsWith('../')) {
    basePath = path.dirname(editorFilePath) + '/';
  } else {
    basePath = path.dirname(editorFilePath);
  }

  return editorFileUri.with({
    path: basePath + partialPath,
  });
}
