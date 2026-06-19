import { File as BufferFile } from "buffer";

if (typeof global.File === 'undefined') {
  (global as any).File = BufferFile || class File extends Blob {
    name: string;
    lastModified: number;
    constructor(fileBits: any[], fileName: string, options?: any) {
      super(fileBits, options);
      this.name = fileName;
      this.lastModified = options?.lastModified || Date.now();
    }
  } as any;
}
