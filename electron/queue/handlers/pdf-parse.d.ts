/**
 * Type declarations for pdf-parse
 */

declare module 'pdf-parse' {
  interface PdfInfo {
    Title?: string;
    Author?: string;
    Subject?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
  }

  interface PdfData {
    text: string;
    numpages: number;
    numrender: number;
    info: PdfInfo;
    metadata: Record<string, unknown> | null;
    version: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PdfData>;

  export = pdfParse;
}
