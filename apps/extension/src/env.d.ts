/** Build-time environment (from `.env` files; WXT exposes `WXT_*` keys). */
interface ImportMetaEnv {
  /** Public client id of the Geld GitHub App, used for sign-in (device flow). */
  readonly WXT_GELD_APP_CLIENT_ID?: string;
}

/** Chromium's File System Access additions that TypeScript's DOM library does not ship; nightly builds only. */
interface FileSystemHandlePermissionDescriptor {
  readonly mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DirectoryPickerOptions {
  readonly id?: string;
  readonly mode?: 'read' | 'readwrite';
}

interface Window {
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
