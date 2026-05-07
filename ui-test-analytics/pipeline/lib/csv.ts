import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type CsvRow = Record<string, string>;

export async function readCsvRows(filePath: string): Promise<CsvRow[]> {
  const content = await readFile(filePath, 'utf8');
  const rows = parseCsv(content);

  if (rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;

  return dataRows
    .filter((row) => row.some((value) => value.trim() !== ''))
    .map((row) => {
      const record: CsvRow = {};

      for (let index = 0; index < header.length; index += 1) {
        record[header[index]] = row[index] ?? '';
      }

      return record;
    });
}

export async function appendCsvRows(
  outputFile: string,
  header: readonly string[],
  rows: readonly (readonly string[])[],
) {
  await mkdir(path.dirname(outputFile), { recursive: true });
  const shouldWriteHeader = !(await fileExistsWithContent(outputFile));
  const lines: string[] = [];

  if (shouldWriteHeader) {
    lines.push(toCsvLine(header));
  }

  for (const row of rows) {
    lines.push(toCsvLine(row));
  }

  if (lines.length > 0) {
    await appendFile(outputFile, `${lines.join('\n')}\n`, 'utf8');
  }
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        value += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = false;
        continue;
      }

      value += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(value);
      value = '';
      continue;
    }

    if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function toCsvLine(values: readonly string[]): string {
  return values.map(escapeCsvValue).join(',');
}

function escapeCsvValue(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

async function fileExistsWithContent(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size > 0;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
