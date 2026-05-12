import { existsSync, statSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE_PATH = join(__dirname, 'planes-financiacion.xlsx');

// Top-level await: se ejecuta una sola vez al importar el módulo
let XLSX = null;
try {
  XLSX = await import('xlsx');
} catch {
  console.warn('Paquete xlsx no instalado. Ejecutá: npm install xlsx');
}

let cache = { content: null, mtime: null };

export function getFinancingPlans() {
  if (!XLSX || !existsSync(FILE_PATH)) return null;

  try {
    const mtime = statSync(FILE_PATH).mtimeMs;
    if (cache.mtime === mtime && cache.content !== null) return cache.content;

    const workbook = XLSX.read(readFileSync(FILE_PATH));
    const sections = workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
      return `### ${name}\n${csv}`;
    });

    cache = { content: sections.join('\n\n'), mtime };
    return cache.content;
  } catch (err) {
    console.error('Error leyendo planes-financiacion.xlsx:', err.message);
    return null;
  }
}
