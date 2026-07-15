import type { LanguageDraft } from "./zipTypes";

export const LANGUAGE_NATIVE_NAMES: Record<string, string> = {
  "zh-cn": "简体中文",
  "zh-tw": "繁體中文",
  "en-us": "English",
  "ko-kr": "한국어",
  "ja-jp": "日本語",
  "es-es": "Español",
  "fr-fr": "Français",
  "ru-ru": "Русский",
  "th-th": "ไทย",
  "vi-vn": "Tiếng Việt",
  "de-de": "Deutsch",
  "id-id": "Bahasa Indonesia",
  "it-it": "Italiano",
  "pt-pt": "Português",
  "tr-tr": "Türkçe",
};

export function languageDisplayLabel(code: string) {
  const name = LANGUAGE_NATIVE_NAMES[code] || code;
  return name === code ? code : `${name} · ${code}`;
}

export type LanguageCsvField = "level_name" | "level_intro" | "desc";

export const LANGUAGE_FIELD_LIMITS: Record<LanguageCsvField, number> = {
  level_name: 20,
  level_intro: 400,
  desc: 10000,
};

export const LANGUAGE_CSV_ROW_LABELS: Record<LanguageCsvField, string> = {
  level_name: "标题",
  level_intro: "玩法说明",
  desc: "关卡详情",
};

export const LANGUAGE_CSV_FIELDS: LanguageCsvField[] = [
  "level_name",
  "level_intro",
  "desc",
];

const ROW_LABEL_ALIASES: Record<string, LanguageCsvField> = {
  标题: "level_name",
  关卡名称: "level_name",
  玩法详情: "level_intro",
  玩法说明: "level_intro",
  关卡描述: "desc",
  关卡详情: "desc",
};

export interface LanguageValidationIssue {
  lang: string;
  field: LanguageCsvField;
  length: number;
  limit: number;
}

export interface LanguageCsvImportResult {
  appliedLanguages: string[];
  skippedColumns: string[];
  rejectedCells: Array<{ lang: string; field: LanguageCsvField; length: number }>;
  warnings: string[];
}

export function getLanguageFieldLimit(field: LanguageCsvField): number {
  return LANGUAGE_FIELD_LIMITS[field];
}

export function isLanguageFieldOverLimit(
  field: LanguageCsvField,
  value: string,
): boolean {
  return value.length > getLanguageFieldLimit(field);
}

export function languageFieldDisplayName(field: LanguageCsvField): string {
  return LANGUAGE_CSV_ROW_LABELS[field];
}

export function collectLanguageValidationIssues(
  languages: string[],
  drafts: Record<string, LanguageDraft>,
): LanguageValidationIssue[] {
  const issues: LanguageValidationIssue[] = [];
  for (const lang of languages) {
    const draft = drafts[lang];
    if (!draft) continue;
    for (const field of LANGUAGE_CSV_FIELDS) {
      const value = String(draft[field] ?? "");
      const limit = getLanguageFieldLimit(field);
      if (value.length > limit) {
        issues.push({ lang, field, length: value.length, limit });
      }
    }
  }
  return issues;
}

export function formatLanguageValidationMessage(
  issues: LanguageValidationIssue[],
  languageLabel: (code: string) => string,
): string {
  if (!issues.length) return "";
  const lines = issues.slice(0, 6).map((issue) => {
    const langName = languageLabel(issue.lang);
    const fieldName = languageFieldDisplayName(issue.field);
    return `${langName} 的${fieldName}（${issue.length}/${issue.limit} 字符）`;
  });
  const suffix =
    issues.length > 6 ? `等共 ${issues.length} 处超限` : "";
  return `以下内容超出字数限制：${lines.join("；")}${suffix ? `，${suffix}` : ""}。`;
}

