/** Zip reading with fflate (pure JavaScript, works in every runtime). */
import { unzipSync } from 'fflate';

/** Names of the entries matching `test`, without decompressing anything. */
export function zipEntryNames(bytes, test = () => true) {
  const names = [];
  unzipSync(bytes, {
    filter(file) {
      if (test(file.name)) {
        names.push(file.name);
      }
      return false;
    },
  });
  return names.sort();
}

/** Decompress one entry; returns `Uint8Array` or throws when missing. */
export function zipEntry(bytes, name) {
  const files = unzipSync(bytes, { filter: (file) => file.name === name });
  if (!files[name]) {
    throw new Error(`Zip entry not found: ${name}`);
  }
  return files[name];
}
