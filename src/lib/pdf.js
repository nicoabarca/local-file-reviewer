import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const base = `${import.meta.env.BASE_URL}pdfjs/`;

/**
 * Open PDF bytes. PDF content is untrusted: no scripting, no XFA, no remote
 * resource fetches. Every helper file is served from this app's own origin.
 */
export function loadPdf(bytes) {
  return pdfjsLib.getDocument({
    // PDF.js transfers the buffer to its worker, so hand it a copy and keep
    // the original snapshot intact for re-hashing and export.
    data: bytes.slice(0),
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    enableXfa: false,
    isEvalSupported: false,
    disableAutoFetch: true,
    stopAtErrors: false,
  }).promise;
}

export const { TextLayer, Util } = pdfjsLib;
