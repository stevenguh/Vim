import * as vscode from 'vscode';
import * as path from 'path';

export function separatePath(searchPath: string, separator: string) {
  // Speical handle for UNC path on windows
  const _fwSlash = '\\';
  if (separator === path.win32.sep) {
    if (searchPath[0] === _fwSlash && searchPath[1] === _fwSlash) {
      const idx = searchPath.indexOf(_fwSlash, 2);
      if (idx === -1) {
        // If there isn't a complete UNC path,
        // return the incomplete UNC as baseName
        // e.g. \\test-server is an incomplete path
        // and \\test-server\ is a complete path
        return [searchPath, ''];
      }
    }
  }

  let baseNameIndex = searchPath.lastIndexOf(separator) + 1;
  const baseName = searchPath.slice(baseNameIndex);
  const dirName = searchPath.slice(0, baseNameIndex);
  return [dirName, baseName];
}

export async function readDirectory(
  currentUri: vscode.Uri,
  absolutePath: string,
  sep: string,
  addCurrentAndUp: boolean
) {
  try {
    const isWindows = sep === path.win32.sep;
    if (isWindows && !/^(\\\\.+\\)|([a-zA-Z]:\\)/.test(absolutePath)) {
      // if it is windows and but don't have either
      // UNC path or the windows drive
      return [];
    }
    if (!isWindows && absolutePath[0] !== sep) {
      // if it is not windows, but the absolute path doesn't begin with /
      return [];
    }

    const directoryUri = isWindows
      ? // create new local Uri when it's on windows (doesn't support remote)
        // Use file will also works for UNC paths like //server1/folder
        vscode.Uri.file(absolutePath)
      : currentUri.with({
          // search local file with it's untitled
          scheme: currentUri.scheme === 'untitled' ? 'file' : currentUri.scheme,
          path: absolutePath,
        });
    const directoryResult = await vscode.workspace.fs.readDirectory(directoryUri);
    return directoryResult
      .map(
        d =>
          <[string, vscode.FileType]>[d[0] + (d[1] === vscode.FileType.Directory ? sep : ''), d[1]]
      )
      .concat(
        addCurrentAndUp
          ? [[`.${sep}`, vscode.FileType.Directory], [`..${sep}`, vscode.FileType.Directory]]
          : []
      );
  } catch {
    return [];
  }
}
