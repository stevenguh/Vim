import * as vscode from 'vscode';
import * as path from 'path';
import untildify = require('untildify');

export function separatePath(searchPath: string, separator: string) {
  // Special handle for UNC path on windows
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

export function getFullPath(filePathInCmd: string) {
  const currentUri = vscode.window.activeTextEditor!.document.uri;
  let isWindows: boolean;
  if (currentUri.scheme === 'untitled') {
    // If the file is untitled, we can only use the absolute path on local fs
    isWindows = path !== path.posix;
  } else {
    // Assuming other schemes return full path
    // e.g. 'file' and 'vscode-remote' both return full path
    // Also only scheme that support windows is 'file', so we can
    // safely check if fsPath returns '/' as the first character
    // (fsPath in 'vscode-remote' on Windows return \ as separator instead of /)
    isWindows = currentUri.scheme === 'file' && currentUri.fsPath[0] !== '/';
  }

  const p = isWindows ? path.win32 : path.posix;
  if (isWindows) {
    // normalize / to \ on windows
    filePathInCmd = filePathInCmd.replace(/\//g, '\\');
  }
  const updatedFilePathInCmd = filePathInCmd;

  if (currentUri.scheme === 'file' || currentUri.scheme === 'untitled') {
    // We can untildify when the scheme is 'file' or 'untitled' because
    // because the files we only support opening files mounted on the host.
    filePathInCmd = untildify(filePathInCmd);
  }

  let [dirName, baseName] = separatePath(filePathInCmd, p.sep);
  let fullDirPath: string;
  if (p.isAbsolute(dirName)) {
    fullDirPath = dirName;
  } else {
    fullDirPath = p.join(
      // On Windows machine:
      // fsPath returns Windows drive path (C:\xxx\) or UNC path (\\server\xxx)
      // fsPath returns path with \ as separator even if 'vscode-remote' is connect to a linux box
      //
      // path will return /home/user for example even 'vscode-remote' is used on windows
      // as we relied of our isWindows detection
      separatePath(isWindows ? currentUri.fsPath : currentUri.path, p.sep)[0],
      dirName
    );
  }

  const fullPath = p.join(fullDirPath, baseName);
  return <[string, string, string, string, string, typeof path]>[
    fullPath,
    fullDirPath,
    dirName,
    baseName,
    updatedFilePathInCmd,
    p,
  ];
}

export function getUriPath(currentUri: vscode.Uri, absolutePath: string, sep: string) {
  const isWindows = sep === path.win32.sep;
  if (isWindows && !/^(\\\\.+\\)|([a-zA-Z]:\\)/.test(absolutePath)) {
    // if it is windows and but don't have either
    // UNC path or the windows drive
    return null;
  }
  if (!isWindows && absolutePath[0] !== sep) {
    // if it is not windows, but the absolute path doesn't begin with /
    return null;
  }

  return isWindows
    ? // create new local Uri when it's on windows (doesn't support remote)
      // Use file will also works for UNC paths like //server1/folder
      vscode.Uri.file(absolutePath)
    : currentUri.with({
        // search local file with it's untitled
        scheme: currentUri.scheme === 'untitled' ? 'file' : currentUri.scheme,
        path: absolutePath,
      });
}

export async function readDirectory(
  currentUri: vscode.Uri,
  absolutePath: string,
  sep: string,
  addCurrentAndUp: boolean
) {
  try {
    const directoryUri = getUriPath(currentUri, absolutePath, sep);
    if (directoryUri === null) {
      return [];
    }
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