export function buildLanguageCsv(
  languages: string[],
  drafts: Record<string, LanguageDraft>,
  columnLabel: (code: string) => string,
): string {
  const header = ["", ...languages.map((code) => columnLabel(code))];
  const rows = LANGUAGE_CSV_FIELDS.map((field) => [
    LANGUAGE_CSV_ROW_LABELS[field],
    ...languages.map((code) => drafts[code]?.[field] ?? ""),
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

export function parseLanguageCsv(
  text: string,
  knownLanguages: string[],
  languageLabel: (code: string) => string,
  drafts: Record<string, LanguageDraft>,
): LanguageCsvImportResult {
  const matrix = parseCsv(stripBom(text));
  if (!matrix.length) {
    throw new Error("CSV 文件为空。");
  }

  const header = matrix[0];
  if (!header.length || header.length < 2) {
    throw new Error("CSV 首行缺少语言列，请使用下载的模板格式。");
  }

  const columnLanguages: Array<string | null> = header.map((cell, index) => {
    if (index === 0) return null;
    return matchLanguageColumn(cell, knownLanguages, languageLabel);
  });

  const skippedColumns = header
    .map((cell, index) =>
      index > 0 && !columnLanguages[index] ? cell.trim() || `第 ${index + 1} 列` : "",
    )
    .filter(Boolean);

  const fieldRowMap = new Map<LanguageCsvField, number>();
  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const label = matrix[rowIndex][0]?.trim() || "";
    const field = ROW_LABEL_ALIASES[label];
    if (field && !fieldRowMap.has(field)) {
      fieldRowMap.set(field, rowIndex);
    }
  }

  const missingFields = LANGUAGE_CSV_FIELDS.filter((field) => !fieldRowMap.has(field));
  if (missingFields.length) {
    const names = missingFields.map((field) => LANGUAGE_CSV_ROW_LABELS[field]);
    throw new Error(`CSV 缺少必需行：${names.join("、")}。`);
  }

  const appliedLanguages = new Set<string>();
  const rejectedCells: LanguageCsvImportResult["rejectedCells"] = [];
  const warnings: string[] = [];

  for (let columnIndex = 1; columnIndex < header.length; columnIndex += 1) {
    const lang = columnLanguages[columnIndex];
    if (!lang) continue;

    const draft = drafts[lang] || {
      level_name: "",
      level_intro: "",
      desc: "",
      changelog: [],
      early_access_desc: "",
    };

    for (const field of LANGUAGE_CSV_FIELDS) {
      const rowIndex = fieldRowMap.get(field);
      if (rowIndex === undefined) continue;
      const rawValue = matrix[rowIndex]?.[columnIndex] ?? "";
      const value = String(rawValue);
      const limit = getLanguageFieldLimit(field);
      if (value.length > limit) {
        rejectedCells.push({ lang, field, length: value.length });
        continue;
      }
      draft[field] = value;
    }

    drafts[lang] = draft;
    appliedLanguages.add(lang);
  }

  if (!appliedLanguages.size) {
    throw new Error("未识别到任何可应用的语言列，请检查首行语种标题。");
  }

  if (skippedColumns.length) {
    warnings.push(`已跳过无法识别的列：${skippedColumns.join("、")}。`);
  }
  if (rejectedCells.length) {
    const samples = rejectedCells.slice(0, 4).map((item) => {
      const langName = languageLabel(item.lang);
      const fieldName = languageFieldDisplayName(item.field);
      return `${langName} ${fieldName}（${item.length} 字符）`;
    });
    const suffix =
      rejectedCells.length > 4 ? `等 ${rejectedCells.length} 处` : "";
    warnings.push(
      `以下单元格超出字数限制未导入：${samples.join("、")}${suffix}。`,
    );
  }

  return {
    appliedLanguages: [...appliedLanguages],
    skippedColumns,
    rejectedCells,
    warnings,
  };
}

function matchLanguageColumn(
  header: string,
  knownLanguages: string[],
  languageLabel: (code: string) => string,
): string | null {
  const trimmed = header.trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase();
  const exact = knownLanguages.find((code) => code.toLowerCase() === normalized);
  if (exact) return exact;

  for (const code of knownLanguages) {
    const label = languageLabel(code);
    if (trimmed === label) return code;

    const parts = trimmed.split(/[·•|]/).map((part) => part.trim());
    if (parts.length >= 2) {
      const maybeCode = parts[parts.length - 1].toLowerCase();
      const matched = knownLanguages.find(
        (item) => item.toLowerCase() === maybeCode,
      );
      if (matched) return matched;
    }
  }

  const byNativeName = knownLanguages.filter((code) => {
    const name = languageLabel(code);
    return name !== code && trimmed === name;
  });
  if (byNativeName.length === 1) return byNativeName[0];

  return null;
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (text[index - 1] === "\r") {
        // Windows line ending already handled by consuming \n
      }
      continue;
    }

    if (char === "\r") {
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.length > 1 || row[0] !== "" || rows.length) {
    rows.push(row);
  }

  if (inQuotes) {
    throw new Error("CSV 引号未闭合，请检查文件格式。");
  }

  return rows;
}
